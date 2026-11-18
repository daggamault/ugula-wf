import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findClaim, searchClaims } from './queries.ts';

const PAGE = {
  page: 1,
  pageSize: 25,
  sort: 'created',
  dir: 'desc',
  status: []
} as const;

const NO_FACETS = { status: [] };

const isFacet = (sql: string) => sql.includes('group by 1');

const listOf = <Q extends { sql: string }>(queries: readonly Q[]) =>
  queries.filter((q) => !isFacet(q.sql));

const CLAIM_IDS =
  'select "c"."id", count(*) over () as "total" from "claims" as "c" ' +
  'inner join "patients" as "p" on "p"."id" = "c"."patient_id" ' +
  'inner join "encounters" as "e" on "e"."id" = "c"."encounter_id" ' +
  'where "c"."agency_id" = $1';

describe('searchClaims', () => {
  it('pages claim ids by agency and filters first, then loads details for that page only', async () => {
    const { db, queries } = createRecordingDb((q) =>
      isFacet(q.sql)
        ? []
        : q.sql.startsWith('select "c"."id", count(*) over ()')
          ? [
              { id: 'c2', total: '30' },
              { id: 'c1', total: '30' }
            ]
          : [
              { id: 'c1', total_cents: 5 },
              { id: 'c2', total_cents: 9 }
            ]
    );
    assert.deepEqual(
      await searchClaims(db, 't-1', {
        ...PAGE,
        status: ['needs_review'],
        page: 2,
        sort: 'total'
      }),
      {
        items: [
          { id: 'c2', total_cents: 9 },
          { id: 'c1', total_cents: 5 }
        ],
        total: 30,
        page: 2,
        pageSize: 25,
        facets: NO_FACETS
      }
    );
    const [ids, details] = listOf(queries);
    assert.equal(
      ids?.sql,
      `${CLAIM_IDS} and "c"."status" in ($2) order by "c"."total_cents" desc nulls last, ` +
        '"c"."id" desc limit $3 offset $4'
    );
    assert.deepEqual(ids?.parameters, ['t-1', 'needs_review', 25, 25]);
    assert.ok(
      details?.sql.includes(
        'array((select coalesce(dp.name, cc.payer_name) as "payer" from "claim_coverages" as "cc" left join "payers" as "dp"'
      )
    );
    assert.ok(details?.sql.includes('"e"."number" as "encounter_number"'));
    assert.ok(details?.sql.endsWith('where "c"."agency_id" = $1 and "c"."id" in ($2, $3)'));
    assert.deepEqual(details?.parameters, ['t-1', 'c2', 'c1']);
  });

  it('counts statuses under the search', async () => {
    const { db, queries } = createRecordingDb((q) =>
      isFacet(q.sql) ? [{ value: 'needs_review', label: null, count: '4' }] : []
    );
    const page = await searchClaims(db, 't-1', { ...PAGE, lastName: 'Smith' });
    assert.deepEqual(page.facets, { status: [{ value: 'needs_review', count: 4 }] });
    const facet = (by: string) =>
      `select ${by}::text as "value", null as "label", count(*) as "count" from "claims" as "c" ` +
      'inner join "patients" as "p" on "p"."id" = "c"."patient_id" ' +
      'inner join "encounters" as "e" on "e"."id" = "c"."encounter_id" ' +
      'where "c"."agency_id" = $1 and "p"."last_name_key" like $2';
    assert.deepEqual(
      queries.filter((q) => isFacet(q.sql)).map((q) => [q.sql, q.parameters]),
      [
        [
          `${facet('"c"."status"')} and "c"."status" is not null ` +
            'group by 1 order by count(*) desc, 1 limit $3',
          ['t-1', 'smith%', 200]
        ]
      ]
    );
  });

  it('drops a paged claim whose details are no longer there', async () => {
    const { db } = createRecordingDb((q) =>
      isFacet(q.sql)
        ? []
        : q.sql.startsWith('select "c"."id", count(*) over ()')
          ? [
              { id: 'c1', total: '2' },
              { id: 'c2', total: '2' }
            ]
          : [{ id: 'c2' }]
    );
    assert.deepEqual(await searchClaims(db, 't-1', { ...PAGE }), {
      items: [{ id: 'c2' }],
      total: 2,
      page: 1,
      pageSize: 25,
      facets: NO_FACETS
    });
  });

  it('skips the detail query when the page is empty', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await searchClaims(db, 't-1', { ...PAGE }), {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      facets: NO_FACETS
    });
    assert.deepEqual(
      listOf(queries).map((q) => [q.sql, q.parameters]),
      [
        [
          `${CLAIM_IDS} order by "c"."created_at" desc nulls last, "c"."id" desc limit $2 offset $3`,
          ['t-1', 25, 0]
        ]
      ]
    );
  });

  it('searches by patient, escaped first name, last name key, birth date and every number', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchClaims(db, 't-1', {
      ...PAGE,
      firstName: 'Ja%',
      lastName: "O'Neil",
      birthDate: '1980-01-02',
      number: '#202611050042',
      patientId: 'p-1'
    });
    assert.deepEqual(
      listOf(queries).map((q) => [q.sql, q.parameters]),
      [
        [
          `${CLAIM_IDS} and "c"."patient_id" = $2 and lower(p.first_name) like $3 ` +
            'and "p"."last_name_key" like $4 and "p"."birth_date" = $5 and ' +
            '("e"."pcr_number" = $6 or "c"."number" = $7 or "p"."number" = $8 or "e"."number" = $9) ' +
            'order by "c"."created_at" desc nulls last, "c"."id" desc limit $10 offset $11',
          [
            't-1',
            'p-1',
            'ja\\%%',
            'oneil%',
            '1980-01-02',
            '#202611050042',
            '20261105-0042',
            '20261105-0042',
            '20261105-0042',
            25,
            0
          ]
        ]
      ]
    );
  });

  it('matches only the PCR number for text that is not a daily number and ignores a name without letters', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchClaims(db, 't-1', { ...PAGE, number: 'PCR-7', lastName: "'-" });
    assert.deepEqual(
      listOf(queries).map((q) => [q.sql, q.parameters]),
      [
        [
          `${CLAIM_IDS} and "e"."pcr_number" = $2 order by "c"."created_at" desc nulls last, ` +
            '"c"."id" desc limit $3 offset $4',
          ['t-1', 'PCR-7', 25, 0]
        ]
      ]
    );
  });

  it('orders statuses the way a claim moves through them', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchClaims(db, 't-1', { ...PAGE, sort: 'status', dir: 'asc' });
    assert.equal(
      listOf(queries)[0]?.sql,
      `${CLAIM_IDS} order by array_position(array['needs_review', 'approved', 'on_hold', 'submitted', 'rejected', 'denied', 'patient_balance', 'closed']::text[], c.status::text) ` +
        'asc nulls last, "c"."id" asc limit $2 offset $3'
    );
  });

  it('orders by the encounter number a claim was imported from and by patient name', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchClaims(db, 't-1', { ...PAGE, sort: 'encounter' });
    await searchClaims(db, 't-1', { ...PAGE, sort: 'patient' });
    assert.deepEqual(
      listOf(queries).map((q) => q.sql),
      [
        `${CLAIM_IDS} order by "e"."number" desc nulls last, "c"."id" desc limit $2 offset $3`,
        `${CLAIM_IDS} order by lower(p.last_name || ' ' || p.first_name) desc nulls last, ` +
          '"c"."id" desc limit $2 offset $3'
      ]
    );
  });
});

describe('findClaim', () => {
  it('finds a claim by id within the agency only', async () => {
    const claim = { id: 'c1' };
    const { db, queries } = createRecordingDb(() => [claim]);
    assert.deepEqual(await findClaim(db, 't-1', 'c1'), claim);
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.sql.endsWith('where "c"."agency_id" = $3 and "c"."id" = $4'));
    assert.deepEqual(queries[0]?.parameters, [1, 1, 't-1', 'c1']);
  });

  it('reads the encounter, its latest import and 837P sent, coverages, lines and diagnoses', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findClaim(db, 't-1', 'c1'), undefined);
    const sql = queries[0]?.sql ?? '';
    for (const part of [
      '"e"."data" as "encounter"',
      'inner join "imports" as "i" on "i"."id" = "ir"."import_id" where "ir"."encounter_id" = "e"."id"',
      'from "claim_submissions" as "s" where "s"."claim_id" = "c"."id" and "s"."sent_at" is not null order by "s"."sent_at" desc',
      '"cc"."relationship", "cc"."insured_first_name", "cc"."insured_last_name", "cc"."status", "cc"."payer_claim_number", "cc"."status_note"',
      '"l"."modifiers", "l"."units", "l"."unit_cents", "l"."total_cents" from "claim_lines" as "l" where "l"."claim_id" = "c"."id" order by "l"."position"',
      'array((select "d"."code" from "claim_diagnoses" as "d" where "d"."claim_id" = "c"."id" order by "d"."position")) as "diagnoses"'
    ]) {
      assert.ok(sql.includes(part), part);
    }
  });
});
