import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
  'select "i"."id", "i"."file_name", "i"."source", "i"."report_count", "i"."created_at", "i"."run_id", "r"."status" as "run_status", "u"."email" as "uploaded_by_email", "reports"."created", "reports"."revised", "reports"."unchanged", "claimed"."claims", "claimed"."charges_cents"';
const IMPORT_FROM =
  'from "imports" as "i" left join "workflow_runs" as "r" on "r"."id" = "i"."run_id" left join "users" as "u" on "u"."id" = "i"."uploaded_by_id" left join lateral (select (count(*) filter (where ir.outcome = $1))::int as "created", (count(*) filter (where ir.outcome = $2))::int as "revised", (count(*) filter (where ir.outcome = $3))::int as "unchanged" from "import_reports" as "ir" where "ir"."import_id" = "i"."id") as "reports" on true left join lateral (select count(*)::int as "claims", coalesce(sum(c.total_cents), 0)::float8 as "charges_cents" from "claims" as "c" where "c"."encounter_id" in (select "ir"."encounter_id" from "import_reports" as "ir" where "ir"."import_id" = "i"."id" and "ir"."encounter_id" is not null)) as "claimed" on true where "i"."agency_id" = $4';
const OUTCOMES = ['created', 'revised', 'unchanged'];

const REPORT_COLUMNS =
  'select "ir"."id", "ir"."position", "ir"."number", "ir"."pcr_number", "ir"."outcome", "e"."number" as "encounter_number", "e"."revision" as "encounter_revision", "c"."id" as "claim_id", "c"."status" as "claim_status", "c"."total_cents", "p"."first_name", "p"."last_name"';
const REPORT_FROM =
  'from "import_reports" as "ir" left join "encounters" as "e" on "e"."id" = "ir"."encounter_id" left join "claims" as "c" on "c"."encounter_id" = "ir"."encounter_id" left join "patients" as "p" on "p"."id" = "c"."patient_id" where "ir"."agency_id" = $1 and "ir"."import_id" = $2';

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
    source: 'upload',
    fileName: 'pcrs.xml',
    file: { bucket: 'b', key: 'k' },
    uploadedBy: 'u1'
  } as const;

  it('records an import with its file and uploader, before any run reads it', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'i1' }]);
    assert.deepEqual(await insertImport(db, upload), { id: 'i1' });
    assert.equal(
      queries[0]?.sql,
      'insert into "imports" ("agency_id", "source", "file_name", "file", "uploaded_by_id") values ($1, $2, $3, $4, $5) returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, [
      't-1',
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
    assert.deepEqual(queries[0]?.parameters.slice(1), [
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

  it('lists the agency imports with their new, revised and unchanged PCRs and the claims made', async () => {
    const { db, queries } = createRecordingDb();
    await searchImports(db, 't-1', page);
    assert.equal(
      queries[0]?.sql,
      `${IMPORT_COLUMNS}, count(*) over () as "total" ${IMPORT_FROM} order by lower(i.file_name) asc nulls last, "i"."id" asc limit $5 offset $6`
    );
    assert.deepEqual(queries[0]?.parameters, [...OUTCOMES, 't-1', 10, 0]);
    await db.destroy();
  });

  it('searches imports by file name or uploader', async () => {
    const { db, queries } = createRecordingDb();
    await searchImports(db, 't-1', { ...page, q: 'PCRS_', sort: 'received', dir: 'desc' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${IMPORT_FROM} and (lower(i.file_name) like $5 or lower(u.email) like $6) order by "i"."created_at" desc nulls last, "i"."id" desc limit $7 offset $8`
      )
    );
    assert.deepEqual(queries[0]?.parameters.slice(3), ['t-1', '%pcrs\\_%', '%pcrs\\_%', 10, 0]);
    await db.destroy();
  });

  it('sorts by reports, claims, charges or status', async () => {
    const { db, queries } = createRecordingDb();
    for (const sort of ['reports', 'claims', 'charges', 'status'] as const) {
      await searchImports(db, 't-1', { ...page, sort, dir: 'desc' });
    }
    assert.deepEqual(
      queries.map((q) => q.sql.slice(q.sql.lastIndexOf(' order by '))),
      ['"i"."report_count"', '"claimed"."claims"', '"claimed"."charges_cents"', '"r"."status"'].map(
        (by) => ` order by ${by} desc nulls last, "i"."id" desc limit $5 offset $6`
      )
    );
    await db.destroy();
  });
});

describe('findImport', () => {
  it('opens one import of the agency with its outcomes', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findImport(db, 't-1', 'i1'), undefined);
    assert.equal(queries[0]?.sql, `${IMPORT_COLUMNS} ${IMPORT_FROM} and "i"."id" = $5`);
    assert.deepEqual(queries[0]?.parameters, [...OUTCOMES, 't-1', 'i1']);
    await db.destroy();
  });
});

describe('listImportReports', () => {
  it('pages each report of an agency import with its outcome, encounter, claim and patient', async () => {
    const { db, queries } = createRecordingDb();
    await listImportReports(db, 't-1', 'i1', {
      page: 1,
      pageSize: 25,
      sort: 'position',
      dir: 'asc'
    });
    assert.equal(
      queries[0]?.sql,
      `${REPORT_COLUMNS}, count(*) over () as "total" ${REPORT_FROM} order by "ir"."position" asc nulls last, "ir"."id" asc limit $3 offset $4`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'i1', 25, 0]);
    await db.destroy();
  });

  it('sorts by PCR, patient, outcome, claim status or total', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'ir1', total: '1' }]);
    const page = { page: 1, pageSize: 25, dir: 'desc' } as const;
    for (const sort of ['pcr', 'patient', 'outcome', 'claim', 'total'] as const) {
      await listImportReports(db, 't-1', 'i1', { ...page, sort });
    }
    assert.deepEqual(
      queries.map((q) => q.sql.slice(q.sql.lastIndexOf(' order by '))),
      [
        '"ir"."pcr_number"',
        "lower(p.last_name || ' ' || p.first_name)",
        '"ir"."outcome"',
        '"c"."status"',
        '"c"."total_cents"'
      ].map((by) => ` order by ${by} desc nulls last, "ir"."id" desc limit $3 offset $4`)
    );
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
