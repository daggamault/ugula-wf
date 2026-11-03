import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildUsersEmailIndex, buildUsersTable } from './users.ts';

describe('buildUsersTable', () => {
  it('compiles tenant users keyed for tenant-scoped references', async () => {
    const db = createDummyDb();
    const tableSql = buildUsersTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "users"'));
    assert.ok(tableSql.includes('references "tenants" ("id") on delete cascade on update cascade'));
    assert.ok(tableSql.includes('unique ("tenant_id", "id")'));
    assert.ok(!tableSql.includes('"email" text not null unique'));
    await db.destroy();
  });

  it('keeps emails unique regardless of case', async () => {
    const db = createDummyDb();
    assert.equal(
      buildUsersEmailIndex(db).compile().sql,
      'create unique index "users_email_unique" on "users" (lower(email))'
    );
    await db.destroy();
  });
});
