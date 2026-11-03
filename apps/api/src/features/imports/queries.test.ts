import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  findDictionary,
  findImport,
  findSftpTenant,
  insertImport,
  listImportReports,
  listImports,
  resolveWorkflowVersion
} from './queries.ts';

describe('resolveWorkflowVersion', () => {
  it('picks the newest published workflow version, preferring an active tenant copy', async () => {
    const { db, queries } = createRecordingDb();
    await resolveWorkflowVersion(db, 't-1', 'billing.ingest-nemsis');
    const [q] = queries;
    assert.ok(q?.sql.includes('"g"."is_active" = $3'));
    assert.ok(q?.sql.includes('order by g.tenant_id nulls last, "gv"."version" desc'));
    assert.deepEqual(q?.parameters, ['billing.ingest-nemsis', 'workflow', true, 't-1', 1]);
    await db.destroy();
  });
});

describe('findSftpTenant', () => {
  it('finds active tenants by SFTP username', async () => {
    const { db, queries } = createRecordingDb();
    await findSftpTenant(db, 'acme-ems');
    assert.ok(queries[0]?.sql.includes('"is_active" = $'));
    assert.deepEqual(queries[0]?.parameters, ['acme-ems', true]);
    await db.destroy();
  });
});

describe('import records', () => {
  it('records an import against its ingest run and uploader', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'i1' }]);
    await insertImport(db, {
      tenantId: 't-1',
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
