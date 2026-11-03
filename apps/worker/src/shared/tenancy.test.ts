import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb, createRecordingDb } from '@ugula/db/testing';
import { createTenantOf, runTenant } from './tenancy.ts';

describe('runTenant', () => {
  it('selects the tenant that owns a run', async () => {
    const db = createDummyDb();
    const q = runTenant(db, 'r1').compile();
    assert.equal(q.sql, 'select "tenant_id" from "workflow_runs" where "id" = $1');
    assert.deepEqual(q.parameters, ['r1']);
    await db.destroy();
  });
});

describe('createTenantOf', () => {
  it('uses the tenant already known for a run and queries only otherwise', async () => {
    const { db, queries } = createRecordingDb(() => [{ tenant_id: 't-db' }]);
    const tenantOf = createTenantOf(db, (runId) => (runId === 'r1' ? 't-1' : undefined));
    assert.equal(await tenantOf('r1'), 't-1');
    assert.equal(queries.length, 0);
    assert.equal(await tenantOf('r2'), 't-db');
    assert.equal(queries.length, 1);
    await db.destroy();
  });
});
