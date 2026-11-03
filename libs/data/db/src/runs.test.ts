import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import { signalRuns, startRun } from './runs.ts';
import { createRecordingDb } from './testing.ts';

describe('startRun', () => {
  it('inserts a running run and enqueues its first step in the same transaction', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r1' }]);
    const jobs: unknown[] = [];
    const boss: RunQueueClient = { insert: async (_name, batch) => void jobs.push(...batch) };
    assert.equal(
      await startRun(db, boss, { tenantId: 't', versionId: 'v', inputs: { a: 1 } }),
      'r1'
    );
    assert.ok(queries[0]?.sql.startsWith('insert into "workflow_runs"'));
    assert.deepEqual(queries[0]?.parameters, ['t', 'v', 'running', '{"a":1}']);
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } } }]);
    await db.destroy();
  });
});

describe('signalRuns', () => {
  it('counts the signal before looking for waiters, so a run about to wait sees it', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const boss: RunQueueClient = { insert: async () => undefined };
    await signalRuns(db, boss, { tenantId: 't', name: 'claim', key: 'c1', payload: null });
    assert.equal(
      queries[0]?.sql,
      'insert into "signals" ("tenant_id", "key", "received") values ($1, $2, $3) on conflict ("tenant_id", "key") do update set "received" = signals.received + 1, "updated_at" = now()'
    );
    assert.deepEqual(queries[0]?.parameters, ['t', 'claim:c1', 1]);
    assert.ok(queries[1]?.sql.startsWith('select'));
    await db.destroy();
  });

  it('resumes every tenant run waiting on the signal key', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select')
        ? [
            { id: 'r1', wait_id: '7' },
            { id: 'r2', wait_id: '9' }
          ]
        : []
    );
    const jobs: unknown[] = [];
    const boss: RunQueueClient = { insert: async (_name, batch) => void jobs.push(...batch) };
    assert.equal(
      await signalRuns(db, boss, { tenantId: 't', name: 'claim', key: 'c1', payload: { a: 1 } }),
      2
    );
    assert.deepEqual(queries[1]?.parameters, ['t', 'claim:c1', 'suspended']);
    assert.deepEqual((jobs[1] as { data: unknown }).data, {
      runId: 'r2',
      command: { type: 'resume', suspensionId: '9', payload: { payload: { a: 1 } } }
    });
    await db.destroy();
  });
});
