import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  postBatchAcknowledgments,
  postClaimStatuses,
  postInterchangeAcknowledgments
} from './payer-file-acknowledgments.ts';
import type { Context } from './payer-file-items.ts';
import type { RowsFor } from './testing.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

const contextOf = (rows: RowsFor = () => []) => {
  const { db, queries } = createRecordingDb(rows);
  const c: Context = {
    tx: db,
    boss,
    agencyId: 't1',
    userId: null,
    digest: 'd',
    fileName: 'in.x12',
    now: new Date('2026-11-01T00:00:00Z'),
    postings: []
  };
  return { c, queries };
};

const group = (groupControlNumber: string) => ({
  groupControlNumber,
  accepted: true,
  transactions: [{ controlNumber: '0001', accepted: true, errors: [] }]
});

describe('payer file acknowledgments', () => {
  it('looks a batch up by its control number and reports one it never filed', async () => {
    const none = contextOf();
    const out = await postBatchAcknowledgments(none.c, [group('X')]);
    assert.equal(none.queries.length, 0);
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.outcome]),
      [['X', 'unmatched']]
    );
    const filed = contextOf(({ sql }) =>
      sql.includes('from "claim_batches"')
        ? [{ claim_id: 'c1', coverage_id: 'cov1', number: '20261105-0007' }]
        : []
    );
    const acked = await postBatchAcknowledgments(filed.c, [group('000000101')]);
    const lookup = filed.queries.find((q) => q.sql.includes('from "claim_batches"'));
    assert.ok(lookup?.sql.includes('"b"."control_number" = $2'));
    assert.ok(lookup?.parameters.includes(101));
    assert.deepEqual(
      acked.items.map((i) => [i.reference, i.outcome]),
      [['20261105-0007', 'accepted']]
    );
  });

  it('marks a batch rejected at the envelope by a TA1', async () => {
    const { c, queries } = contextOf();
    const out = await postInterchangeAcknowledgments(c, [
      { controlNumber: '000000055', status: 'rejected', noteCode: '006', message: 'Bad ID' }
    ]);
    assert.ok(queries.some((q) => q.sql.startsWith('update "claim_batches"')));
    assert.match(out.envelopeRejection ?? '', /rejected the file envelope: interchange 55/);
  });

  it('sends a claim status for a claim never submitted from here to a biller', async () => {
    const { c } = contextOf(({ sql }) =>
      sql.startsWith('select "id", "status" from "claims"') ? [{ id: 'c1', status: 'paid' }] : []
    );
    const out = await postClaimStatuses(c, [
      {
        trace: '20261105-1001',
        claimNumber: '20261105-1001',
        category: 'A2',
        code: '20',
        meaning: 'inProcess',
        message: '',
        payerClaimNumber: null,
        chargeCents: 100,
        paidCents: 0
      }
    ]);
    assert.deepEqual(
      out.items.map((i) => [i.claimId, i.outcome, i.message]),
      [['c1', 'review', 'The claim has not been submitted from here']]
    );
  });
});
