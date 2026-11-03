import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { assignTask, claimNext, completeTask, findTask, listQueues } from './queries.ts';

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
