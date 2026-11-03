import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { build271, build277, build835, build999 } from '@ugula/billing/mock';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  applyPayerFile,
  type FileItem,
  findBatchClaims,
  findClaimByNumber,
  findTracedCoverage,
  insertAcknowledgment,
  readPayerFile,
  saveFileItems
} from './payer-files.ts';
import { createRecordingDb } from './testing.ts';

const createdAt = new Date('2026-10-31T09:00:00Z');

const bytes = (text: string) => new TextEncoder().encode(text);

const boss: RunQueueClient = { insert: async () => undefined };

const fileDb = () =>
  createRecordingDb(({ sql, parameters }) => {
    if (sql.startsWith('insert into "payer_files"')) return [{ id: 'f1' }];
    if (sql.startsWith('select "id", "status" from "claims"'))
      return parameters[1] === 1001 ? [{ id: 'c1', status: 'submitted' }] : [];
    if (sql.includes('for update')) return [{ id: 'c1', status: 'submitted', patient_id: 'p1' }];
    if (sql.includes('from "claim_coverages" as "cc"'))
      return [{ id: 'cov1', payerId: 'DEMOMCR', payer: 'Medicare', has_events: true }];
    if (sql.includes('claim_balances')) return [{ balance_cents: 100_000 }];
    if (sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (sql.startsWith('select "coverage_id" from "claim_events"'))
      return [{ coverage_id: 'cov1' }];
    if (sql.includes('from "claim_batches"'))
      return parameters.includes(55)
        ? [
            { claim_id: 'c1', coverage_id: 'cov1', number: 1001 },
            { claim_id: 'c2', coverage_id: null, number: 1002 }
          ]
        : [];
    if (sql.includes('id::text'))
      return parameters.includes('cov1') ? [{ id: 'cov1', claim_id: 'c1' }] : [];
    return [];
  });

const apply = async (text: string) => {
  const read = readPayerFile(bytes(text));
  assert.ok(read.ok);
  const { db, queries } = fileDb();
  const out = await applyPayerFile(db, boss, {
    tenantId: 't1',
    userId: 'u1',
    fileName: 'in.x12',
    document: { key: 'k' },
    file: read.value,
    now: createdAt
  });
  const events = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
  return { out, queries, events, digest: read.value.digest };
};

const outcomes = (items: readonly FileItem[]) =>
  items.map((i) => [i.reference, i.claimId, i.outcome, i.message]);

describe('payer file queries', () => {
  it('finds claims by the number billed as CLM01 and batches by control number', async () => {
    const { db, queries } = createRecordingDb(() => []);
    for (const reference of ['not a number', '0', '-5', '1.5']) {
      assert.equal(await findClaimByNumber(db, 't1', reference), undefined, reference);
    }
    assert.equal(queries.length, 0);
    await findClaimByNumber(db, 't1', ' 1001 ');
    assert.deepEqual(queries[0]?.parameters, ['t1', 1001]);
    assert.deepEqual(await findBatchClaims(db, 't1', 'X'), []);
    await findBatchClaims(db, 't1', '000000101');
    assert.ok(queries[1]?.sql.includes('"b"."control_number" = $2'));
    assert.ok(queries[1]?.parameters.includes(101));
    await findTracedCoverage(db, 't1', 'ABC');
    assert.ok(queries[2]?.parameters.includes('abc'));
  });

  it('records acknowledgments once per file line and counts problems', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const inserted = await insertAcknowledgment(db, {
      claimId: 'c1',
      coverageId: 'cov1',
      kind: 'rejected',
      note: 'Rejected',
      payerClaimNumber: null,
      sourceKey: 'd:1',
      createdBy: 'u1'
    });
    assert.equal(inserted, false);
    assert.ok(queries[0]?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    await saveFileItems(db, 'f1', [], 0);
    assert.equal(queries.length, 2);
    assert.ok(queries[1]?.sql.startsWith('update "payer_files"'));
  });
});

describe('readPayerFile', () => {
  it('reads the kind and digest of an X12 file', () => {
    const text = build271({ trace: 'cov1', active: true }, { createdAt });
    const read = readPayerFile(bytes(text));
    assert.equal(read.ok && read.value.kind, '271');
    assert.equal(read.ok && read.value.text, text);
    assert.equal(read.ok && read.value.digest, createHash('sha256').update(text).digest('hex'));
  });

  it('refuses empty files and files that are not payer files', () => {
    assert.deepEqual(readPayerFile(new Uint8Array()), {
      ok: false,
      failure: { code: 'invalid', message: 'The file is empty' }
    });
    const garbage = readPayerFile(bytes('hello'));
    assert.match(garbage.ok ? '' : garbage.failure.message, /is not a remittance \(835\)/);
  });
});

describe('applyPayerFile', () => {
  it('posts remittances to matched claims and leaves unknown claims unmatched', async () => {
    const { out, queries, events, digest } = await apply(
      build835(
        [
          {
            checkNumber: 'CHK-1',
            claims: [
              {
                claimNumber: '1001',
                chargeCents: 100_000,
                paidCents: 60_000,
                payerClaimNumber: 'ICN-1'
              },
              { claimNumber: '2002', chargeCents: 1_000, paidCents: 500 }
            ]
          }
        ],
        { createdAt }
      )
    );
    assert.deepEqual(outcomes(out.items), [
      ['1001', 'c1', 'posted', ''],
      ['2002', null, 'unmatched', 'No claim has number 2002']
    ]);
    assert.deepEqual([out.items[0]?.paidCents, out.items[0]?.adjustedCents], [60_000, 40_000]);
    assert.deepEqual([out.id, out.kind, out.problems], ['f1', '835', 1]);
    assert.equal(events.length, 1);
    for (const value of [`${digest}:1`, 'ICN-1', 'CHK-1', 60_000, 40_000]) {
      assert.ok(events[0]?.parameters.includes(value), String(value));
    }
    assert.deepEqual(queries.at(-1)?.parameters, [2, 1, 'f1']);
  });

  it('acknowledges every submitted claim in an 837P batch the clearinghouse answered', async () => {
    const { out, events } = await apply(
      build999(
        { groupControlNumber: '55', transactions: [{ controlNumber: '0001', accepted: false }] },
        { createdAt }
      )
    );
    assert.deepEqual(outcomes(out.items), [
      ['1001', 'c1', 'rejected', 'The clearinghouse rejected 837P file 55']
    ]);
    assert.equal(out.problems, 1);
    assert.equal(events.length, 1);
    assert.ok(events[0]?.parameters.includes('rejected'));
    const unknown = await apply(
      build999({ groupControlNumber: '77', transactions: [] }, { createdAt })
    );
    assert.deepEqual(outcomes(unknown.out.items), [
      ['77', null, 'unmatched', 'No 837P file has control number 77']
    ]);
  });

  it('records payer acknowledgments against the coverage last submitted', async () => {
    const { out, events, digest } = await apply(
      build277(
        {
          claims: [
            { claimNumber: '1001', rejection: null, payerClaimNumber: 'PCN-1' },
            { claimNumber: '2002', rejection: 'Invalid member ID' }
          ]
        },
        { createdAt }
      )
    );
    assert.equal(out.items[0]?.outcome, 'accepted');
    assert.match(out.items[0]?.message ?? '', /^Accepted \(/);
    assert.deepEqual(outcomes(out.items.slice(1)), [
      ['2002', null, 'unmatched', 'No claim has number 2002']
    ]);
    for (const value of ['accepted', 'cov1', 'PCN-1', `${digest}:1`]) {
      assert.ok(events[0]?.parameters.includes(value), value);
    }
  });

  it('saves eligibility for traced coverages and nudges their claims', async () => {
    const active = await apply(build271({ trace: 'COV1', active: true }, { createdAt }));
    assert.deepEqual(
      active.out.items.map((i) => [i.reference, i.claimId, i.outcome]),
      [['COV1', 'c1', 'eligible']]
    );
    assert.equal(active.out.problems, 0);
    const saved = active.queries.find((q) => q.sql.startsWith('update "claim_coverages"'));
    assert.equal(saved?.parameters[0], 'active');
    assert.ok(saved?.parameters.includes(createdAt));
    assert.ok(active.queries.some((q) => q.sql.startsWith('insert into "signals"')));
    const inactive = await apply(build271({ trace: 'cov1', active: false }, { createdAt }));
    assert.equal(inactive.out.items[0]?.outcome, 'ineligible');
    assert.equal(inactive.out.problems, 1);
    const unknown = await apply(build271({ trace: 'cov9', active: true }, { createdAt }));
    assert.deepEqual(outcomes(unknown.out.items), [
      ['cov9', null, 'unmatched', 'No payer on a claim matches this response']
    ]);
  });
});
