import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildUpsertTenant } from './tenants.ts';

describe('upsertTenant', () => {
  it('compiles upsert tenant statement with conflict on slug and returning id', async () => {
    const db = createDummyDb();
    const compiled = buildUpsertTenant(db, {
      name: 'Development',
      slug: 'dev',
      sftpUsername: 'acme',
      sftpPasswordHash: 'hash'
    }).compile();

    assert.ok(compiled.sql.includes('insert into "tenants"'));
    assert.ok(compiled.sql.includes('on conflict ("slug") do update set'));
    assert.ok(compiled.sql.includes('returning "id"'));
    await db.destroy();
  });
});
