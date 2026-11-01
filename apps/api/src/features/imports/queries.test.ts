import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import {
  findImport,
  findLatestPublished,
  findSftpTenant,
  insertImport,
  listImportReports,
  listImports
} from './queries.ts';

describe('findLatestPublished', () => {
  it('picks the newest published workflow version, preferring the tenant copy', async () => {
    const { db, queries } = createRecordingDb();
    await findLatestPublished(db, 't-1', 'billing.ingest-nemsis');
    const [q] = queries;
    assert.ok(q?.sql.includes('order by g.tenant_id nulls last, "gv"."version" desc'));
    assert.deepEqual(q?.parameters, ['billing.ingest-nemsis', 'workflow', 't-1', 1]);
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
      q?.sql.endsWith('order by lower(i.file_name) asc nulls last, "i"."id" asc limit $7 offset $8')
    );
    assert.deepEqual(q?.parameters, [
      'completed',
      'suspended',
      'faulted',
      'failed',
      'running',
      't-1',
      10,
      0
    ]);
  });

  it('lists each report of an import with its run, claim and open task', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findImport(db, 't', 'i1');
    await listImportReports(db, 't', 'i1');
    assert.ok(queries[0]?.sql.includes('"i"."id" = $'));
    const reports = queries[1]?.sql ?? '';
    assert.ok(reports.includes(`r.inputs -> 'report' ->> 'key' = ir.report ->> 'key'`));
    assert.ok(reports.includes('left join "claims" as "c" on "c"."import_report_id" = "ir"."id"'));
    assert.ok(reports.includes('"t"."status" = $'));
    assert.ok(reports.includes('order by "ir"."position"'));
    await db.destroy();
  });
});
