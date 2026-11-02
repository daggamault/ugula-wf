import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildExtensions } from './extensions.ts';

describe('extensions', () => {
  it('enables vector search and trigram similarity', async () => {
    const db = createDummyDb();
    assert.deepEqual(
      buildExtensions().map((s) => s.compile(db).sql),
      ['create extension if not exists "vector"', 'create extension if not exists "pg_trgm"']
    );
    await db.destroy();
  });
});
