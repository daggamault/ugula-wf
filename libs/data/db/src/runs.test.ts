import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import { resolveWorkflowVersion, signalRuns, startRun } from './runs.ts';
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
    assert.ok(queries[0]?.sql.startsWith('insert into "workflow_runs"'));
    assert.deepEqual(queries[0]?.parameters, ['t', 'v', 'running', '{"a":1}']);
    assert.match(queries[1]?.sql ?? '', /insert into workflow_run_graphs/);
    assert.ok(queries[1]?.parameters.includes('r1'));
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } } }]);
    jobs.length = 0;
    await startRun(db, boss, { agencyId: 't', versionId: 'v', inputs: {}, interactive: true });
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } }, priority: 2 }]);
    await db.destroy();
  });
});

describe('signalRuns', () => {
  it('counts the signal before looking for waiters, so a run about to wait sees it', async () => {
    const { db, queries } = createRecordingDb(() => []);
    let inserts = 0;
    const boss: RunQueueClient = { insert: async () => void inserts++ };
    assert.equal(
      await signalRuns(db, boss, { agencyId: 't', name: 'claim', key: 'c1', payload: null }),
      0
    );
    assert.equal(inserts, 0);
    assert.equal(
      queries[0]?.sql,
      'insert into "signals" ("agency_id", "key", "received") values ($1, $2, $3) on conflict ("agency_id", "key") do update set "received" = signals.received + 1, "updated_at" = now()'
    );
    assert.deepEqual(queries[0]?.parameters, ['t', 'claim:c1', 1]);
    assert.ok(queries[1]?.sql.startsWith('select'));
    await db.destroy();
  });

  it('resumes every agency run waiting on the signal key', async () => {
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
      await signalRuns(db, boss, { agencyId: 't', name: 'claim', key: 'c1', payload: { a: 1 } }),
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

describe('resolveWorkflowVersion', () => {
  it('takes the newest visible version, then resolves it to the agency or organization override', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from unnest')
        ? [{ id: 'v-agency', key: 'billing.claim', version: 2, definition: {} }]
        : [{ version: 2 }]
    );
    assert.deepEqual(await resolveWorkflowVersion(db, 't', 'billing.claim'), {
      id: 'v-agency',
      version: 2
    });
    const [latest, resolve] = queries;
    assert.ok(latest?.sql.includes('order by g.organization_id is not null, v.version desc'));
    assert.deepEqual(latest?.parameters, ['billing.claim', 't', 't']);
    assert.deepEqual(resolve?.parameters.slice(0, 2), [['billing.claim'], [2]]);
    await db.destroy();
  });

  it('finds nothing when no version is published or none resolves', async () => {
    const none = createRecordingDb();
    assert.equal(await resolveWorkflowVersion(none.db, 't', 'billing.claim'), undefined);
    assert.equal(none.queries.length, 1);
    const unresolved = createRecordingDb((q) =>
      q.sql.includes('from unnest') ? [] : [{ version: 1 }]
    );
    assert.equal(await resolveWorkflowVersion(unresolved.db, 't', 'billing.claim'), undefined);
    await none.db.destroy();
    await unresolved.db.destroy();
  });
});
