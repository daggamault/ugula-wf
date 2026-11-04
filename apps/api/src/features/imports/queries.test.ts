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
  listImports
} from './queries.ts';

describe('resolveWorkflowVersion', () => {
  it('takes the newest built-in version number, then resolves the override in effect for it', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from unnest')
        ? [{ id: 'v-agency', key: 'billing.ingest-nemsis', version: 3, definition: {} }]
        : [{ version: 3 }]
    );
    assert.deepEqual(await resolveWorkflowVersion(db, 't-1', 'billing.ingest-nemsis'), {
      id: 'v-agency',
      version: 3
    });
    const [latest, resolved] = queries.map((q) => ({ ...q, sql: q.sql.replace(/\s+/g, ' ') }));
    assert.ok(latest?.sql.includes("g.kind = 'workflow' and g.is_active"));
    assert.ok(latest?.sql.includes('order by g.organization_id is not null, v.version desc'));
    assert.deepEqual(latest?.parameters.slice(0, 2), ['billing.ingest-nemsis', 't-1']);
    assert.deepEqual(resolved?.parameters.slice(0, 2), [['billing.ingest-nemsis'], [3]]);
    await db.destroy();
  });

  it('finds nothing when no version is published', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await resolveWorkflowVersion(db, 't-1', 'billing.ingest-nemsis'), undefined);
    assert.equal(queries.length, 1);
    await db.destroy();
  });
});

describe('findSftpAgency', () => {
  it('finds active agencies by SFTP username', async () => {
    const { db, queries } = createRecordingDb();
    await findSftpAgency(db, 'acme-ems');
    assert.ok(queries[0]?.sql.includes('"is_active" = $'));
    assert.deepEqual(queries[0]?.parameters, ['acme-ems', true]);
    await db.destroy();
  });
});

describe('import records', () => {
  it('records an import against its ingest run and uploader', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'i1' }]);
    await insertImport(db, {
      agencyId: 't-1',
      runId: 'r1',
      source: 'upload',
      fileName: 'pcrs.xml',
      file: { bucket: 'b', key: 'k' },
      uploadedBy: 'u1'
    });
    assert.deepEqual(queries[0]?.parameters, [
      't-1',
      'r1',
      'upload',
      'pcrs.xml',
      '{"bucket":"b","key":"k"}',
      'u1'
    ]);
  });

  it('lists imports with per-report outcomes and the claims they opened', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listImports(db, 't-1', { page: 1, pageSize: 10, sort: 'file', dir: 'asc' });
    const [q] = queries;
    assert.ok(q?.sql.includes('"ch"."parent_id" = "i"."run_id"'));
    assert.ok(q?.sql.includes('(count(*) filter (where ch.status = $1))::int as "completed"'));
    assert.ok(
      q?.sql.includes('inner join "import_reports" as "ir" on "ir"."id" = "c"."import_report_id"')
    );
    assert.ok(
      q?.sql.endsWith('order by lower(i.file_name) asc nulls last, "i"."id" asc limit $8 offset $9')
    );
    assert.deepEqual(q?.parameters, [
      'completed',
      'suspended',
      'faulted',
      'failed',
      'running',
      'void',
      't-1',
      10,
      0
    ]);
  });

  it('searches imports by file name or uploader', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listImports(db, 't-1', {
      q: 'PCRS_',
      page: 1,
      pageSize: 10,
      sort: 'received',
      dir: 'desc'
    });
    assert.ok(queries[0]?.sql.includes('(lower(i.file_name) like $8 or lower(u.email) like $9)'));
    assert.deepEqual(queries[0]?.parameters.slice(7, 9), ['%pcrs\\_%', '%pcrs\\_%']);
  });

  it('pages each report of an import with its run, claim and open task', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findImport(db, 't', 'i1');
    await listImportReports(db, 't', 'i1', { page: 1, pageSize: 25, sort: 'pcr', dir: 'desc' });
    assert.ok(queries[0]?.sql.includes('"i"."id" = $'));
    const reports = queries[1]?.sql ?? '';
    assert.ok(reports.includes(`r.inputs -> 'report' ->> 'key' = ir.report ->> 'key'`));
    assert.ok(
      reports.includes(
        'left join "claim_runs" as "cr" on "cr"."run_id" = "r"."id" left join "claims" as "c" on "c"."id" = "cr"."claim_id"'
      )
    );
    assert.ok(reports.includes('"t"."status" = $'));
    assert.ok(reports.includes('order by "ir"."pcr_number" desc nulls last, "ir"."id" desc'));
    await db.destroy();
  });
});

describe('findDictionary', () => {
  it('groups code descriptions by list and skips lookups for nothing', async () => {
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
    assert.equal(queries.length, 2);
    assert.deepEqual(await findDictionary(db, { elements: [], codes: [] }), {
      elements: {},
      codes: {}
    });
    assert.equal(queries.length, 2);
    await db.destroy();
  });
});

describe('import status and attention sorts', () => {
  it('orders imports by status or by how many PCRs still need attention', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listImports(db, 't-1', { page: 1, pageSize: 10, sort: 'status', dir: 'asc' });
    await listImports(db, 't-1', { page: 1, pageSize: 10, sort: 'attention', dir: 'desc' });
    assert.ok(queries[0]?.sql.includes('order by (r.status, reports.waiting'));
    assert.ok(queries[1]?.sql.includes('order by reports.waiting + reports.failed'));
  });
});

describe('import agency scoping', () => {
  it('open one import and page its reports within the agency', async () => {
    const { db, queries } = createRecordingDb();
    await findImport(db, 't-1', 'i1');
    await listImportReports(db, 't-1', 'i1', {
      page: 2,
      pageSize: 10,
      sort: 'patient',
      dir: 'asc'
    });
    const [found, reports, count] = queries;
    assert.ok(found?.sql.endsWith('where "i"."agency_id" = $7 and "i"."id" = $8'));
    assert.deepEqual(found?.parameters.slice(6), ['t-1', 'i1']);
    assert.ok(
      reports?.sql.includes(
        'where "i"."agency_id" = $3 and "i"."id" = $4 order by lower(p.last_name || \' \' || p.first_name) asc nulls last'
      )
    );
    assert.deepEqual(reports?.parameters, ['open', 1, 't-1', 'i1', 10, 10]);
    assert.ok(count?.sql.endsWith('where "i"."agency_id" = $3 and "i"."id" = $4'));
    await db.destroy();
  });

  it('read one stored report only through an import of the agency', async () => {
    const { db, queries } = createRecordingDb();
    await findReport(db, 't-1', 'rep-1');
    assert.ok(
      queries[0]?.sql.endsWith(
        'inner join "imports" as "i" on "i"."id" = "r"."import_id" where "r"."id" = $1 and "i"."agency_id" = $2'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['rep-1', 't-1']);
    await db.destroy();
  });
});
