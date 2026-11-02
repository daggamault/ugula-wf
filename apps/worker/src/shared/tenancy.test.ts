import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { runTenant } from './tenancy.ts';

describe('runTenant', () => {
  it('selects the tenant that owns a run', async () => {
    const db = createDummyDb();
    const q = runTenant(db, 'r1').compile();
    assert.equal(q.sql, 'select "tenant_id" from "workflow_runs" where "id" = $1');
    assert.deepEqual(q.parameters, ['r1']);
    await db.destroy();
  });
});
