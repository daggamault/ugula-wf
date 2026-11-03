import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { tenantSetNullForeignKey } from './foreign-keys.ts';

describe('tenantSetNullForeignKey', () => {
  it('keeps a reference inside its tenant and clears only the reference on delete', async () => {
    const db = createDummyDb();
    const { sql } = tenantSetNullForeignKey({
      table: 'tasks',
      column: 'assignee_id',
      references: 'users'
    }).compile(db);
    assert.equal(
      sql.replace(/\s+/g, ' '),
      'alter table "tasks" add constraint "tasks_assignee_id_fkey" foreign key (tenant_id, "assignee_id") references "users" (tenant_id, id) on delete set null ("assignee_id") on update cascade'
    );
    await db.destroy();
  });
});
