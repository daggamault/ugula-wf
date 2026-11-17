import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  claimExists,
  findClaim,
  findClaimDocument,
  findEventDocument,
  listClaimDocuments,
  listClaimEvents,
  listClaimFiles,
  listClaimPayerFiles,
  searchClaims
} from './queries.ts';

const PAGE = { page: 1, pageSize: 25, sort: 'created', dir: 'desc' } as const;

const CLAIM_IDS =
  'select "c"."id", count(*) over () as "total" from "claims" as "c" ' +
  'left join "patients" as "p" on "p"."id" = "c"."patient_id" ' +
  'left join "import_reports" as "ir" on "ir"."id" = "c"."import_report_id" ' +
  'where "c"."agency_id" = $1';

const OPEN_TASKS =
  'from "tasks" as "t" inner join "claim_runs" as "cr" on "cr"."run_id" = "t"."run_id" ' +
  'left join "users" as "u" on "u"."id" = "t"."assignee_id" ' +
  'where "t"."status" = \'open\' and "cr"."claim_id" = "c"."id" ' +
  'order by "t"."priority" desc, "t"."created_at"';

const EVENT_ROWS =
  'select "e"."id", "e"."kind", "e"."batch_id", "cb"."control_number" as "batch_number", ' +
  '"cb"."sent_at" as "batch_sent_at", "e"."coverage_id", ' +
  'case when e.coverage_id is null then null else coalesce(dp.name, cc.payer_name) end as "payer", ' +
  '"e"."paid_cents", "e"."adjusted_cents", "e"."paid_on", "e"."check_number", ' +
  '"e"."payer_claim_number", "e"."note", "e"."created_at", ' +
  "nullif(concat_ws(' ', eu.first_name, eu.last_name), '') as \"by\", " +
  '"t"."title" as "task_title", t.resolution->>\'outcome\' as "task_outcome", ' +
  '"t"."fields" as "task_fields", "t"."defaults" as "task_defaults", ' +
  't.resolution->\'values\' as "task_values", ' +
  'e.document is not null as "has_document", ' +
  '(select coalesce(json_agg(agg), \'[]\') from (select "a"."group_code" as "group", ' +
  '"a"."reason_code" as "reason", "a"."amount_cents" as "cents", "d"."description" ' +
  'from "claim_event_adjustments" as "a" left join "codes" as "d" on "d"."code_set" = $1 ' +
  'and "d"."code" = "a"."reason_code" where "a"."event_id" = "e"."id" order by "a"."position") ' +
  'as agg) as "adjustments", (select coalesce(json_agg(agg), \'[]\') from (select "r"."code", ' +
  '"d"."description" from "claim_event_remarks" as "r" left join "codes" as "d" ' +
  'on "d"."code_set" = $2 and "d"."code" = "r"."code" where "r"."event_id" = "e"."id" ' +
  'order by "r"."position") as agg) as "remarks"';

const EVENT_JOINS =
  'from "claim_events" as "e" left join "claim_coverages" as "cc" on "cc"."id" = "e"."coverage_id" ' +
  'left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" ' +
  'left join "claim_batches" as "cb" on "cb"."id" = "e"."batch_id" ' +
  'left join "users" as "eu" on "eu"."id" = "e"."created_by_id" ' +
  'left join "tasks" as "t" on "t"."id" = "e"."task_id"';

const idsOf = (rows: { id: string }[], total: number) =>
  createRecordingDb((q) =>
    q.sql.startsWith('select "c"."id", count(*) over ()')
      ? rows.map((r) => ({ ...r, total: String(total) }))
      : []
  );

describe('searchClaims', () => {
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
    assert.deepEqual(
      await searchClaims(db, 't-1', { ...PAGE, status: 'open', page: 2, sort: 'balance' }),
      {
        items: [
          { id: 'c2', balance_cents: 9 },
          { id: 'c1', balance_cents: 5 }
        ],
        total: 30,
        page: 2,
        pageSize: 25
      }
    );
    const [ids, details] = queries;
    assert.equal(
      ids?.sql,
      `${CLAIM_IDS} and "c"."status" not in ($2, $3, $4, $5) order by (select "b"."balance_cents" ` +
        'from "claim_balances" as "b" where "b"."claim_id" = "c"."id") desc nulls last, ' +
        '"c"."id" desc limit $6 offset $7'
    );
    assert.deepEqual(ids?.parameters, [
      't-1',
      'paid',
      'written_off',
      'collections',
      'void',
      25,
      25
    ]);
    assert.ok(
      details?.sql.includes('inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id"')
    );
    assert.ok(
      details?.sql.includes(
        'array((select coalesce(dp.name, cc.payer_name) as "payer" from "claim_coverages" as "cc" left join "payers" as "dp"'
      )
    );
    assert.ok(
      details?.sql.includes(
        `left join lateral (select "t"."id", "t"."title", "t"."queue", "t"."kind", "t"."created_at", "u"."email", (count(*) over ())::int as "count" ${OPEN_TASKS} limit 1) as "t" on true`
      )
    );
    assert.ok(
      details?.sql.includes(
        '(select "er"."number" from "import_reports" as "er" where "er"."id" = "c"."import_report_id") as "encounter_number"'
      )
    );
    assert.ok(details?.sql.endsWith('where "c"."agency_id" = $1 and "c"."id" in ($2, $3)'));
    assert.deepEqual(details?.parameters, ['t-1', 'c2', 'c1']);
  });

  it('drops a paged claim whose details are no longer there', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."id", count(*) over ()')
        ? [
            { id: 'c1', total: '2' },
            { id: 'c2', total: '2' }
          ]
        : [{ id: 'c2' }]
    );
    assert.deepEqual(await searchClaims(db, 't-1', { ...PAGE, status: 'all' }), {
      items: [{ id: 'c2' }],
      total: 2,
      page: 1,
      pageSize: 25
    });
  });

  it('skips the detail query when the page is empty', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await searchClaims(db, 't-1', { ...PAGE, status: 'all' }), {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
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
      status: 'all',
      firstName: 'Ja%',
      lastName: "O'Neil",
      birthDate: '1980-01-02',
      number: '#202611050042',
      patientId: 'p-1'
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${CLAIM_IDS} and "c"."patient_id" = $2 and lower(p.first_name) like $3 ` +
            'and "p"."last_name_key" like $4 and "p"."birth_date" = $5 and ' +
            '("c"."pcr_number" = $6 or "c"."number" = $7 or "p"."number" = $8 or "ir"."number" = $9) ' +
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
    await searchClaims(db, 't-1', { ...PAGE, status: 'all', number: 'PCR-7', lastName: "'-" });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${CLAIM_IDS} and "c"."pcr_number" = $2 order by "c"."created_at" desc nulls last, ` +
            '"c"."id" desc limit $3 offset $4',
          ['t-1', 'PCR-7', 25, 0]
        ]
      ]
    );
  });

  it('orders claims by their oldest open task', async () => {
    const { db, queries } = idsOf([{ id: 'c1' }], 1);
    await searchClaims(db, 't-1', { ...PAGE, status: 'all', sort: 'waiting', dir: 'asc' });
    assert.equal(
      queries[0]?.sql,
      `${CLAIM_IDS} order by (select "t"."created_at" ${OPEN_TASKS} limit 1) asc nulls last, ` +
        '"c"."id" asc limit $2 offset $3'
    );
  });

  it('orders statuses the way a claim moves through them', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchClaims(db, 't-1', { ...PAGE, status: 'all', sort: 'status', dir: 'asc' });
    assert.equal(
      queries[0]?.sql,
      `${CLAIM_IDS} order by array_position(array['draft', 'needs_review', 'ready', 'submitted', ` +
        "'follow_up', 'reconcile', 'denied', 'facility_billing', 'patient_balance', " +
        "'balance_review', 'paid', 'written_off', 'collections', 'void']::text[], c.status::text) " +
        'asc nulls last, "c"."id" asc limit $2 offset $3'
    );
  });

  it('orders by the encounter number a claim was imported from and by patient name', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchClaims(db, 't-1', { ...PAGE, status: 'all', sort: 'encounter' });
    await searchClaims(db, 't-1', { ...PAGE, status: 'all', sort: 'patient' });
    assert.deepEqual(
      queries.map((q) => q.sql),
      [
        `${CLAIM_IDS} order by (select "er"."number" from "import_reports" as "er" where ` +
          '"er"."id" = "c"."import_report_id") desc nulls last, "c"."id" desc limit $2 offset $3',
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
    assert.ok(queries[0]?.sql.endsWith('where "c"."agency_id" = $1 and "c"."id" = $2'));
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'c1']);
  });

  it('reads the cycle, import, facility, coverages, lines, diagnoses and open tasks', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findClaim(db, 't-1', 'c1'), undefined);
    const sql = queries[0]?.sql ?? '';
    for (const part of [
      'left join "workflow_runs" as "r" on "r"."id" = "c"."cycle_run_id"',
      'left join "imports" as "i" on "i"."id" = "ir"."import_id"',
      'left join "facilities" as "f" on "f"."id" = "c"."facility_id"',
      '"r"."status" as "cycle_status"',
      '"cc"."relationship", "cc"."insured_first_name", "cc"."insured_last_name"',
      '"cc"."stay_kind", "cc"."stay_admitted_on", "cc"."stay_discharged_on" from "claim_coverages" as "cc"',
      'from "claim_lines" as "l" where "l"."claim_id" = "c"."id" order by "l"."position"',
      'array((select "d"."code" from "claim_diagnoses" as "d" where "d"."claim_id" = "c"."id" order by "d"."position")) as "diagnoses"',
      `"u"."email" as "assignee_email", "t"."due_at", "t"."created_at" ${OPEN_TASKS}) as agg) as "tasks"`
    ]) {
      assert.ok(sql.includes(part), part);
    }
  });
});

describe('claimExists', () => {
  it('checks the claim by id within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'c1' }]);
    assert.equal(await claimExists(db, 't-1', 'c1'), true);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [['select "id" from "claims" where "id" = $1 and "agency_id" = $2', ['c1', 't-1']]]
    );
  });

  it('reports a claim outside the agency as missing', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await claimExists(db, 't-1', 'c1'), false);
  });
});

describe('claim document queries', () => {
  it('lists the documents of a claim with who uploaded them, oldest first', async () => {
    const doc = { id: 'd1', uploaded_by_email: 'dev@example.com' };
    const { db, queries } = createRecordingDb(() => [doc]);
    assert.deepEqual(await listClaimDocuments(db, 'c1'), [doc]);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "d"."id", "d"."kind", "d"."file_name", "d"."signed_on", "d"."created_at", ' +
            '"u"."email" as "uploaded_by_email" from "claim_documents" as "d" ' +
            'left join "users" as "u" on "u"."id" = "d"."uploaded_by_id" ' +
            'where "d"."claim_id" = $1 order by "d"."created_at", "d"."id"',
          ['c1']
        ]
      ]
    );
  });

  it('finds a document of the claim within the agency', async () => {
    const doc = { document: 'key', file_name: 'pcs.pdf' };
    const { db, queries } = createRecordingDb(() => [doc]);
    assert.deepEqual(await findClaimDocument(db, 't-1', 'c1', 'd1'), doc);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "document", "file_name" from "claim_documents" where "id" = $1 ' +
            'and "claim_id" = $2 and "agency_id" = $3',
          ['d1', 'c1', 't-1']
        ]
      ]
    );
  });

  it('finds no document outside the claim or agency', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findClaimDocument(db, 't-1', 'c1', 'd1'), null);
  });
});

describe('claim event queries', () => {
  it('pages events with payer names, amounts, and described reason and remark codes', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(
      await listClaimEvents(db, 'c1', { page: 2, pageSize: 10, sort: 'payer', dir: 'asc' }),
      { items: [], total: 0, page: 2, pageSize: 10 }
    );
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${EVENT_ROWS}, count(*) over () as "total" ${EVENT_JOINS} where "e"."claim_id" = $3 ` +
            'order by lower(case when e.coverage_id is null then null else ' +
            'coalesce(dp.name, cc.payer_name) end) asc nulls last, "e"."id" asc limit $4 offset $5',
          ['carc', 'rarc', 'c1', 10, 10]
        ],
        [`select count(*) as "total" ${EVENT_JOINS} where "e"."claim_id" = $1`, ['c1']]
      ]
    );
  });

  it('orders events by their paid and adjusted amount', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaimEvents(db, 'c1', { page: 1, pageSize: 25, sort: 'amount', dir: 'desc' });
    assert.ok(
      queries[0]?.sql.endsWith(
        'order by e.paid_cents + e.adjusted_cents desc nulls last, "e"."id" desc limit $4 offset $5'
      )
    );
  });

  it('lists the claim files that carry a batch or a document in order', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listClaimFiles(db, 'c1'), []);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${EVENT_ROWS} ${EVENT_JOINS} where "e"."claim_id" = $3 and ` +
            '("e"."batch_id" is not null or "e"."document" is not null) ' +
            'order by "e"."created_at", "e"."id"',
          ['carc', 'rarc', 'c1']
        ]
      ]
    );
  });

  it('lists the payer files that touched a claim with only the lines for that claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listClaimPayerFiles(db, 'c1'), []);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "f"."id", "f"."kind", "f"."file_name", "f"."created_at", ' +
            '(select coalesce(json_agg(agg), \'[]\') from (select "fi"."outcome", "fi"."message" ' +
            'from "payer_file_items" as "fi" where "fi"."file_id" = "f"."id" and ' +
            '"fi"."claim_id" = $1 order by "fi"."position") as agg) as "items" ' +
            'from "payer_files" as "f" where exists (select "fi"."id" from "payer_file_items" as "fi" ' +
            'where "fi"."file_id" = "f"."id" and "fi"."claim_id" = $2) order by "f"."created_at", "f"."id"',
          ['c1', 'c1']
        ]
      ]
    );
  });

  it('finds an event document of the claim within the agency', async () => {
    const doc = { document: 'key', kind: 'payment' };
    const { db, queries } = createRecordingDb(() => [doc]);
    assert.deepEqual(await findEventDocument(db, 't-1', 'c1', 'e1'), doc);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "e"."document", "e"."kind" from "claim_events" as "e" inner join "claims" as "c" ' +
            'on "c"."id" = "e"."claim_id" where "e"."id" = $1 and "c"."id" = $2 and ' +
            '"c"."agency_id" = $3 and "e"."document" is not null',
          ['e1', 'c1', 't-1']
        ]
      ]
    );
  });

  it('finds no event document when the event has none or is outside the agency', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findEventDocument(db, 't-1', 'c1', 'e1'), null);
  });
});
