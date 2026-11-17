import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  type ClaimResponse,
  claimBalance,
  insertResponse,
  listCoverages,
  logDenial,
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
    assert.equal(await insertResponse(db, 't1', 'c1', 'u1', response), false);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        ['select "balance_cents" from "claim_balances" where "claim_id" = $1', ['c1']],
        [
          'insert into "claim_events" ("agency_id", "claim_id", "kind", "coverage_id", "paid_cents", "adjusted_cents", "payer_claim_number", "paid_on", "check_number", "note", "created_by_id", "source_key") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict ("claim_id", "source_key") do nothing returning "id"',
          ['t1', 'c1', 'response', null, 5, 0, null, null, null, '', 'u1', 'req-1']
        ]
      ]
    );
  });

  it('stores a response with its payer claim number, adjustments and remarks in order', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claim_events"') ? [{ id: 'e1' }] : []
    );
    assert.equal(
      await insertResponse(db, 't1', 'c1', 'u1', {
        ...response,
        coverageId: 'cov1',
        paidOn: '2026-10-05',
        checkNumber: 'CHK-9',
        payerClaimNumber: 'ICN-1',
        adjustments: [
          { group: 'CO', reason: '45', cents: 20 },
          { group: 'PR', reason: '2', cents: 5 }
        ],
        remarks: ['N130', 'MA01'],
        lines: []
      }),
      true
    );
    assert.deepEqual(
      queries.map((q) => [q.sql.split(' (')[0], q.parameters]),
      [
        [
          'insert into "claim_events"',
          ['t1', 'c1', 'response', 'cov1', 5, 0, 'ICN-1', '2026-10-05', 'CHK-9', '', 'u1', 'req-1']
        ],
        ['insert into "claim_event_adjustments"', ['e1', 1, 'CO', '45', 20, 'e1', 2, 'PR', '2', 5]],
        ['insert into "claim_event_remarks"', ['e1', 1, 'N130', 'e1', 2, 'MA01']]
      ]
    );
  });

  it('stores a refund as money going back out', async () => {
    const { db, queries } = createRecordingDb();
    await insertResponse(db, 't1', 'c1', null, {
      ...response,
      kind: 'refunded',
      paidCents: 30,
      adjustments: []
    });
    assert.deepEqual(queries[0]?.parameters, [
      't1',
      'c1',
      'refunded',
      null,
      -30,
      0,
      null,
      null,
      null,
      '',
      null,
      'req-1'
    ]);
    assert.equal(queries.length, 1);
  });

  it('stores how the payer adjudicated each line with its reason codes', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claim_events"') ? [{ id: 'e1' }] : []
    );
    const line = { line: 2, code: 'A0425', modifiers: ['RH'], paidCents: 600, units: 7.4 };
    await insertResponse(db, 't1', 'c1', 'u1', {
      ...response,
      lines: [
        { ...line, adjustments: [{ group: 'CO', reason: '45', cents: 300 }] },
        { ...line, line: 3, adjustments: [] }
      ]
    });
    const lines = queries.find((q) => q.sql.startsWith('insert into "claim_event_lines"'));
    const reasons = queries.find((q) =>
      q.sql.startsWith('insert into "claim_event_line_adjustments"')
    );
    assert.deepEqual(lines?.parameters, [
      'e1',
      2,
      'A0425',
      ['RH'],
      600,
      7.4,
      'e1',
      3,
      'A0425',
      ['RH'],
      600,
      7.4
    ]);
    assert.deepEqual(reasons?.parameters, ['e1', 2, 1, 'CO', '45', 300]);
    assert.equal(
      queries.some((q) => q.sql.startsWith('insert into "claim_event_remarks"')),
      false
    );
  });

  it('stores adjudicated lines without line reasons when no line has any', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claim_events"') ? [{ id: 'e1' }] : []
    );
    await insertResponse(db, 't1', 'c1', 'u1', {
      ...response,
      adjustments: [],
      lines: [{ line: 1, code: 'A0427', modifiers: [], paidCents: 600, units: 1, adjustments: [] }]
    });
    assert.deepEqual(
      queries.map((q) => q.sql.split(' (')[0]),
      ['insert into "claim_events"', 'insert into "claim_event_lines"']
    );
  });

  it('lists the payers of a claim in order, flagging those that already have billing activity', async () => {
    const coverages = [{ id: 'cov1', payer: 'Medicare', has_events: true }];
    const { db, queries } = createRecordingDb(() => coverages);
    assert.deepEqual(await listCoverages(db, 'c1'), coverages);
    assert.equal(
      queries[0]?.sql,
      'select "cc"."id", coalesce(dp.name, cc.payer_name) as "payer", exists ((select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "cc"."id")) as "has_events" from "claim_coverages" as "cc" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" where "cc"."claim_id" = $1 order by "cc"."position"'
    );
    assert.deepEqual(queries[0]?.parameters, ['c1']);
  });

  it('sums what a payer or the patient paid, for refunds', async () => {
    const { db, queries } = createRecordingDb(() => [{ paid: 900 }]);
    assert.equal(await paidBy(db, 'c1', 'cov1'), 900);
    await paidBy(db, 'c1', null);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select coalesce(sum(paid_cents), 0)::int as "paid" from "claim_events" where "claim_id" = $1 and "coverage_id" = $2',
          ['c1', 'cov1']
        ],
        [
          'select coalesce(sum(paid_cents), 0)::int as "paid" from "claim_events" where "claim_id" = $1 and "coverage_id" is null',
          ['c1']
        ]
      ]
    );
  });

  it('logs a denial once per source key', async () => {
    const { db, queries } = createRecordingDb();
    await logDenial(db, 't1', 'c1', 'u1', {
      coverageId: 'cov1',
      route: 'appeal',
      note: 'Denied CO-50',
      sourceKey: 'run:step'
    });
    assert.equal(
      queries[0]?.sql,
      'insert into "claim_events" ("agency_id", "claim_id", "kind", "coverage_id", "route", "note", "created_by_id", "source_key") values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict ("claim_id", "source_key") do nothing'
    );
    assert.deepEqual(queries[0]?.parameters, [
      't1',
      'c1',
      'denied',
      'cov1',
      'appeal',
      'Denied CO-50',
      'u1',
      'run:step'
    ]);
  });

  it('posts nothing to a missing, void or draft claim', async () => {
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
    assert.deepEqual(await post(null), {
      ok: false,
      failure: { code: 'not_found', message: 'Claim not found' }
    });
    assert.deepEqual(await post('void'), {
      ok: false,
      failure: { code: 'conflict', message: 'Claim is already closed' }
    });
    assert.deepEqual(await post('draft'), {
      ok: false,
      failure: {
        code: 'conflict',
        message: 'This claim is still a draft. Finish its PCR tasks before changing it.'
      }
    });
    assert.equal(unchangeable('submitted'), null);
  });

  it('reopens a paid, written-off or collections claim a payment, takeback or refund is posted to', async () => {
    const reopen = async (status: string, posted: Partial<ClaimResponse>, balance = 0) => {
      const { db, queries } = createRecordingDb(({ sql }) => {
        if (sql.includes('for update')) return [{ id: 'c1', status, patient_id: 'p1' }];
        if (sql.includes('claim_balances')) return [{ balance_cents: balance }];
        if (sql.includes('sum(adjusted_cents)')) return [{ paid: 60, adjusted: 40 }];
        if (sql.includes('sum(paid_cents)')) return [{ paid: 60 }];
        if (sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
        return [];
      });
      const out = await postClaimResponse(db, boss, 't', 'c1', 'u1', { ...response, ...posted });
      assert.ok(out.ok);
      const reopened = queries.filter(
        (q) => q.sql.startsWith('update "claims"') || q.parameters.includes('reopened')
      );
      return reopened.map((q) => [q.sql, q.parameters]);
    };
    assert.deepEqual(await reopen('paid', { coverageId: null }), [
      [
        'update "claims" set "status" = $1, "updated_at" = now() where "id" = $2',
        ['reconcile', 'c1']
      ],
      [
        'insert into "claim_events" ("agency_id", "claim_id", "kind", "coverage_id", "note", "created_by_id", "source_key") values ($1, $2, $3, $4, $5, $6, $7)',
        [
          't',
          'c1',
          'reopened',
          null,
          'A payment was posted after the claim closed as paid',
          'u1',
          'req-1:reopened'
        ]
      ]
    ]);
    const note = async (status: string, posted: Partial<ClaimResponse>, balance = 0) =>
      (await reopen(status, posted, balance))[1]?.[1]?.[4];
    assert.equal(
      await note('written_off', {
        coverageId: 'cov1',
        paidCents: -60,
        adjustedCents: -40,
        reversal: true
      }),
      'A takeback was posted after the claim closed as written off'
    );
    assert.equal(
      await note('collections', { kind: 'refunded', paidCents: 5, adjustments: [] }, -5),
      'A refund was posted after the claim closed as sent to collections'
    );
  });

  it('leaves a closed claim closed when the posting is refused or already applied', async () => {
    const refused = claimDb({ status: 'paid' });
    const out = await postClaimResponse(refused.db, boss, 't', 'c1', null, {
      ...response,
      paidCents: -5
    });
    assert.equal(out.ok, false);
    const duplicate = claimDb({ status: 'paid', duplicate: true });
    await postClaimResponse(duplicate.db, boss, 't', 'c1', null, response);
    for (const { queries } of [refused, duplicate]) {
      assert.ok(!queries.some((q) => /^(insert|update)/.test(q.sql)));
    }
  });

  it('locks the claim of the agency before looking for an earlier copy of the request', async () => {
    const { db, queries } = claimDb({ duplicate: true });
    await postClaimResponse(db, boss, 't', 'c1', null, response);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "id", "status", "patient_id" from "claims" where "id" = $1 and "agency_id" = $2 for update',
          ['c1', 't']
        ],
        [
          'select "id" from "claim_events" where "claim_id" = $1 and "source_key" = $2',
          ['c1', 'req-1']
        ],
        ['select "balance_cents" from "claim_balances" where "claim_id" = $1', ['c1']]
      ]
    );
  });

  it('posts an overpayment as a credit balance and caps adjustments at what remains unpaid', async () => {
    const over = claimDb({ balance: 3 });
    assert.deepEqual(
      await postClaimResponse(over.db, boss, 't', 'c1', null, { ...response, adjustedCents: 4 }),
      { ok: true, value: { balanceCents: -2, adjustedCents: 0, duplicate: false } }
    );
    const insert = over.queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(insert?.parameters.slice(3, 6), [null, 5, 0]);
    const capped = claimDb({ balance: 100 });
    assert.deepEqual(
      await postClaimResponse(capped.db, boss, 't', 'c1', null, {
        ...response,
        paidCents: 70,
        adjustedCents: 45
      }),
      { ok: true, value: { balanceCents: 0, adjustedCents: 30, duplicate: false } }
    );
    assert.deepEqual(
      capped.queries
        .find((q) => q.sql.startsWith('insert into "claim_events"'))
        ?.parameters.slice(3, 6),
      [null, 70, 30]
    );
  });

  it('refuses 835 adjustments that take off more than the payment leaves open', async () => {
    const { db, queries } = claimDb({ balance: 100 });
    const out = await postClaimResponse(db, boss, 't', 'c1', null, {
      ...response,
      paidCents: 70,
      adjustedCents: 45,
      exactAdjustment: true
    });
    assert.equal(
      out.ok ? '' : out.failure.message,
      'The adjustments of $0.45 take off more than the $0.30 left open after the payment; post it by hand'
    );
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
    const exact = await postClaimResponse(claimDb({ balance: 100 }).db, boss, 't', 'c1', null, {
      ...response,
      paidCents: 70,
      adjustedCents: 30,
      exactAdjustment: true
    });
    assert.deepEqual(exact, {
      ok: true,
      value: { balanceCents: 0, adjustedCents: 30, duplicate: false }
    });
  });

  it('posts a reversal of what one payer posted, raising the balance without settling tasks', async () => {
    const reversal = {
      ...response,
      coverageId: 'cov1',
      paidCents: -60,
      adjustedCents: -40,
      reversal: true
    };
    const open = (paid: number, adjusted: number, status = 'reconcile') =>
      createRecordingDb(({ sql }) => {
        if (sql.includes('for update')) return [{ id: 'c1', status, patient_id: 'p1' }];
        if (sql.includes('claim_balances')) return [{ balance_cents: 0 }];
        if (sql.includes('sum(adjusted_cents)')) return [{ paid, adjusted }];
        if (sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
        return [];
      });
    const closed = await postClaimResponse(
      open(60, 40, 'void').db,
      boss,
      't',
      'c1',
      null,
      reversal
    );
    assert.match(closed.ok ? '' : closed.failure.message, /already closed/);
    const { db, queries } = open(60, 40);
    assert.deepEqual(await postClaimResponse(db, boss, 't', 'c1', null, reversal), {
      ok: true,
      value: { balanceCents: 100, adjustedCents: -40, duplicate: false }
    });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(insert?.parameters.slice(4, 6), [-60, -40]);
    assert.ok(!queries.some((q) => q.sql.startsWith('update "tasks"')));
    const postedQuery = queries.find((q) => q.sql.includes('sum(adjusted_cents)'));
    assert.equal(
      postedQuery?.sql,
      'select coalesce(sum(paid_cents), 0)::int as "paid", coalesce(sum(adjusted_cents), 0)::int as "adjusted" from "claim_events" where "claim_id" = $1 and "coverage_id" = $2'
    );
    assert.deepEqual(postedQuery?.parameters, ['c1', 'cov1']);
    const tooMuchPaid = await postClaimResponse(open(50, 40).db, boss, 't', 'c1', null, reversal);
    assert.equal(
      tooMuchPaid.ok ? '' : tooMuchPaid.failure.message,
      'The reversal takes back more than the $0.50 paid and $0.40 adjusted posted for this payer; post it by hand'
    );
    const tooMuchAdjusted = await postClaimResponse(
      open(60, 39).db,
      boss,
      't',
      'c1',
      null,
      reversal
    );
    assert.equal(
      tooMuchAdjusted.ok ? '' : tooMuchAdjusted.failure.message,
      'The reversal takes back more than the $0.60 paid and $0.39 adjusted posted for this payer; post it by hand'
    );
    const handOnly = 'A reversal takes back what one payer posted; post it by hand';
    for (const change of [{ paidCents: 10 }, { adjustedCents: 1 }, { coverageId: null }]) {
      const refused = await postClaimResponse(open(60, 40).db, boss, 't', 'c1', null, {
        ...reversal,
        ...change
      });
      assert.deepEqual(refused, { ok: false, failure: { code: 'invalid', message: handOnly } });
    }
  });

  it('refuses negative amounts so takebacks and reversals reach a biller', async () => {
    for (const amounts of [{ paidCents: -10 }, { adjustedCents: -1 }]) {
      const { db, queries } = claimDb({ balance: 100 });
      const out = await postClaimResponse(db, boss, 't', 'c1', null, { ...response, ...amounts });
      assert.deepEqual(out, {
        ok: false,
        failure: {
          code: 'invalid',
          message: 'Negative amounts (reversals and takebacks) need a biller to post them'
        }
      });
      assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
    }
  });

  it('returns the balance without posting again for a request already applied', async () => {
    const { db, queries } = claimDb({ status: 'paid', balance: 40, duplicate: true });
    assert.deepEqual(await postClaimResponse(db, boss, 't', 'c1', null, response), {
      ok: true,
      value: { balanceCents: 40, adjustedCents: 0, duplicate: true }
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
    assert.deepEqual(out, {
      ok: true,
      value: { balanceCents: 0, adjustedCents: 40, duplicate: false }
    });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(insert?.parameters, [
      't',
      'c1',
      'response',
      'cov1',
      60,
      40,
      'ICN-1',
      null,
      null,
      '',
      'u1',
      'req-1'
    ]);
    const adjustments = queries.find((q) =>
      q.sql.startsWith('insert into "claim_event_adjustments"')
    );
    assert.deepEqual(adjustments?.parameters, ['e1', 1, 'PR', '1', 5]);
    const tasks = queries.find((q) => q.sql.startsWith('update "tasks"'));
    assert.equal(
      tasks?.sql,
      `update "tasks" set "status" = $1, "completed_at" = now(), "resolution" = jsonb_build_object('outcome', case when queue = $2 then 'keepWaiting' else 'writeOff' end, 'values', '{}'::jsonb, 'resolvedBy', 'claim response'), "updated_at" = now() where "agency_id" = $3 and "status" = $4 and "run_id" in (select "run_id" from "claim_runs" where "claim_id" = $5) and (("queue" = $6 and context ->> 'coverageId' = $7) or ("queue" = $8 and true)) returning "run_id", "wait_id", resolution ->> 'outcome' as "outcome"`
    );
    assert.deepEqual(tasks?.parameters, [
      'completed',
      'billing-followup',
      't',
      'open',
      'c1',
      'billing-followup',
      'cov1',
      'billing-collections'
    ]);
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
    assert.deepEqual(queries.find((q) => q.sql.startsWith('insert into "signals"'))?.parameters, [
      't',
      'claim:c1',
      1
    ]);
  });

  it('keeps collections open while a balance remains', async () => {
    const { db, queries } = claimDb({ balance: 100 });
    const out = await postClaimResponse(db, boss, 't', 'c1', null, response);
    assert.deepEqual(out, {
      ok: true,
      value: { balanceCents: 95, adjustedCents: 0, duplicate: false }
    });
    const tasks = queries.find((q) => q.sql.startsWith('update "tasks"'));
    assert.match(
      tasks?.sql ?? '',
      /\(\("queue" = \$6 and context ->> 'coverageId' = \$7\) or \("queue" = \$8 and false\)\)/
    );
    assert.deepEqual(tasks?.parameters.slice(5), ['billing-followup', '', 'billing-collections']);
  });

  it('refunds up to what was paid and the credit balance, raising the balance', async () => {
    const refund = { ...response, kind: 'refunded' as const, paidCents: 30, adjustments: [] };
    const over = await postClaimResponse(
      claimDb({ balance: -40, paid: 20 }).db,
      boss,
      't',
      'c1',
      null,
      refund
    );
    assert.equal(
      over.ok ? '' : over.failure.message,
      '$0.30 is more than the $0.20 paid that can be refunded'
    );
    const beyondCredit = await postClaimResponse(
      claimDb({ balance: -10, paid: 30 }).db,
      boss,
      't',
      'c1',
      null,
      refund
    );
    assert.equal(
      beyondCredit.ok ? '' : beyondCredit.failure.message,
      '$0.30 is more than the $0.10 credit balance that can be refunded'
    );
    const owed = await postClaimResponse(
      claimDb({ balance: 10, paid: 30 }).db,
      boss,
      't',
      'c1',
      null,
      refund
    );
    assert.equal(
      owed.ok ? '' : owed.failure.message,
      '$0.30 is more than the $0.00 credit balance that can be refunded'
    );
    const { db, queries } = claimDb({ balance: -30, paid: 30 });
    assert.deepEqual(await postClaimResponse(db, boss, 't', 'c1', null, refund), {
      ok: true,
      value: { balanceCents: 0, adjustedCents: 0, duplicate: false }
    });
    assert.deepEqual(
      queries.find((q) => q.sql.startsWith('insert into "claim_events"'))?.parameters.slice(2, 6),
      ['refunded', null, -30, 0]
    );
    assert.equal(
      queries.some((q) => q.sql.startsWith('update "tasks"')),
      false
    );
  });
});
