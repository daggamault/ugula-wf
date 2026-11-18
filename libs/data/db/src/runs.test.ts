import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import { startRun } from './runs.ts';
import { createRecordingDb } from './testing.ts';

describe('startRun', () => {
  it('inserts a running run and enqueues its first step in the same transaction', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r1' }]);
    const jobs: unknown[] = [];
    const boss: RunQueueClient = { insert: async (_name, batch) => void jobs.push(...batch) };
    assert.equal(
      await startRun(db, boss, { agencyId: 't', versionId: 'v', inputs: { a: 1 } }),
      'r1'
    );
    assert.equal(
      queries[0]?.sql,
      'insert into "workflow_runs" ("agency_id", "graph_version_id", "status", "inputs", "started_by_id") values ($1, $2, $3, $4, $5) returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t', 'v', 'running', '{"a":1}', null]);
    assert.match(queries[1]?.sql ?? '', /^\s+insert into workflow_run_graphs /);
    assert.deepEqual(queries[1]?.parameters, ['v', 't', 'r1']);
    assert.match(queries[2]?.sql ?? '', /^\s+insert into workflow_run_tables /);
    assert.equal(queries.length, 3);
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } } }]);
    jobs.length = 0;
    await startRun(db, boss, {
      agencyId: 't',
      versionId: 'v',
      inputs: {},
      interactive: true,
      startedBy: 'u1'
    });
    assert.deepEqual(queries[3]?.parameters, ['t', 'v', 'running', '{}', 'u1']);
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } }, priority: 2 }]);
    await db.destroy();
  });
});
