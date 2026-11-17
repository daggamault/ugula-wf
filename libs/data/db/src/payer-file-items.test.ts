import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  type Context,
  controlNumberOf,
  findClaimsByNumber,
  item,
  recordPayerEvents,
  unmatchedClaim
} from './payer-file-items.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

describe('payer file items', () => {
  it('reads 837P batch control numbers as positive integers', () => {
    assert.deepEqual(
      ['not a number', '', '0', '-5', '1.5', '9007199254740993', ' 1001 '].map(controlNumberOf),
      [null, null, null, null, null, null, 1001]
    );
  });

  it('finds claims by the daily number billed as CLM01 in one query of the agency', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'c1', number: '20261105-0001', status: 'submitted' }
    ]);
    assert.deepEqual(await findClaimsByNumber(db, 't1', []), new Map());
    assert.deepEqual(await findClaimsByNumber(db, 't1', ['x', '1001']), new Map());
    assert.equal(queries.length, 0);
    const found = await findClaimsByNumber(db, 't1', [
      ' 20261105-0001 ',
      '#202611050002',
      '20261105-0001'
    ]);
    assert.equal(
      queries[0]?.sql,
      'select "id", "number", "status" from "claims" where "agency_id" = $1 and "number" in ($2, $3)'
    );
    assert.deepEqual(queries[0]?.parameters, ['t1', '20261105-0001', '20261105-0002']);
    assert.equal(queries.length, 1);
    assert.deepEqual(
      [...found],
      [
        [' 20261105-0001 ', { id: 'c1', status: 'submitted' }],
        ['20261105-0001', { id: 'c1', status: 'submitted' }]
      ]
    );
  });

  it('builds file lines, with amounts only when posted', () => {
    assert.deepEqual(item('1001', 'c1', 'posted', '', { paidCents: 5, adjustedCents: 1 }), {
      reference: '1001',
      claimId: 'c1',
      outcome: 'posted',
      message: '',
      paidCents: 5,
      adjustedCents: 1
    });
    assert.deepEqual(item('1001', 'c1', 'review'), {
      reference: '1001',
      claimId: 'c1',
      outcome: 'review',
      message: '',
      paidCents: null,
      adjustedCents: null
    });
    assert.deepEqual(unmatchedClaim('2002'), {
      reference: '2002',
      claimId: null,
      outcome: 'unmatched',
      message: 'No claim has number 2002',
      paidCents: null,
      adjustedCents: null
    });
  });

  it('logs payer events once per file line in one statement and nudges their claims', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const c: Context = {
      tx: db,
      boss,
      agencyId: 't1',
      userId: 'u1',
      digest: 'd',
      fileName: 'a.999',
      now: new Date('2026-11-01T00:00:00Z'),
      postings: []
    };
    await recordPayerEvents(c, []);
    assert.equal(queries.length, 0);
    await recordPayerEvents(c, [
      {
        claimId: 'c1',
        coverageId: 'cov1',
        kind: 'accepted',
        note: 'Accepted (A1)',
        payerClaimNumber: 'PCN-9',
        key: '1'
      },
      {
        claimId: 'c2',
        coverageId: 'cov2',
        kind: 'rejected',
        note: 'Rejected',
        payerClaimNumber: null,
        key: '2'
      }
    ]);
    const [insert, ...nudges] = queries;
    assert.equal(
      insert?.sql,
      'insert into "claim_events" ("agency_id", "claim_id", "kind", "coverage_id", "note", "payer_claim_number", "created_by_id", "source_key") values ($1, $2, $3, $4, $5, $6, $7, $8), ($9, $10, $11, $12, $13, $14, $15, $16) on conflict ("claim_id", "source_key") do nothing'
    );
    assert.deepEqual(insert?.parameters, [
      't1',
      'c1',
      'accepted',
      'cov1',
      'Accepted (A1)',
      'PCN-9',
      'u1',
      'd:1',
      't1',
      'c2',
      'rejected',
      'cov2',
      'Rejected',
      null,
      'u1',
      'd:2'
    ]);
    assert.deepEqual(
      nudges.map((q) => [q.sql.split(' ').slice(0, 3).join(' '), q.parameters]),
      [
        ['insert into "signals"', ['t1', 'claim:c1', 1, 't1', 'claim:c2', 1]],
        ['select "id", state', ['t1', 'claim:c1', 'claim:c2', 'suspended']]
      ]
    );
  });
});
