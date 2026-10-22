import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildUsersTable, buildUsersTenantIndex } from './users.ts';

describe('buildUsersTable', () => {
  it('compiles create table users and idx_users_tenant_id statements', async () => {
    const db = createDummyDb();
    const tableSql = buildUsersTable(db).compile().sql;
    const indexSql = buildUsersTenantIndex(db).compile().sql;
    assert.ok(tableSql.includes('create table "users"'));
    assert.ok(tableSql.includes('references "tenants" ("id") on delete cascade on update cascade'));
    assert.ok(indexSql.includes('create index "idx_users_tenant_id" on "users" ("tenant_id")'));
    await db.destroy();
  });
});
