import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  assignTask,
  claimNext,
  completeTask,
  findTask,
  findTaskSource,
  listQueues
} from './queries.ts';

describe('task queries', () => {
  it('summarize open work per queue and find one task in its tenant', async () => {
    const { db, queries } = createRecordingDb();
    await listQueues(db, 't', 'u1');
    await findTask(db, 't', 'x');
    assert.ok(queries[0]?.sql.includes('filter (where assignee_id is null)'));
    assert.deepEqual(queries[1]?.parameters, ['t', 'x']);
    await db.destroy();
  });

  it('claim, assign and complete only open tasks', async () => {
    const { db, queries } = createRecordingDb();
    await claimNext(db, 't', 'billing', 'u1');
    await assignTask(db, { tenantId: 't', id: 'x', userId: 'u1', assignee: null });
    await claimNext(db, 't', null, 'u1');
    await completeTask(db, { tenantId: 't', id: 'x', userId: 'u1', resolution: { outcome: 'ok' } });
    assert.ok(queries[0]?.sql.includes('("assignee_id" is null or "assignee_id" = $'));
    assert.ok(queries[0]?.sql.includes('order by assignee_id is null'));
    assert.ok(queries[0]?.sql.includes('for update skip locked'));
    for (const q of queries.slice(1)) assert.ok(q.sql.includes('"status" = $'));
    assert.ok(!queries[2]?.sql.includes('"queue" = $'));
    assert.ok(queries[3]?.parameters.includes('{"outcome":"ok"}'));
    for (const q of [queries[1], queries[3]]) {
      assert.ok(q?.sql.includes('("assignee_id" is null or "assignee_id" = $'));
      assert.ok(q?.parameters.includes('u1'));
    }
    await db.destroy();
  });
});

describe('task tenant scoping', () => {
  it('count, hand out and assign only open tasks of the tenant', async () => {
    const { db, queries } = createRecordingDb();
    await listQueues(db, 't-1', 'u1');
    await claimNext(db, 't-1', 'billing', 'u1');
    await assignTask(db, { tenantId: 't-1', id: 'x', userId: 'u1', assignee: 'u1' });
    await completeTask(db, { tenantId: 't-1', id: 'x', userId: 'u1', resolution: {} });
    const [queues, next, assign, complete] = queries;
    assert.ok(queues?.sql.includes('where "tenant_id" = $2 and "status" = $3 group by "queue"'));
    assert.deepEqual(queues?.parameters, ['u1', 't-1', 'open']);
    assert.ok(next?.sql.includes('(select "id" from "tasks" where "tenant_id" = $2'));
    assert.deepEqual(next?.parameters, ['u1', 't-1', 'open', 'billing', 'u1', 1]);
    assert.deepEqual(assign?.parameters, ['u1', 't-1', 'x', 'open', 'u1']);
    assert.ok(complete?.sql.includes('where "tenant_id" = $'));
    assert.ok(complete?.parameters.includes('t-1'));
    await db.destroy();
  });

  it('trace a task run back to its report and claim', async () => {
    const { db, queries } = createRecordingDb();
    await findTaskSource(db, 'r1');
    assert.ok(queries[0]?.sql.endsWith('where "r"."id" = $1'));
    assert.deepEqual(queries[0]?.parameters, ['r1']);
    await db.destroy();
  });
});
