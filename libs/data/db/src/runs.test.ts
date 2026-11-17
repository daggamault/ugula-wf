import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import { buildFindPublishedGraphs, buildLatestVersion } from './graph-versions.ts';
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

describe('signalRuns', () => {
  it('counts the signal before looking for waiters, so a run about to wait sees it', async () => {
    const { db, queries } = createRecordingDb(() => []);
    let inserts = 0;
    const boss: RunQueueClient = { insert: async () => void inserts++ };
    assert.equal(
      await signalRuns(db, boss, { agencyId: 't', name: 'claim', keys: ['c1'], payload: null }),
      0
    );
    assert.equal(inserts, 0);
    assert.equal(
      queries[0]?.sql,
      'insert into "signals" ("agency_id", "key", "received") values ($1, $2, $3) on conflict ("agency_id", "key") do update set "received" = signals.received + 1, "updated_at" = now()'
    );
    assert.deepEqual(queries[0]?.parameters, ['t', 'claim:c1', 1]);
    assert.equal(
      queries[1]?.sql,
      `select "id", state -> 'suspension' ->> 'id' as "wait_id" from "workflow_runs" where "agency_id" = $1 and "wait_key" in ($2) and "status" = $3`
    );
    assert.deepEqual(queries[1]?.parameters, ['t', 'claim:c1', 'suspended']);
    await db.destroy();
  });

  it('counts each key once in one statement and signals nothing for no keys', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const boss: RunQueueClient = { insert: async () => undefined };
    const keys = ['c1', 'c2', 'c1'];
    await signalRuns(db, boss, { agencyId: 't', name: 'claim', keys, payload: null });
    assert.deepEqual(queries[0]?.parameters, ['t', 'claim:c1', 1, 't', 'claim:c2', 1]);
    assert.deepEqual(queries[1]?.parameters, ['t', 'claim:c1', 'claim:c2', 'suspended']);
    assert.equal(
      await signalRuns(db, boss, { agencyId: 't', name: 'claim', keys: [], payload: null }),
      0
    );
    assert.equal(queries.length, 2);
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
      await signalRuns(db, boss, {
        agencyId: 't',
        name: 'claim',
        keys: ['c1'],
        payload: { a: 1 }
      }),
      2
    );
    assert.deepEqual(queries[1]?.parameters, ['t', 'claim:c1', 'suspended']);
    assert.deepEqual(jobs, [
      {
        data: {
          runId: 'r1',
          command: { type: 'resume', suspensionId: '7', payload: { payload: { a: 1 } } }
        },
        priority: 2,
        retryLimit: 1_000_000
      },
      {
        data: {
          runId: 'r2',
          command: { type: 'resume', suspensionId: '9', payload: { payload: { a: 1 } } }
        },
        priority: 2,
        retryLimit: 1_000_000
      }
    ]);
    await db.destroy();
  });
});

describe('resolveWorkflowVersion', () => {
  it('takes the newest visible version, then resolves it to the agency override', async () => {
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
    assert.equal(latest?.sql, buildLatestVersion('t', 'billing.claim').compile(db).sql);
    assert.deepEqual(latest?.parameters, ['billing.claim', 't']);
    assert.equal(
      resolve?.sql,
      buildFindPublishedGraphs('t', [{ key: 'billing.claim', version: 2 }]).compile(db).sql
    );
    assert.deepEqual(resolve?.parameters, [['billing.claim'], [2], 't']);
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
