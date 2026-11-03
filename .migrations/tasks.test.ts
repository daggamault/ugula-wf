import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildTasksForeignKeys, buildTasksIndexes, buildTasksTable } from './tasks.ts';

describe('tasks table', () => {
  it('compiles one task per run wait with queue indexes', async () => {
    const db = createDummyDb();
    const tableSql = buildTasksTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "tasks"'));
    assert.ok(tableSql.includes('unique ("run_id", "wait_id")'));
    assert.ok(tableSql.includes('"context" json not null'));
    assert.ok(tableSql.includes("check (status in ('open', 'completed', 'cancelled'))"));
    assert.ok(tableSql.includes("check (kind in ('task', 'fault'))"));
    assert.ok(tableSql.includes('"assignee_id" uuid,'));
    const fks = buildTasksForeignKeys().map((fk) => fk.compile(db).sql.replace(/\s+/g, ' '));
    assert.deepEqual(
      fks.map((fk) => fk.includes('references "users" (tenant_id, id) on delete set null')),
      [true, true]
    );
    const indexSql = buildTasksIndexes(db).map((i) => i.compile().sql);
    assert.ok(
      indexSql[0]?.includes(
        `("tenant_id", "queue", "priority" desc, "created_at") where "status" = 'open'`
      )
    );
    assert.ok(
      indexSql[1]?.includes(
        `(tenant_id, (assignee_id is null), priority desc, created_at) where "status" = 'open'`
      )
    );
    assert.ok(
      indexSql.includes(
        `create index "idx_tasks_completed" on "tasks" ("tenant_id", "completed_at") where "status" = 'completed'`
      )
    );
    await db.destroy();
  });
});
