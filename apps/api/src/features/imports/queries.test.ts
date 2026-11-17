import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveWorkflowVersion } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import {
  findDictionary,
  findImport,
  findReport,
  findSftpAgency,
  insertImport,
  listImportReports,
  searchImports
} from './queries.ts';

const IMPORT_COLUMNS =
  'select "i"."id", "i"."file_name", "i"."source", "i"."report_count", "i"."created_at", "i"."run_id", "r"."status" as "run_status", "u"."email" as "uploaded_by_email", "reports"."completed", "reports"."waiting", "reports"."stuck", "reports"."failed", "reports"."processing", "claimed"."claims", "claimed"."charges_cents"';
const IMPORT_FROM =
  'from "imports" as "i" inner join "workflow_runs" as "r" on "r"."id" = "i"."run_id" left join "users" as "u" on "u"."id" = "i"."uploaded_by_id" left join lateral (select (count(*) filter (where ch.status = $1))::int as "completed", (count(*) filter (where ch.status = $2))::int as "waiting", (count(*) filter (where ch.status = $3))::int as "stuck", (count(*) filter (where ch.status = $4))::int as "failed", (count(*) filter (where ch.status = $5))::int as "processing" from "workflow_runs" as "ch" where "ch"."parent_id" = "i"."run_id") as "reports" on true left join lateral (select count(*)::int as "claims", coalesce(sum(c.total_cents), 0)::float8 as "charges_cents" from "claims" as "c" inner join "import_reports" as "ir" on "ir"."id" = "c"."import_report_id" where "ir"."import_id" = "i"."id" and "c"."status" <> $6) as "claimed" on true where "i"."agency_id" = $7';
const STATUSES = ['completed', 'suspended', 'faulted', 'failed', 'running', 'void'];

const REPORT_COLUMNS =
  'select "ir"."id", "ir"."position", "ir"."number", "ir"."pcr_number", "r"."status" as "run_status", "c"."id" as "claim_id", "c"."status" as "claim_status", "c"."total_cents", "p"."first_name", "p"."last_name", "t"."id" as "task_id", "t"."title" as "task_title", "t"."subject" as "task_subject", "t"."kind" as "task_kind"';
const REPORT_FROM = `from "import_reports" as "ir" inner join "imports" as "i" on "i"."id" = "ir"."import_id" left join "workflow_runs" as "r" on "r"."parent_id" = "i"."run_id" and r.inputs -> 'report' ->> 'key' = ir.report_key left join "claim_runs" as "cr" on "cr"."run_id" = "r"."id" left join "claims" as "c" on "c"."id" = "cr"."claim_id" left join "patients" as "p" on "p"."id" = "c"."patient_id" left join lateral (select "t"."id", "t"."title", "t"."subject", "t"."kind" from "tasks" as "t" where "t"."run_id" = "r"."id" and "t"."status" = $1 order by "t"."created_at" limit $2) as "t" on true where "i"."agency_id" = $3 and "i"."id" = $4`;

describe('resolveWorkflowVersion', () => {
  it('takes the newest version number of the graph at the bottom, then resolves the override in effect for it', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from unnest')
        ? [{ id: 'v-agency', key: 'billing.receive-nemsis-file', version: 3, definition: {} }]
        : [{ version: 3 }]
    );
    assert.deepEqual(await resolveWorkflowVersion(db, 't-1', 'billing.receive-nemsis-file'), {
      id: 'v-agency',
      version: 3
    });
    const [latest, resolved] = queries.map((q) => ({ ...q, sql: q.sql.replace(/\s+/g, ' ') }));
    assert.ok(latest?.sql.includes("g.kind = 'workflow' and g.is_active"));
    assert.ok(latest?.sql.includes('order by g.agency_id is not null, v.version desc'));
    assert.deepEqual(latest?.parameters.slice(0, 2), ['billing.receive-nemsis-file', 't-1']);
    assert.deepEqual(resolved?.parameters.slice(0, 2), [['billing.receive-nemsis-file'], [3]]);
    await db.destroy();
  });

  it('finds nothing when no version is published', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await resolveWorkflowVersion(db, 't-1', 'billing.receive-nemsis-file'), undefined);
    assert.equal(queries.length, 1);
    await db.destroy();
  });
});

describe('findSftpAgency', () => {
  it('finds the password hash of an active agency by SFTP username', async () => {
    const agency = { id: 't-1', sftp_password_hash: 'hash' };
    const { db, queries } = createRecordingDb(() => [agency]);
    assert.deepEqual(await findSftpAgency(db, 'acme-ems'), agency);
    assert.equal(
      queries[0]?.sql,
      'select "id", "sftp_password_hash" from "agencies" where "sftp_username" = $1 and "is_active" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['acme-ems', true]);
    await db.destroy();
  });
});

describe('insertImport', () => {
  const upload = {
    agencyId: 't-1',
    runId: 'r1',
    source: 'upload',
    fileName: 'pcrs.xml',
    file: { bucket: 'b', key: 'k' },
    uploadedBy: 'u1'
  } as const;

  it('records an import against its ingest run and uploader', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'i1' }]);
    assert.deepEqual(await insertImport(db, upload), { id: 'i1' });
    assert.equal(
      queries[0]?.sql,
      'insert into "imports" ("agency_id", "run_id", "source", "file_name", "file", "uploaded_by_id") values ($1, $2, $3, $4, $5, $6) returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, [
      't-1',
      'r1',
      'upload',
      'pcrs.xml',
      '{"bucket":"b","key":"k"}',
      'u1'
    ]);
    await db.destroy();
  });

  it('records an SFTP import without an uploader', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'i1' }]);
    await insertImport(db, { ...upload, source: 'sftp', uploadedBy: null });
    assert.deepEqual(queries[0]?.parameters.slice(2), [
      'sftp',
      'pcrs.xml',
      '{"bucket":"b","key":"k"}',
      null
    ]);
    await db.destroy();
  });

  it('fails when the insert returns nothing', async () => {
    const { db } = createRecordingDb();
    await assert.rejects(insertImport(db, upload), { message: 'no result' });
    await db.destroy();
  });
});

describe('searchImports', () => {
  const page = { page: 1, pageSize: 10, sort: 'file', dir: 'asc' } as const;

  it('lists the agency imports with per-report outcomes and the claims they opened', async () => {
    const { db, queries } = createRecordingDb();
    await searchImports(db, 't-1', page);
    assert.equal(
      queries[0]?.sql,
      `${IMPORT_COLUMNS}, count(*) over () as "total" ${IMPORT_FROM} order by lower(i.file_name) asc nulls last, "i"."id" asc limit $8 offset $9`
    );
    assert.deepEqual(queries[0]?.parameters, [...STATUSES, 't-1', 10, 0]);
    await db.destroy();
  });

  it('searches imports by file name or uploader', async () => {
    const { db, queries } = createRecordingDb();
    await searchImports(db, 't-1', { ...page, q: 'PCRS_', sort: 'received', dir: 'desc' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${IMPORT_FROM} and (lower(i.file_name) like $8 or lower(u.email) like $9) order by "i"."created_at" desc nulls last, "i"."id" desc limit $10 offset $11`
      )
    );
    assert.deepEqual(queries[0]?.parameters.slice(6), ['t-1', '%pcrs\\_%', '%pcrs\\_%', 10, 0]);
    await db.destroy();
  });

  it('sorts by reports, claims, charges, status or how many PCRs still need attention', async () => {
    const { db, queries } = createRecordingDb();
    for (const sort of ['reports', 'claims', 'charges', 'status', 'attention'] as const) {
      await searchImports(db, 't-1', { ...page, sort, dir: 'desc' });
    }
    assert.deepEqual(
      queries.map((q) => q.sql.slice(q.sql.lastIndexOf(' order by '))),
      [
        '"i"."report_count"',
        '"claimed"."claims"',
        '"claimed"."charges_cents"',
        '(r.status, reports.waiting + reports.processing + reports.stuck > 0)',
        'reports.waiting + reports.failed + reports.stuck + reports.processing'
      ].map((by) => ` order by ${by} desc nulls last, "i"."id" desc limit $8 offset $9`)
    );
    await db.destroy();
  });

  it('counts the imports separately when a later page is empty', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select count') ? [{ total: '12' }] : []
    );
    assert.deepEqual(await searchImports(db, 't-1', { ...page, page: 2 }), {
      items: [],
      total: 12,
      page: 2,
      pageSize: 10
    });
    assert.deepEqual(queries[0]?.parameters.slice(-2), [10, 10]);
    assert.equal(queries[1]?.sql, `select count(*) as "total" ${IMPORT_FROM}`);
    assert.deepEqual(queries[1]?.parameters, [...STATUSES, 't-1']);
    await db.destroy();
  });
});

describe('findImport', () => {
  it('opens one import of the agency with its outcomes', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findImport(db, 't-1', 'i1'), undefined);
    assert.equal(queries[0]?.sql, `${IMPORT_COLUMNS} ${IMPORT_FROM} and "i"."id" = $8`);
    assert.deepEqual(queries[0]?.parameters, [...STATUSES, 't-1', 'i1']);
    await db.destroy();
  });
});

describe('listImportReports', () => {
  it('pages each report of an agency import with its run, claim, patient and open task', async () => {
    const { db, queries } = createRecordingDb();
    await listImportReports(db, 't-1', 'i1', {
      page: 1,
      pageSize: 25,
      sort: 'position',
      dir: 'asc'
    });
    assert.equal(
      queries[0]?.sql,
      `${REPORT_COLUMNS}, count(*) over () as "total" ${REPORT_FROM} order by "ir"."position" asc nulls last, "ir"."id" asc limit $5 offset $6`
    );
    assert.deepEqual(queries[0]?.parameters, ['open', 1, 't-1', 'i1', 25, 0]);
    await db.destroy();
  });

  it('sorts by PCR, patient, run status, claim status or total', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'ir1', total: '1' }]);
    const page = { page: 1, pageSize: 25, dir: 'desc' } as const;
    for (const sort of ['pcr', 'patient', 'status', 'claim', 'total'] as const) {
      await listImportReports(db, 't-1', 'i1', { ...page, sort });
    }
    assert.deepEqual(
      queries.map((q) => q.sql.slice(q.sql.lastIndexOf(' order by '))),
      [
        '"ir"."pcr_number"',
        "lower(p.last_name || ' ' || p.first_name)",
        '"r"."status"',
        '"c"."status"',
        '"c"."total_cents"'
      ].map((by) => ` order by ${by} desc nulls last, "ir"."id" desc limit $5 offset $6`)
    );
    await db.destroy();
  });

  it('counts the reports within the agency import when a later page is empty', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select count') ? [{ total: '11' }] : []
    );
    const page = await listImportReports(db, 't-1', 'i1', {
      page: 2,
      pageSize: 10,
      sort: 'patient',
      dir: 'asc'
    });
    assert.deepEqual(page, { items: [], total: 11, page: 2, pageSize: 10 });
    assert.deepEqual(queries[0]?.parameters, ['open', 1, 't-1', 'i1', 10, 10]);
    assert.equal(queries[1]?.sql, `select count(*) as "total" ${REPORT_FROM}`);
    assert.deepEqual(queries[1]?.parameters, ['open', 1, 't-1', 'i1']);
    await db.destroy();
  });
});

describe('findReport', () => {
  it('reads one stored report only through an import of the agency', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findReport(db, 't-1', 'rep-1'), undefined);
    assert.equal(
      queries[0]?.sql,
      'select "r"."id", "r"."position", "r"."pcr_number", "r"."report", "i"."id" as "import_id", "i"."file_name", "i"."created_at" from "import_reports" as "r" inner join "imports" as "i" on "i"."id" = "r"."import_id" where "r"."id" = $1 and "i"."agency_id" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['rep-1', 't-1']);
    await db.destroy();
  });
});

describe('findDictionary', () => {
  it('names elements and groups NEMSIS code descriptions by list', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "nemsis_codes"')
        ? [
            { list: 'eResponse.05', code: '2205001', description: 'Emergency' },
            { list: '@NV', code: '7701003', description: 'Not Recorded' }
          ]
        : [{ element: 'eResponse.05', name: 'Type of Service Requested' }]
    );
    const dictionary = await findDictionary(db, {
      elements: ['eResponse.05'],
      codes: [
        { list: 'eResponse.05', code: '2205001' },
        { list: '@NV', code: '7701003' }
      ]
    });
    assert.deepEqual(dictionary, {
      elements: { 'eResponse.05': 'Type of Service Requested' },
      codes: { 'eResponse.05': { '2205001': 'Emergency' }, '@NV': { '7701003': 'Not Recorded' } }
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "element", "name" from "nemsis_elements" where "element" in ($1)',
          ['eResponse.05']
        ],
        [
          'select "list", "code", "description" from "nemsis_codes" where ("list", "code") in (($1, $2), ($3, $4))',
          ['eResponse.05', '2205001', '@NV', '7701003']
        ]
      ]
    );
    await db.destroy();
  });

  it('looks nothing up for no terms', async () => {
    const { db, queries } = createRecordingDb();
    assert.deepEqual(await findDictionary(db, { elements: [], codes: [] }), {
      elements: {},
      codes: {}
    });
    assert.equal(queries.length, 0);
    await db.destroy();
  });

  it('names GNIS place codes and ANSI state codes the NEMSIS lists do not describe', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "gnis_places"') ? [{ id: 1215162, name: 'Harrisburg' }] : []
    );
    const dictionary = await findDictionary(db, {
      elements: [],
      codes: [
        { list: 'eDisposition.04', code: '1215162' },
        { list: 'eScene.17', code: '999' },
        { list: 'ePatient.06', code: 'Harrisburg' },
        { list: 'ePatient.08', code: '42' },
        { list: 'eScene.18', code: '99' }
      ]
    });
    assert.deepEqual(dictionary.codes, {
      'eDisposition.04': { '1215162': 'Harrisburg' },
      'ePatient.08': { '42': 'PA' }
    });
    assert.equal(queries.length, 2);
    assert.deepEqual(
      queries.find((q) => q.sql.includes('gnis_places'))?.parameters,
      [1215162, 999]
    );
    await db.destroy();
  });

  it('looks up each GNIS place once and skips zero or overlong place codes', async () => {
    const { db, queries } = createRecordingDb();
    await findDictionary(db, {
      elements: [],
      codes: [
        { list: 'eScene.17', code: '12' },
        { list: 'eDisposition.04', code: '12' },
        { list: 'eScene.17', code: '0' },
        { list: 'eScene.17', code: '1234567890' }
      ]
    });
    const places = queries.find((q) => q.sql.includes('gnis_places'));
    assert.equal(places?.sql, 'select "id", "name" from "gnis_places" where "id" in ($1)');
    assert.deepEqual(places?.parameters, [12]);
    await db.destroy();
  });

  it('prefers the NEMSIS description of a code over a place name', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "gnis_places"')
        ? [{ id: 12, name: 'Harrisburg' }]
        : q.sql.includes('from "nemsis_codes"')
          ? [{ list: 'eScene.17', code: '12', description: 'Listed' }]
          : []
    );
    const dictionary = await findDictionary(db, {
      elements: [],
      codes: [{ list: 'eScene.17', code: '12' }]
    });
    assert.deepEqual(dictionary.codes, { 'eScene.17': { '12': 'Listed' } });
    await db.destroy();
  });

  it('describes coded impressions from ICD-10-CM, with or without the dot', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "codes"')
        ? [{ code_set: 'icd10cm', code: 'I214', description: 'NSTEMI' }]
        : []
    );
    const dictionary = await findDictionary(db, {
      elements: [],
      codes: [
        { list: 'eSituation.11', code: 'I21.4' },
        { list: 'eSituation.12', code: 'I214' },
        { list: 'eSituation.12', code: 'Z99.9' }
      ]
    });
    assert.deepEqual(dictionary.codes, {
      'eSituation.11': { 'I21.4': 'NSTEMI' },
      'eSituation.12': { I214: 'NSTEMI' }
    });
    assert.deepEqual(queries.find((q) => q.sql.includes('from "codes"'))?.parameters, [
      'icd10cm',
      'I214',
      'icd10cm',
      'Z999'
    ]);
    await db.destroy();
  });

  it('names medications from RxNorm or SNOMED CT and procedures from SNOMED CT', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "codes"')
        ? [
            { code_set: 'rxnorm', code: '3992', description: 'epinephrine' },
            {
              code_set: 'snomed',
              code: '116762002',
              description: 'Administration of blood product'
            },
            { code_set: 'snomed', code: '232674004', description: 'Orotracheal intubation' }
          ]
        : []
    );
    const dictionary = await findDictionary(db, {
      elements: [],
      codes: [
        { list: 'eMedications.03', code: '3992' },
        { list: 'eMedications.03', code: '116762002' },
        { list: 'eProcedures.03', code: '232674004' }
      ]
    });
    assert.deepEqual(dictionary.codes, {
      'eMedications.03': { '3992': 'epinephrine', '116762002': 'Administration of blood product' },
      'eProcedures.03': { '232674004': 'Orotracheal intubation' }
    });
    await db.destroy();
  });
});
