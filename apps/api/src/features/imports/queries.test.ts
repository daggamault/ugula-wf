import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { findLatestPublished, findSftpTenant } from './queries.ts';

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
