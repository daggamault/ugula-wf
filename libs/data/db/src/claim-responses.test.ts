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

const boss: RunQueueClient = { insert: async () => undefined };

type Claim = {
  status?: string;
  balance?: number;
  duplicate?: boolean;
  coverages?: string[];
  paid?: number;
  moot?: { run_id: string; wait_id: string; outcome: string }[];
};

const claimDb = ({
  status = 'submitted',
  balance = 100,
  duplicate = false,
  coverages = [],
  paid = 0,
  moot = []
}: Claim) =>
  createRecordingDb(({ sql }) => {
    if (sql.includes('for update')) return [{ id: 'c1', status, patient_id: 'p1' }];
    if (sql.includes('claim_balances')) return [{ balance_cents: balance }];
    if (sql.startsWith('select "id" from "claim_events"')) return duplicate ? [{ id: 'e0' }] : [];
    if (sql.includes('from "claim_coverages"'))
      return coverages.map((id) => ({ id, payer: 'Medicare', has_events: false }));
    if (sql.includes('sum(paid_cents)')) return [{ paid }];
    if (sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (sql.startsWith('update "tasks"')) return moot;
    return [];
  });

const recordingBoss = () => {
  const jobs: unknown[] = [];
  const queue: RunQueueClient = { insert: async (_name, batch) => void jobs.push(...batch) };
  return { queue, jobs };
};

describe('claim responses', () => {
  it('reads balances and inserts responses idempotently, dropping a payer claim number without a payer', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('claim_balances') ? [{ balance_cents: 7 }] : []
    );
    assert.equal(await claimBalance(db, 'c1'), 7);
    assert.equal(await insertResponse(db, 'c1', 'u1', response), false);
    const insert = queries[1];
    assert.equal(queries.length, 2);
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
    const closed = await post('paid');
    assert.match(closed.ok ? '' : closed.failure.message, /already closed/);
    const draft = await post('draft');
    assert.match(draft.ok ? '' : draft.failure.message, /still a draft/);
    const over = await post('submitted');
    assert.equal(over.ok, false);
    assert.match(over.ok ? '' : over.failure.message, /more than the remaining balance of \$0\.03/);
    assert.equal(unchangeable('submitted'), null);
  });

  it('returns the balance without posting again for a request already applied', async () => {
    const { db, queries } = claimDb({ status: 'paid', balance: 40, duplicate: true });
    assert.deepEqual(await postClaimResponse(db, boss, 't', 'c1', null, response), {
      ok: true,
      value: { balanceCents: 40, duplicate: true }
    });
    assert.equal(
      queries.some((q) => q.sql.startsWith('insert into "claim_events"')),
      false
    );
  });

  it('refuses a payer that is not on the claim', async () => {
    const { db } = claimDb({ coverages: ['cov1'] });
    const out = await postClaimResponse(db, boss, 't', 'c1', null, {
      ...response,
      coverageId: 'cov2'
    });
    assert.deepEqual(out, {
      ok: false,
      failure: { code: 'invalid', message: 'That payer is not on this claim' }
    });
  });

  it('posts a response with its adjustments, settles moot tasks and nudges the claim', async () => {
    const { db, queries } = claimDb({
      balance: 100,
      coverages: ['cov1'],
      moot: [{ run_id: 'r1', wait_id: 'w1', outcome: 'writeOff' }]
    });
    const { queue, jobs } = recordingBoss();
    const out = await postClaimResponse(db, queue, 't', 'c1', 'u1', {
      ...response,
      coverageId: 'cov1',
      paidCents: 60,
      adjustedCents: 40,
      payerClaimNumber: 'ICN-1'
    });
    assert.deepEqual(out, { ok: true, value: { balanceCents: 0, duplicate: false } });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(insert?.parameters.includes('ICN-1'));
    assert.ok(insert?.parameters.includes(60));
    const adjustments = queries.find((q) =>
      q.sql.startsWith('insert into "claim_event_adjustments"')
    );
    assert.deepEqual(adjustments?.parameters, ['e1', 1, 'PR', '1', 5]);
    const tasks = queries.find((q) => q.sql.startsWith('update "tasks"'));
    assert.ok(tasks?.parameters.includes('cov1'));
    assert.ok(tasks?.sql.includes('and true'));
    assert.deepEqual(jobs, [
      {
        data: {
          runId: 'r1',
          command: {
            type: 'resume',
            suspensionId: 'w1',
            payload: { outcome: 'writeOff', values: {}, userId: 'u1' }
          }
        },
        retryLimit: 1_000_000,
        priority: 2
      }
    ]);
    assert.ok(queries.some((q) => q.sql.startsWith('insert into "signals"')));
  });

  it('keeps collections open while a balance remains', async () => {
    const { db, queries } = claimDb({ balance: 100 });
    const out = await postClaimResponse(db, boss, 't', 'c1', null, response);
    assert.deepEqual(out, { ok: true, value: { balanceCents: 95, duplicate: false } });
    assert.ok(queries.find((q) => q.sql.startsWith('update "tasks"'))?.sql.includes('and false'));
  });

  it('refunds up to what was paid, raising the balance', async () => {
    const refund = { ...response, kind: 'refunded' as const, paidCents: 30, adjustments: [] };
    const over = await postClaimResponse(claimDb({ paid: 20 }).db, boss, 't', 'c1', null, refund);
    assert.equal(
      over.ok ? '' : over.failure.message,
      '$0.30 is more than the $0.20 paid that can be refunded'
    );
    const { db, queries } = claimDb({ balance: 10, paid: 30 });
    assert.deepEqual(await postClaimResponse(db, boss, 't', 'c1', null, refund), {
      ok: true,
      value: { balanceCents: 40, duplicate: false }
    });
    assert.ok(
      queries.find((q) => q.sql.startsWith('insert into "claim_events"'))?.parameters.includes(-30)
    );
    assert.equal(
      queries.some((q) => q.sql.startsWith('update "tasks"')),
      false
    );
  });
});
