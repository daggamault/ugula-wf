import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildUpsertUser } from './users.ts';

describe('upsertUser', () => {
  it('compiles upsert user statement with conflict on email and returning id', async () => {
    const db = createDummyDb();
    const compiled = buildUpsertUser(db, {
      tenantId: 't-1',
      email: 'dev@example.com',
      passwordHash: 'hash'
    }).compile();

    assert.ok(compiled.sql.includes('insert into "users"'));
    assert.ok(compiled.sql.includes('on conflict ("email") do update set'));
    assert.ok(compiled.sql.includes('returning "id"'));
    await db.destroy();
  });
});
