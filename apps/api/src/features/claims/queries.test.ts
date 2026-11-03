import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  claimBalance,
  findClaim,
  insertResponse,
  listClaimEvents,
  listClaims,
  listCoverages,
  numberOf,
  reorderCoverages
} from './queries.ts';

describe('claim queries', () => {
  it('scope claims to the tenant with balances from the view and payers in billing order', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaims(db, 't-1', {
      status: 'open',
      page: 2,
      pageSize: 25,
      sort: 'balance',
      dir: 'desc'
    });
    await listClaims(db, 't-1', {
      status: 'all',
      firstName: 'Ja%',
      lastName: "O'Neil",
      birthDate: '1980-01-02',
      number: '#42',
      patientId: 'p-1',
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc'
    });
    const search = queries.at(-1);
    assert.ok(!search?.sql.includes('"c"."status" ='));
    assert.ok(!search?.sql.includes('"c"."status" not in'));
    assert.ok(search?.sql.includes('lower(p.first_name) like $'));
    assert.ok(search?.sql.includes('"p"."last_name_key" like $'));
    assert.ok(
      search?.sql.includes('("c"."pcr_number" = $6 or "c"."number" = $7 or "p"."number" = $8)')
    );
    assert.deepEqual(search?.parameters.slice(0, 8), [
      't-1',
      'p-1',
      'ja\\%%',
      'oneil%',
      '1980-01-02',
      '#42',
      42,
      42
    ]);
    await listClaims(db, 't-1', {
      status: 'ready',
      number: 'PCR-7',
      page: 1,
      pageSize: 25,
      sort: 'number',
      dir: 'asc'
    });
    const byPcr = queries.at(-1);
    assert.ok(byPcr?.sql.includes('"c"."status" = $2'));
    assert.ok(byPcr?.sql.includes('"c"."pcr_number" = $3'));
    assert.ok(!byPcr?.sql.includes('"c"."number" ='));
    const [list] = queries;
    assert.ok(list?.sql.includes('"c"."status" not in ('));
    assert.deepEqual(list?.parameters.slice(1, 5), ['paid', 'written_off', 'collections', 'void']);
    assert.ok(
      list?.sql.includes('inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id"')
    );
    assert.ok(
      list?.sql.includes(
        'array((select coalesce(dp.name, cc.payer_name) as "payer" from "claim_coverages" as "cc" left join "payers" as "dp"'
      )
    );
    assert.ok(list?.sql.includes('"c"."tenant_id" = $1'));
    assert.ok(
      list?.sql.endsWith(
        'order by "b"."balance_cents" desc nulls last, "c"."id" desc limit $6 offset $7'
      )
    );
    assert.deepEqual(list?.parameters.slice(-2), [25, 25]);
  });

  it('lists claims with the open task waiting on them, filtered by task type and assignee', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const page = { page: 1, pageSize: 25, sort: 'waiting', dir: 'asc' } as const;
    await listClaims(db, 't-1', { status: 'open', ...page });
    await listClaims(db, 't-1', {
      status: 'open',
      task: 'billing-review',
      assignee: { id: 'u-1' },
      ...page
    });
    await listClaims(db, 't-1', { status: 'all', task: 'any', assignee: { id: null }, ...page });
    const [all, mine, unassigned] = queries;
    assert.ok(all?.sql.includes('left join "patients" as "p" on "p"."id" = "c"."patient_id"'));
    assert.ok(
      all?.sql.includes(
        'left join lateral (select "t"."id", "t"."title", "t"."queue", "t"."kind", "t"."created_at", "u"."email", (count(*) over ())::int as "count" from "tasks" as "t" inner join "claim_runs" as "cr" on "cr"."run_id" = "t"."run_id"'
      )
    );
    assert.ok(all?.sql.includes('"t"."status" = \'open\''));
    assert.ok(
      all?.sql.includes('order by "t"."priority" desc, "t"."created_at" limit 1) as "t" on true')
    );
    assert.ok(!all?.sql.includes('"t"."id" is not null'));
    assert.ok(all?.sql.includes('order by "t"."created_at" asc nulls last'));
    assert.ok(mine?.sql.includes('"t"."queue" = $1 and "t"."assignee_id" = $2'));
    assert.ok(mine?.sql.includes('"t"."id" is not null'));
    assert.deepEqual(mine?.parameters.slice(0, 3), ['billing-review', 'u-1', 't-1']);
    assert.ok(!unassigned?.sql.includes('"t"."queue" ='));
    assert.ok(unassigned?.sql.includes('"t"."assignee_id" is null'));
  });

  it('reads claim, patient and encounter numbers people type, with or without a #', () => {
    assert.deepEqual(['42', '#7', ' 0012 ', 'PCR-1', '99999999999', ''].map(numberOf), [
      42,
      7,
      12,
      null,
      null,
      null
    ]);
  });

  it('finds a claim with its coverages, lines, diagnoses and cycle', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findClaim(db, 't-1', 'c1');
    const [find] = queries;
    assert.ok(
      find?.sql.includes('left join "workflow_runs" as "r" on "r"."id" = "c"."cycle_run_id"')
    );
    assert.ok(find?.sql.includes('from "claim_coverages" as "cc"'));
    assert.ok(find?.sql.includes('order by "l"."position"'));
    assert.ok(find?.sql.includes('from "claim_diagnoses" as "d"'));
    assert.ok(find?.sql.includes('"c"."id" = $'));
    assert.ok(find?.sql.includes('as "assignee_email", "t"."created_at" from "tasks" as "t"'));
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

  it('removes, repositions and adds coverages, then touches the claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await reorderCoverages(db, 't-1', 'c1', {
      keep: [{ id: 'k1', position: 2 }],
      add: [{ payer: 'Aetna Inc.', position: 1 }],
      remove: ['r1']
    });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.ok(
      insert?.sql.includes(
        '(lower(name) = $5 or "id" in (select "payer_id" from "payer_aliases" where "tenant_id" = $6 and "alias_key" = $7))'
      )
    );
    assert.deepEqual(insert?.parameters.slice(3, 7), ['t-1', 'aetna inc.', 't-1', 'aetna inc']);
    assert.deepEqual(
      queries.map((q) => q.sql.split(' ').slice(0, 3).join(' ')),
      [
        'delete from "claim_coverages"',
        'update "claim_coverages" set',
        'insert into "claim_coverages"',
        'update "claims" set'
      ]
    );
  });

  it('reads balances, events with payer names and inserts responses idempotently', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('claim_balances') ? [{ balance_cents: 7 }] : []
    );
    assert.equal(await claimBalance(db, 'c1'), 7);
    await listClaimEvents(db, 'c1');
    await insertResponse(db, 'c1', 'u1', {
      requestId: 'req-1',
      coverageId: null,
      paidCents: 5,
      adjustedCents: 0,
      note: ''
    });
    const [, events, insert] = queries;
    assert.ok(events?.sql.includes('case when e.coverage_id is null then null else coalesce('));
    assert.ok(events?.sql.endsWith('order by "e"."created_at", "e"."id"'));
    assert.ok(insert?.parameters.includes('response'));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
  });
});

describe('claim status sort', () => {
  it('orders statuses the way a claim moves through them', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaims(db, 't-1', {
      status: 'all',
      page: 1,
      pageSize: 25,
      sort: 'status',
      dir: 'asc'
    });
    assert.ok(
      queries[0]?.sql.includes("order by array_position(array['draft', 'needs_review', 'ready'")
    );
  });
});
