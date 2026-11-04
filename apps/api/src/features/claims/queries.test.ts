import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  claimExists,
  findClaim,
  findEventDocument,
  hasActiveRun,
  listClaimEvents,
  listClaimFiles,
  listClaimPayerFiles,
  listClaims,
  numberOf,
  reorderCoverages,
  setCycleRun
} from './queries.ts';

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
      /\(lower\(name\) = \$\d+ or "id" in \(select "payer_id" from "payer_aliases" where "agency_id" = \$\d+ and "alias_key" = \$\d+\)\)/
    );
    assert.ok(insert?.parameters.includes('aetna inc'));
    assert.ok(insert?.sql.includes('"agency_id", "position", "payer_name", "relationship"'));
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

  it('reads events with payer names, amounts and reason codes', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaimEvents(db, 'c1', { page: 1, pageSize: 25, sort: 'amount', dir: 'asc' });
    const [events] = queries;
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
  });

  it('lists the payer files that touched a claim with only the lines for that claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listClaimPayerFiles(db, 'c1'), []);
    const [q] = queries;
    assert.ok(q?.sql.includes('from "payer_files" as "f"'));
    assert.ok(q?.sql.includes('where exists (select "fi"."id" from "payer_file_items" as "fi"'));
    assert.deepEqual(q?.parameters, ['c1', 'c1']);
    await db.destroy();
  });

  it('names the import a claim came from', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findClaim(db, 't1', 'c1');
    assert.ok(queries.some((q) => q.sql.includes('left join "imports" as "i"')));
    await db.destroy();
  });

  it('checks claims, documents and the claim found by id within the agency only', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findClaim(db, 't-1', 'c1');
    assert.equal(await claimExists(db, 't-1', 'c1'), false);
    assert.equal(await findEventDocument(db, 't-1', 'c1', 'e1'), null);
    const [find, exists, document] = queries;
    assert.ok(find?.sql.includes('"c"."agency_id" = $'));
    assert.ok(find?.parameters.includes('t-1') && find.parameters.includes('c1'));
    assert.ok(exists?.sql.endsWith('where "id" = $1 and "agency_id" = $2'));
    assert.deepEqual(exists?.parameters, ['c1', 't-1']);
    assert.ok(document?.sql.includes('"c"."agency_id" = $3 and "e"."document" is not null'));
    assert.deepEqual(document?.parameters, ['e1', 'c1', 't-1']);
    await db.destroy();
  });

  it('finds active runs of a claim and links a new cycle run to it', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claim_runs" as "cr"') ? [{ id: 'r1' }] : []
    );
    assert.equal(await hasActiveRun(db, 'c1'), true);
    await setCycleRun(db, 'c1', 'r2');
    const [active, link, cycle] = queries;
    assert.ok(active?.sql.includes('"r"."status" in ('));
    assert.equal(active?.parameters[0], 'c1');
    assert.deepEqual(link?.parameters, ['r2', 'c1']);
    assert.ok(cycle?.sql.startsWith('update "claims" set "cycle_run_id" = $1'));
    assert.deepEqual(cycle?.parameters, ['r2', 'c1']);
    await db.destroy();
  });

  it('lists the claim files that carry a batch or a document in order', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listClaimFiles(db, 'c1'), []);
    const [files] = queries;
    assert.ok(files?.sql.includes('("e"."batch_id" is not null or "e"."document" is not null)'));
    assert.ok(files?.sql.endsWith('order by "e"."created_at", "e"."id"'));
    assert.deepEqual(files?.parameters, ['c1']);
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
