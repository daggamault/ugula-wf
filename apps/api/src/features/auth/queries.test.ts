import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { findActiveUserByEmail } from './queries.ts';

describe('findActiveUserByEmail', () => {
  it('executes query against active users and tenants', async () => {
    const db = createDummyDb();
    const res = await findActiveUserByEmail(db, 'dev@example.com');
    assert.equal(res, undefined);
    await db.destroy();
  });
});
