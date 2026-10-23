import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildTasksIndexes, buildTasksTable } from './tasks.ts';

describe('tasks table', () => {
  it('compiles one task per run wait with queue indexes', async () => {
    const db = createDummyDb();
    const tableSql = buildTasksTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "tasks"'));
    assert.ok(tableSql.includes('unique ("run_id", "wait_id")'));
    assert.ok(tableSql.includes("check (status in ('open', 'completed', 'cancelled'))"));
    const indexSql = buildTasksIndexes(db).map((i) => i.compile().sql);
    assert.ok(
      indexSql[0]?.includes(
        `("tenant_id", "queue", "priority" desc, "created_at") where "status" = 'open'`
      )
    );
    await db.destroy();
  });
});
