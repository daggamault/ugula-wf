import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { migrate, resetSchema, steps } from './migrate.ts';
import { createTenantsTable } from './tenants.ts';
import { createUsersTable } from './users.ts';

describe('migrate', () => {
  it('orders resetSchema before createTenantsTable and createUsersTable', () => {
    assert.deepEqual(steps, [resetSchema, createTenantsTable, createUsersTable]);
  });

  it('executes all migration steps within a transaction', async () => {
    const db = createDummyDb();
    await migrate(db);
    await db.destroy();
  });
});
