import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildTenantsTable } from './tenants.ts';

describe('buildTenantsTable', () => {
  it('compiles create table tenants statement with constraints', async () => {
    const db = createDummyDb();
    const compiled = buildTenantsTable(db).compile();
    assert.ok(compiled.sql.includes('create table "tenants"'));
    assert.ok(compiled.sql.includes('"slug" text not null unique'));
    await db.destroy();
  });
});
