import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import {
  buildSignalsTable,
  buildWorkflowRunStepsNodeIndex,
  buildWorkflowRunStepsTable,
  buildWorkflowRunsIndexes,
  buildWorkflowRunsTable
} from './workflow-runs.ts';

describe('workflow runs tables', () => {
  it('compiles runs with status and parent consistency checks', async () => {
    const db = createDummyDb();
    const tableSql = buildWorkflowRunsTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "workflow_runs"'));
    assert.ok(tableSql.includes('references "graph_versions" ("id") on delete restrict'));
    assert.ok(tableSql.includes('references "workflow_runs" ("id") on delete cascade'));
    assert.ok(tableSql.includes("'faulted'"));
    const indexSql = buildWorkflowRunsIndexes(db).map((i) => i.compile().sql);
    assert.ok(indexSql.some((s) => s.includes('"wait_key" is not null')));
    assert.ok(indexSql.some((s) => s.includes(`"status" = 'running'`)));
    assert.ok(
      indexSql.includes(
        `create index "idx_workflow_runs_active_children" on "workflow_runs" ("parent_id", "parent_wait") where "status" in ('running', 'suspended', 'faulted')`
      )
    );
    await db.destroy();
  });

  it('compiles the step trace keyed by run and sequence', async () => {
    const db = createDummyDb();
    assert.ok(
      buildWorkflowRunStepsTable(db).compile().sql.includes('primary key ("run_id", "seq")')
    );
    assert.ok(
      buildWorkflowRunStepsNodeIndex(db).compile().sql.includes('("run_id", "path", "node", "seq")')
    );
    await db.destroy();
  });

  it('compiles a per-tenant signal counter', async () => {
    const db = createDummyDb();
    const sql = buildSignalsTable(db).compile().sql;
    assert.ok(sql.includes('primary key ("tenant_id", "key")'));
    assert.ok(sql.includes('"received" integer default 0 not null'));
    assert.ok(sql.includes('check (received >= 0)'));
    await db.destroy();
  });
});
