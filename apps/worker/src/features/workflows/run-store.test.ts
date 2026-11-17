import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { advance, resume } from '@ugula/run-queue';
import { createRunStore } from './run-store.ts';
import type { QueueClient } from './run-tx.ts';

const recordingBoss = () => {
  const inserts: unknown[][] = [];
  const boss: QueueClient = {
    insert: async (_, jobs) => void inserts.push(jobs),
    deleteJob: async () => {}
  };
  return { boss, inserts };
};

const recordingDb = (rows: Record<string, unknown>[] = []) => createRecordingDb(() => rows);

const updatedDb = () => createRecordingDb(({ sql }) => (sql.startsWith('update') ? [{}] : []));

const run = { id: 'r1', lease: 'l1' };

const CHECKPOINT =
  'update "workflow_runs" set "state" = $1, "lease_expires_at" = now() + $2 * interval \'1 millisecond\', "updated_at" = now() where "id" = $3 and "lease_token" = $4';

const EXTEND =
  'update "workflow_runs" set "lease_expires_at" = now() + $1 * interval \'1 millisecond\' where "id" = $2 and "lease_token" = $3';

describe('createRunStore', () => {
  it('maps a claimed row', async () => {
    const { db, queries } = recordingDb([
      {
        id: 'r1',
        lease_token: 'l1',
        agency_id: 't1',
        graph_version_id: 'v1',
        parent_id: null,
        parent_wait: null,
        inputs: { a: 1 },
        state: null,
        graphs: [{ id: 'v1', key: 'demo.x', version: 1 }],
        tables: [{ id: 't1', key: 'demo.table' }]
      }
    ]);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    assert.deepEqual(await store.claim(advance('r1'), 1000), {
      id: 'r1',
      lease: 'l1',
      agencyId: 't1',
      versionId: 'v1',
      parentId: null,
      parentWait: null,
      inputs: { a: 1 },
      state: null,
      graphs: [{ id: 'v1', key: 'demo.x', version: 1 }],
      tables: [{ id: 't1', key: 'demo.table' }]
    });
    assert.deepEqual(queries[0]?.parameters, ['running', 1000, 'r1', 'running']);
    await db.destroy();
  });

  it('maps a claimed row with no lease token, version lists or blank state to defaults', async () => {
    const state = { status: 'running', frames: [] };
    const { db } = recordingDb([
      {
        id: 'r1',
        lease_token: null,
        agency_id: 't1',
        graph_version_id: 'v1',
        parent_id: 'p1',
        parent_wait: 'w1',
        inputs: {},
        state,
        graphs: null,
        tables: null
      }
    ]);
    const claimed = await createRunStore({ db, boss: recordingBoss().boss }).claim(
      advance('r1'),
      1000
    );
    assert.deepEqual(claimed, {
      id: 'r1',
      lease: '',
      agencyId: 't1',
      versionId: 'v1',
      parentId: 'p1',
      parentWait: 'w1',
      inputs: {},
      state,
      graphs: [],
      tables: []
    });
    await db.destroy();
  });

  it('claims nothing when no run matches the command', async () => {
    const { db } = recordingDb();
    assert.equal(
      await createRunStore({ db, boss: recordingBoss().boss }).claim(resume('r1', '7', null), 1000),
      undefined
    );
    await db.destroy();
  });

  it('checkpoints the state and its steps under the lease and pushes the lease out', async () => {
    const { db, queries } = updatedDb();
    const store = createRunStore({ db, boss: recordingBoss().boss });
    const step = {
      seq: 3,
      scope: 'main',
      path: 'n1',
      node: 'n1',
      type: 'std.math.add',
      version: 1,
      event: 'eval' as const,
      inputs: { a: 1 },
      outputs: { sum: 2 },
      pin: null,
      error: { message: 'boom', path: 'n1', node: 'n1' },
      startedAt: '2026-11-16T00:00:00.000Z',
      durationMs: 4
    };
    await store.checkpoint(run, { status: 'running' } as never, [step], 5000);
    assert.equal(queries.length, 2);
    const [save, steps] = queries;
    assert.equal(save?.sql, CHECKPOINT);
    assert.deepEqual(save?.parameters, ['{"status":"running"}', 5000, 'r1', 'l1']);
    assert.match(steps?.sql ?? '', /^insert into "workflow_run_steps" /);
    assert.deepEqual(steps?.parameters, [
      'r1',
      JSON.stringify([
        {
          seq: 3,
          scope: 'main',
          path: 'n1',
          node: 'n1',
          node_type: 'std.math.add',
          node_version: 1,
          event: 'eval',
          inputs: { a: 1 },
          outputs: { sum: 2 },
          pin: null,
          error: { message: 'boom', path: 'n1', node: 'n1' },
          started_at: '2026-11-16T00:00:00.000Z',
          duration_ms: 4
        }
      ])
    ]);
    await db.destroy();
  });

  it('checkpoints only the state when there are no new steps', async () => {
    const { db, queries } = updatedDb();
    await createRunStore({ db, boss: recordingBoss().boss }).checkpoint(
      run,
      { status: 'running' } as never,
      [],
      5000
    );
    assert.deepEqual(
      queries.map((q) => q.sql),
      [CHECKPOINT]
    );
    await db.destroy();
  });

  it('extends the lease it holds', async () => {
    const { db, queries } = updatedDb();
    await createRunStore({ db, boss: recordingBoss().boss }).extend(run, 2500);
    assert.equal(queries[0]?.sql, EXTEND);
    assert.deepEqual(queries[0]?.parameters, [2500, 'r1', 'l1']);
    await db.destroy();
  });

  it('writes nothing more once another worker took the lease', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    await assert.rejects(
      () => store.transaction((tx) => tx.saveRun(run, { status: 'running', state: null })),
      /Run r1 is no longer leased by this worker/
    );
    await assert.rejects(
      () => store.checkpoint(run, {} as never, [{} as never], 1000),
      /Run r1 is no longer leased by this worker/
    );
    await assert.rejects(
      () => store.extend(run, 1000),
      /Run r1 is no longer leased by this worker/
    );
    assert.deepEqual(
      queries.map((q) => [q.sql.split(' set ')[0], q.parameters.slice(-2)]),
      [
        ['update "workflow_runs"', ['r1', 'l1']],
        ['update "workflow_runs"', ['r1', 'l1']],
        ['update "workflow_runs"', ['r1', 'l1']]
      ]
    );
    await db.destroy();
  });

  it('releases a running run as due at once so it can be claimed again', async () => {
    const { db, queries } = recordingDb();
    await createRunStore({ db, boss: recordingBoss().boss }).release(run, 'running');
    assert.equal(
      queries[0]?.sql,
      'update "workflow_runs" set "status" = $1, "lease_expires_at" = now(), "lease_token" = $2, "updated_at" = now() where "id" = $3 and "lease_token" = $4'
    );
    assert.deepEqual(queries[0]?.parameters, ['running', null, 'r1', 'l1']);
    await db.destroy();
  });

  it('clears the lease time when releasing a run that is not running', async () => {
    const { db, queries } = recordingDb();
    await createRunStore({ db, boss: recordingBoss().boss }).release(run, 'completed');
    assert.equal(
      queries[0]?.sql,
      'update "workflow_runs" set "status" = $1, "lease_expires_at" = $2, "lease_token" = $3, "updated_at" = now() where "id" = $4 and "lease_token" = $5'
    );
    assert.deepEqual(queries[0]?.parameters, ['completed', null, null, 'r1', 'l1']);
    await db.destroy();
  });

  it('reads the children of a wait outside a transaction', async () => {
    const { db, queries } = recordingDb([
      { id: 'c0', status: 'completed', result: null, error: null }
    ]);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    assert.deepEqual(await store.children('p', '7'), [
      { id: 'c0', status: 'completed', result: null, error: null }
    ]);
    assert.equal(
      queries[0]?.sql,
      'select "id", "status", "result", "error" from "workflow_runs" where "parent_id" = $1 and "parent_wait" = $2 order by "parent_index"'
    );
    assert.deepEqual(queries[0]?.parameters, ['p', '7']);
    await db.destroy();
  });

  it('sweeps expired leases and stranded unleased runs back onto the queue', async () => {
    const { db, queries } = recordingDb([
      { id: 'r1', parent_id: null },
      { id: 'r2', parent_id: 'p' }
    ]);
    const { boss, inserts } = recordingBoss();
    assert.equal(await createRunStore({ db, boss }).sweep(), 2);
    assert.equal(
      queries[0]?.sql,
      'update "workflow_runs" set "lease_expires_at" = $1, "lease_token" = $2, "updated_at" = now() where "status" = $3 and ("lease_expires_at" < now() or ("lease_expires_at" is null and "updated_at" < now() - interval \'10 minutes\')) returning "id", "parent_id"'
    );
    assert.deepEqual(queries[0]?.parameters, [null, null, 'running']);
    assert.deepEqual(inserts, [
      [
        { data: { runId: 'r1', command: { type: 'advance' } } },
        { data: { runId: 'r2', command: { type: 'advance' } }, group: { id: 'p' } }
      ]
    ]);
    await db.destroy();
  });

  it('enqueues nothing when no run is stranded', async () => {
    const { db } = recordingDb();
    const { boss, inserts } = recordingBoss();
    assert.equal(await createRunStore({ db, boss }).sweep(), 0);
    assert.deepEqual(inserts, []);
    await db.destroy();
  });

  it('prunes month-old steps of active runs and events that started nothing, in batches', async () => {
    const { db, queries } = recordingDb([{}, {}, {}]);
    assert.equal(await createRunStore({ db, boss: recordingBoss().boss }).prune(), 6);
    assert.equal(
      queries[0]?.sql,
      'delete from "workflow_run_steps" as "s" where (s.run_id, s.seq) in ((select "o"."run_id", "o"."seq" from "workflow_run_steps" as "o" inner join "workflow_runs" as "r" on "r"."id" = "o"."run_id" where "r"."status" in ($1, $2, $3) and "r"."created_at" < now() - interval \'30 days\' and "o"."started_at" < now() - interval \'30 days\' limit $4))'
    );
    assert.deepEqual(queries[0]?.parameters, ['running', 'suspended', 'faulted', 10_000]);
    assert.equal(
      queries[1]?.sql,
      `delete from "events" as "e" where "e"."id" in (select "o"."id" from "events" as "o" where "o"."dispatched_at" < now() - interval '30 days' and not exists (select "er"."run_id" from "event_runs" as "er" where "er"."event_id" = "o"."id") limit $1)`
    );
    await db.destroy();
  });
});
