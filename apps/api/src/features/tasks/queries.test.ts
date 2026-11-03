import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { assignTask, claimNext, completeTask, findTask, listQueues, listTasks } from './queries.ts';

describe('task queries', () => {
  it('summarize open work per queue and list by priority', async () => {
    const { db, queries } = createRecordingDb();
    await listQueues(db, 't', 'u1');
    await listTasks(db, 't', {
      status: 'open',
      queue: 'billing',
      assignee: { id: 'u1' },
      page: 1,
      pageSize: 25,
      sort: 'waiting',
      dir: 'desc'
    });
    await findTask(db, 't', 'x');
    assert.ok(queries[0]?.sql.includes('filter (where assignee_id is null)'));
    assert.ok(queries[1]?.sql.includes('order by now() - created_at desc nulls last, "id" desc'));
    assert.ok(
      queries[1]?.sql.includes('(select u.email from users u where u.id = tasks.assignee_id)')
    );
    assert.deepEqual(queries[1]?.parameters, ['t', 'open', 'billing', 'u1', 25, 0]);
    await listTasks(db, 't', {
      status: 'open',
      assignee: { id: null },
      page: 1,
      pageSize: 25,
      sort: 'waiting',
      dir: 'desc'
    });
    assert.ok(queries[3]?.sql.includes('"assignee_id" is null'));
    await db.destroy();
  });

  it('claim, assign and complete only open tasks', async () => {
    const { db, queries } = createRecordingDb();
    await claimNext(db, 't', 'billing', 'u1');
    await assignTask(db, 't', 'x', null);
    await claimNext(db, 't', null, 'u1');
    await completeTask(db, { tenantId: 't', id: 'x', userId: 'u1', resolution: { outcome: 'ok' } });
    assert.ok(queries[0]?.sql.includes('("assignee_id" is null or "assignee_id" = $'));
    assert.ok(queries[0]?.sql.includes('order by assignee_id is null'));
    assert.ok(queries[0]?.sql.includes('for update skip locked'));
    for (const q of queries.slice(1)) assert.ok(q.sql.includes('"status" = $'));
    assert.ok(!queries[2]?.sql.includes('"queue" = $'));
    assert.ok(queries[3]?.parameters.includes('{"outcome":"ok"}'));
    await db.destroy();
  });
});

describe('task assignee sort', () => {
  it('orders tasks by who they are assigned to', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listTasks(db, 't', {
      status: 'open',
      page: 1,
      pageSize: 25,
      sort: 'assignee',
      dir: 'asc'
    });
    assert.ok(
      queries[0]?.sql.includes(
        'order by (select lower(u.email) from users u where u.id = tasks.assignee_id) asc nulls last'
      )
    );
  });
});
