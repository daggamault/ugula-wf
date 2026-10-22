import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Kysely } from 'kysely';
import { createDb, createDummyDb } from './index.ts';

describe('createDb', () => {
  it('creates a Kysely database instance', async () => {
    const db = createDb({ host: 'localhost', port: 5432, database: 'ugula' });
    assert.ok(db instanceof Kysely);
    await db.destroy();
  });

  it('creates a dummy Kysely database instance for query compilation', async () => {
    const db = createDummyDb();
    assert.ok(db instanceof Kysely);
    await db.destroy();
  });
});
