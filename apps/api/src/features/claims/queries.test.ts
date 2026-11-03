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
  paidBy,
  reorderCoverages
} from './queries.ts';

describe('claim queries', () => {
  it('pages claim ids by tenant and filters first, then loads details for that page only', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."id", count(*) over ()')
        ? [
            { id: 'c2', total: '30' },
            { id: 'c1', total: '30' }
          ]
        : [
            { id: 'c1', balance_cents: 5 },
            { id: 'c2', balance_cents: 9 }
          ]
    );
    const page = await listClaims(db, 't-1', {
      status: 'open',
      page: 2,
      pageSize: 25,
      sort: 'balance',
      dir: 'desc'
    });
    assert.deepEqual(page, {
      items: [
        { id: 'c2', balance_cents: 9 },
        { id: 'c1', balance_cents: 5 }
      ],
      total: 30,
      page: 2,
      pageSize: 25
    });
    const [ids, details] = queries;
    assert.ok(
      ids?.sql.startsWith(
        'select "c"."id", count(*) over () as "total" from "claims" as "c" left join "patients" as "p"'
      )
    );
    assert.ok(!ids?.sql.includes('lateral'));
    assert.ok(!ids?.sql.includes('array('));
    assert.ok(ids?.sql.includes('"c"."tenant_id" = $1 and "c"."status" not in ('));
    assert.deepEqual(ids?.parameters.slice(1, 5), ['paid', 'written_off', 'collections', 'void']);
    assert.ok(
      ids?.sql.endsWith(
        'order by (select "b"."balance_cents" from "claim_balances" as "b" where "b"."claim_id" = "c"."id") desc nulls last, "c"."id" desc limit $6 offset $7'
      )
    );
    assert.deepEqual(ids?.parameters.slice(-2), [25, 25]);
    assert.ok(
      details?.sql.includes('inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id"')
    );
    assert.ok(
      details?.sql.includes(
        'array((select coalesce(dp.name, cc.payer_name) as "payer" from "claim_coverages" as "cc" left join "payers" as "dp"'
      )
    );
    assert.ok(details?.sql.endsWith('where "c"."tenant_id" = $1 and "c"."id" in ($2, $3)'));
    assert.deepEqual(details?.parameters, ['t-1', 'c2', 'c1']);
  });

  it('skips the detail query when the page is empty and searches patients and numbers', async () => {
    const { db, queries } = createRecordingDb(() => []);
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
    assert.equal(queries.length, 1);
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
  });

  it('lists claims with the open task waiting on them, filtered by task type and assignee', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."id", count(*)') ? [{ id: 'c1', total: '1' }] : []
    );
    const page = { page: 1, pageSize: 25, sort: 'waiting', dir: 'asc' } as const;
    await listClaims(db, 't-1', { status: 'open', ...page });
    await listClaims(db, 't-1', {
      status: 'open',
      task: 'billing-review',
      assignee: { id: 'u-1' },
      ...page
    });
    await listClaims(db, 't-1', { status: 'all', task: 'any', assignee: { id: null }, ...page });
    const [allIds, all, mineIds, mine, unassignedIds] = queries;
    assert.ok(!allIds?.sql.includes('exists'));
    assert.ok(
      allIds?.sql.includes(
        'order by (select "t"."created_at" from "tasks" as "t" inner join "claim_runs" as "cr" on "cr"."run_id" = "t"."run_id"'
      )
    );
    assert.ok(
      allIds?.sql.includes('order by "t"."priority" desc, "t"."created_at" limit 1) asc nulls last')
    );
    assert.ok(
      all?.sql.includes(
        'left join lateral (select "t"."id", "t"."title", "t"."queue", "t"."kind", "t"."created_at", "u"."email", (count(*) over ())::int as "count" from "tasks" as "t" inner join "claim_runs" as "cr" on "cr"."run_id" = "t"."run_id"'
      )
    );
    assert.ok(all?.sql.includes('"t"."status" = \'open\''));
    assert.ok(
      all?.sql.includes('order by "t"."priority" desc, "t"."created_at" limit 1) as "t" on true')
    );
    assert.ok(mineIds?.sql.includes('and exists (select "t"."id" from "tasks" as "t"'));
    assert.ok(mineIds?.sql.includes('"t"."queue" = $2 and "t"."assignee_id" = $3'));
    assert.deepEqual(mineIds?.parameters.slice(0, 3), ['t-1', 'billing-review', 'u-1']);
    assert.ok(mine?.sql.includes('"t"."queue" = $1 and "t"."assignee_id" = $2'));
    assert.deepEqual(mine?.parameters.slice(0, 3), ['billing-review', 'u-1', 't-1']);
    assert.ok(!unassignedIds?.sql.includes('"t"."queue" ='));
    assert.ok(unassignedIds?.sql.includes('"t"."assignee_id" is null'));
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
    assert.ok(find?.sql.includes('"c"."trip_type"'));
    assert.ok(
      find?.sql.includes('"cc"."relationship", "cc"."insured_first_name", "cc"."insured_last_name"')
    );
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
      add: [
        {
          payer: 'Aetna Inc.',
          position: 1,
          relationship: '01',
          insuredFirstName: 'Sam',
          insuredLastName: 'Doe'
        }
      ],
      remove: ['r1']
    });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.match(
      insert?.sql ?? '',
      /\(lower\(name\) = \$\d+ or "id" in \(select "payer_id" from "payer_aliases" where "tenant_id" = \$\d+ and "alias_key" = \$\d+\)\)/
    );
    assert.ok(insert?.parameters.includes('aetna inc'));
    assert.ok(insert?.sql.includes('"tenant_id", "position", "payer_name", "relationship"'));
    assert.deepEqual(insert?.parameters.slice(0, 7), [
      'c1',
      't-1',
      1,
      'Aetna Inc.',
      '01',
      'Sam',
      'Doe'
    ]);
    assert.deepEqual(
      queries.map((q) => q.sql.trim().split(/\s+/).slice(0, 3).join(' ')),
      [
        'delete from "claim_coverages"',
        'update claim_coverages cc',
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
    await listClaimEvents(db, 'c1', { page: 1, pageSize: 25, sort: 'amount', dir: 'asc' });
    const inserted = await insertResponse(db, 'c1', 'u1', {
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
    });
    assert.equal(inserted, false);
    assert.equal(queries.length, 3);
    const [, events, insert] = queries;
    assert.ok(events?.sql.includes('case when e.coverage_id is null then null else coalesce('));
    assert.ok(
      events?.sql.includes('order by e.paid_cents + e.adjusted_cents asc nulls last, "e"."id" asc')
    );
    assert.ok(events?.sql.includes('count(*) over ()'));
    assert.ok(
      events?.sql.includes(
        'select "a"."group_code" as "group", "a"."reason_code" as "reason", "a"."amount_cents" as "cents" from "claim_event_adjustments" as "a"'
      )
    );
    assert.ok(insert?.parameters.includes('response'));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    assert.ok(!insert?.parameters.includes('ignored without a payer'));
  });

  it('sums what a payer or the patient paid, for refunds', async () => {
    const { db, queries } = createRecordingDb(() => [{ paid: 900 }]);
    assert.equal(await paidBy(db, 'c1', 'cov1'), 900);
    await paidBy(db, 'c1', null);
    assert.ok(queries[0]?.sql.endsWith('"claim_id" = $1 and "coverage_id" = $2'));
    assert.ok(queries[1]?.sql.endsWith('"coverage_id" is null'));
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
