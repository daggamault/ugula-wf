import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  type ClaimResponse,
  claimBalance,
  insertResponse,
  listCoverages,
  paidBy,
  postClaimResponse,
  unchangeable
} from './claim-responses.ts';
import { createRecordingDb } from './testing.ts';

const response: ClaimResponse = {
  requestId: 'req-1',
  kind: 'response',
  coverageId: null,
  paidCents: 5,
  adjustedCents: 0,
  paidOn: null,
  checkNumber: null,
  payerClaimNumber: 'ignored without a payer',
  adjustments: [{ group: 'PR', reason: '1', cents: 5 }],
  note: ''
};

const boss = { send: async () => null, insert: async () => undefined } as unknown as RunQueueClient;

describe('claim responses', () => {
  it('reads balances and inserts responses idempotently, dropping a payer claim number without a payer', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('claim_balances') ? [{ balance_cents: 7 }] : []
    );
    assert.equal(await claimBalance(db, 'c1'), 7);
    assert.equal(await insertResponse(db, 'c1', 'u1', response), false);
    const insert = queries[1];
    assert.ok(insert?.parameters.includes('response'));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    assert.ok(!insert?.parameters.includes('ignored without a payer'));
  });

  it('flags coverages that already have billing activity', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listCoverages(db, 'c1');
    assert.ok(
      queries[0]?.sql.includes(
        'exists ((select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "cc"."id")) as "has_events"'
      )
    );
  });

  it('sums what a payer or the patient paid, for refunds', async () => {
    const { db, queries } = createRecordingDb(() => [{ paid: 900 }]);
    assert.equal(await paidBy(db, 'c1', 'cov1'), 900);
    await paidBy(db, 'c1', null);
    assert.ok(queries[0]?.sql.endsWith('"claim_id" = $1 and "coverage_id" = $2'));
    assert.ok(queries[1]?.sql.endsWith('"coverage_id" is null'));
  });

  it('posts nothing to a missing, closed, draft or overpaid claim', async () => {
    const claimOf = (status: string | null) =>
      createRecordingDb((q) =>
        q.sql.includes('for update')
          ? status === null
            ? []
            : [{ id: 'c1', status, patient_id: 'p1' }]
          : q.sql.includes('claim_balances')
            ? [{ balance_cents: 3 }]
            : []
      ).db;
    const post = (status: string | null) =>
      postClaimResponse(claimOf(status), boss, 't', 'c1', null, response);
    const missing = await post(null);
    assert.equal(missing.ok ? null : missing.failure.code, 'not_found');
    assert.equal((await post('paid')).ok, false);
    assert.equal((await post('draft')).ok, false);
    const over = await post('submitted');
    assert.equal(over.ok, false);
    assert.match(over.ok ? '' : over.failure.message, /more than the remaining balance of \$0\.03/);
    assert.equal(unchangeable('submitted'), null);
  });
});
