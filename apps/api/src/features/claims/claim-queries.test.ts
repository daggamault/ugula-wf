import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { claimExists, findClaim, listClaims } from './claim-queries.ts';

describe('claim queries', () => {
  it('pages claim ids by agency and filters first, then loads details for that page only', async () => {
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
    assert.ok(ids?.sql.includes('"c"."agency_id" = $1 and "c"."status" not in ('));
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
    assert.ok(details?.sql.endsWith('where "c"."agency_id" = $1 and "c"."id" in ($2, $3)'));
    assert.deepEqual(details?.parameters, ['t-1', 'c2', 'c1']);
  });

  it('skips the detail query when the page is empty and searches patients and numbers', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaims(db, 't-1', {
      status: 'all',
      firstName: 'Ja%',
      lastName: "O'Neil",
      birthDate: '1980-01-02',
      number: '#202611050042',
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
      search?.sql.includes(
        '("c"."pcr_number" = $6 or "c"."number" = $7 or "p"."number" = $8 or "ir"."number" = $9)'
      )
    );
    assert.ok(
      search?.sql.includes(
        'left join "import_reports" as "ir" on "ir"."id" = "c"."import_report_id"'
      )
    );
    assert.deepEqual(search?.parameters.slice(0, 9), [
      't-1',
      'p-1',
      'ja\\%%',
      'oneil%',
      '1980-01-02',
      '#202611050042',
      '20261105-0042',
      '20261105-0042',
      '20261105-0042'
    ]);
    await listClaims(db, 't-1', {
      status: 'open',
      number: 'PCR-7',
      page: 1,
      pageSize: 25,
      sort: 'number',
      dir: 'asc'
    });
    const byPcr = queries.at(-1);
    assert.ok(byPcr?.sql.includes('"c"."status" not in ('));
    assert.ok(byPcr?.sql.includes('"c"."pcr_number" = $'));
    assert.ok(!byPcr?.sql.includes('"c"."number" ='));
    assert.ok(!byPcr?.sql.includes('"ir"."number" ='));
  });

  it('lists open claims oldest task first with the open task waiting on them', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."id", count(*)') ? [{ id: 'c1', total: '1' }] : []
    );
    await listClaims(db, 't-1', {
      status: 'open',
      page: 1,
      pageSize: 25,
      sort: 'waiting',
      dir: 'asc'
    });
    const [allIds, all] = queries;
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
    assert.ok(find?.sql.includes('"c"."classification"'));
    assert.ok(
      find?.sql.includes('"cc"."relationship", "cc"."insured_first_name", "cc"."insured_last_name"')
    );
    assert.ok(find?.sql.includes('"c"."id" = $'));
    assert.ok(
      find?.sql.includes('as "assignee_email", "t"."due_at", "t"."created_at" from "tasks" as "t"')
    );
    assert.ok(find?.sql.includes('"cc"."stay_kind"'));
  });

  it('names the import a claim came from', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findClaim(db, 't1', 'c1');
    assert.ok(queries.some((q) => q.sql.includes('left join "imports" as "i"')));
    await db.destroy();
  });

  it('checks claims and the claim found by id within the agency only', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findClaim(db, 't-1', 'c1');
    assert.equal(await claimExists(db, 't-1', 'c1'), false);
    const [find, exists] = queries;
    assert.ok(find?.sql.includes('"c"."agency_id" = $'));
    assert.ok(find?.parameters.includes('t-1') && find.parameters.includes('c1'));
    assert.ok(exists?.sql.endsWith('where "id" = $1 and "agency_id" = $2'));
    assert.deepEqual(exists?.parameters, ['c1', 't-1']);
    await db.destroy();
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

describe('claim encounter numbers', () => {
  it('shows each claim with the encounter number it was imported from and sorts by it', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."id", count(*)') ? [{ id: 'c1', total: '1' }] : []
    );
    await listClaims(db, 't-1', {
      status: 'all',
      page: 1,
      pageSize: 25,
      sort: 'encounter',
      dir: 'desc'
    });
    const [ids, details] = queries;
    assert.ok(
      ids?.sql.includes(
        'order by (select "er"."number" from "import_reports" as "er" where "er"."id" = "c"."import_report_id") desc nulls last'
      )
    );
    assert.ok(
      details?.sql.includes(
        '(select "er"."number" from "import_reports" as "er" where "er"."id" = "c"."import_report_id") as "encounter_number"'
      )
    );
  });
});
