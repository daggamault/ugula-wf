import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { assignTask, claimNext, completeTask, findTask, listQueues, listTasks } from './queries.ts';

describe('task queries', () => {
  it('summarize open work per queue and list by priority', async () => {
    const { db, queries } = createRecordingDb();
    await listQueues(db, 't');
    await listTasks(db, 't', { status: 'open', queue: 'billing', assigneeId: 'u1', limit: 20 });
    await findTask(db, 't', 'x');
    assert.ok(queries[0]?.sql.includes('filter (where assignee_id is null)'));
    assert.ok(queries[1]?.sql.includes('order by "priority" desc, "created_at"'));
    assert.deepEqual(queries[1]?.parameters, ['t', 'open', 'billing', 'u1', 20]);
    await db.destroy();
  });

  it('claim, assign and complete only open tasks', async () => {
    const { db, queries } = createRecordingDb();
    await claimNext(db, 't', 'billing', 'u1');
    await assignTask(db, 't', 'x', null);
    await completeTask(db, { tenantId: 't', id: 'x', userId: 'u1', resolution: { outcome: 'ok' } });
    assert.ok(queries[0]?.sql.includes('"assignee_id" is null'));
    assert.ok(queries[0]?.sql.includes('for update skip locked'));
    for (const q of queries.slice(1)) assert.ok(q.sql.includes('"status" = $'));
    assert.ok(queries[2]?.parameters.includes('{"outcome":"ok"}'));
    await db.destroy();
  });
});
