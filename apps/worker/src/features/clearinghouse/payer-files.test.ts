import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build999 } from '@ugula/billing/mock';
import { buildTA1 } from '@ugula/billing/mock-waystar';
import { createRecordingDb, type RowsFor } from '@ugula/db/testing';
import type { LiveEvent } from '@ugula/live';
import type { RunQueueClient } from '@ugula/run-queue';
import { createPayerFileStore } from './payer-files.ts';

const document = { bucket: 'ugula', key: 'clearinghouse/t1/1-a.999' };

const rejected = build999({
  groupControlNumber: '7',
  transactions: [{ controlNumber: '0001', accepted: false }]
});

const batch = [
  { claim_id: 'c1', coverage_id: 'cov-1', number: 1001 },
  { claim_id: 'c1', coverage_id: 'cov-2', number: 1001 },
  { claim_id: 'c2', coverage_id: 'cov-3', number: 1002 }
];

const rowsFor =
  (imported: boolean): RowsFor =>
  (q) => {
    if (q.sql.startsWith('select "agency_id" from "workflow_runs"')) return [{ agency_id: 't1' }];
    if (q.sql.startsWith('select "id", "created_at" from "payer_files"')) {
      return imported ? [{ id: 'f0', created_at: new Date() }] : [];
    }
    if (q.sql.startsWith('insert into "payer_files"')) return [{ id: 'f1' }];
    if (q.sql.includes('from "claim_batches" as "b"')) return batch;
    if (q.sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    return [];
  };

const storeFor = (text: string, rows: RowsFor) => {
  const { db, queries } = createRecordingDb(rows);
  const boss: RunQueueClient = { insert: async () => undefined };
  const announced: [string, LiveEvent][] = [];
  const store = createPayerFileStore(
    db,
    { getBytes: async () => new TextEncoder().encode(text) },
    boss,
    async (runId, event) => void announced.push([runId, event]),
    () => new Date('2026-11-03T12:00:00Z')
  );
  return { store, queries, announced };
};

describe('createPayerFileStore', () => {
  it("applies a file for the run's agency and announces each claim it touched once", async () => {
    const { store, queries, announced } = storeFor(rejected, rowsFor(false));
    const applied = await store.apply('r1', 'k', { document, fileName: 'a.999' });
    const message = 'The clearinghouse rejected 837P file 7';
    assert.deepEqual(applied, {
      status: 'applied',
      fileId: 'f1',
      kind: '999',
      envelopeRejection: null,
      reviews: [
        { reference: '1001', claimId: 'c1', outcome: 'rejected', message },
        { reference: '1001', claimId: 'c1', outcome: 'rejected', message },
        { reference: '1002', claimId: 'c2', outcome: 'rejected', message }
      ]
    });
    assert.deepEqual(announced, [
      ['r1', { kind: 'claim', id: 'c1' }],
      ['r1', { kind: 'claim', id: 'c2' }]
    ]);
    const file = queries.find((q) => q.sql.startsWith('insert into "payer_files"'));
    assert.ok(file?.parameters.includes('t1') && file.parameters.includes('a.999'));
    assert.ok(file?.parameters.includes(JSON.stringify(document)));
  });

  it('lists only the lines a biller has to look at', async () => {
    const accepted = build999({
      groupControlNumber: '7',
      transactions: [{ controlNumber: '0001', accepted: true }]
    });
    const { store, announced } = storeFor(accepted, rowsFor(false));
    assert.deepEqual(await store.apply('r1', 'k', { document, fileName: 'a.999' }), {
      status: 'applied',
      fileId: 'f1',
      kind: '999',
      envelopeRejection: null,
      reviews: []
    });
    assert.equal(announced.length, 2);
  });

  it('applies the same file only once per agency', async () => {
    const { store, queries, announced } = storeFor(rejected, rowsFor(true));
    assert.deepEqual(await store.apply('r1', 'k', { document, fileName: 'a.999' }), {
      status: 'duplicate',
      fileId: 'f0'
    });
    const lookup = queries.find((q) => q.sql.includes('from "payer_files"'));
    assert.equal(lookup?.parameters[0], 't1');
    assert.equal(
      queries.some((q) => q.sql.startsWith('insert')),
      false
    );
    assert.deepEqual(announced, []);
  });

  it('says why a file cannot be read without writing anything', async () => {
    const empty = storeFor('', rowsFor(false));
    assert.deepEqual(await empty.store.apply('r1', 'k', { document, fileName: 'a.999' }), {
      status: 'unreadable',
      reason: 'The file is empty'
    });
    const text = storeFor('hello', rowsFor(false));
    const unread = await text.store.apply('r1', 'k', { document, fileName: 'a.txt' });
    assert.equal(unread.status, 'unreadable');
    assert.equal(text.queries.length, 1);
  });

  it('passes on why a TA1 rejected the envelope, for whoever sets up the clearinghouse', async () => {
    const ta1 = buildTA1(
      { sender: 'SUB01', receiver: 'X', controlNumber: '7', production: false },
      '008',
      new Date('2026-11-03T12:00:00Z')
    );
    const { store, queries } = storeFor(ta1, rowsFor(false));
    const applied = await store.applyDocument('r1', document, 'a.TA1');
    assert.equal(applied.status, 'applied');
    assert.equal(applied.status === 'applied' && applied.kind, 'TA1');
    assert.match(
      applied.status === 'applied' ? (applied.envelopeRejection ?? '') : '',
      /^The clearinghouse rejected the file envelope: interchange 7: Invalid interchange receiver ID/
    );
    assert.ok(queries.some((q) => q.sql.startsWith('update "claim_batches" set "rejected_at"')));
  });

  it('refuses files for unknown runs', async () => {
    const { store } = storeFor(rejected, () => []);
    await assert.rejects(() => store.apply('r9', 'k', { document, fileName: 'a.999' }));
  });
});
