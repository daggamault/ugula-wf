import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { advance } from '@ugula/run-queue';
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

describe('createRunStore', () => {
  it('only writes while holding the lease it claimed', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    const run = { id: 'r1', lease: 'l1' };
    await assert.rejects(
      () => store.transaction((tx) => tx.saveRun(run, { status: 'running', state: null })),
      /no longer leased/
    );
    await assert.rejects(() => store.checkpoint(run, {} as never, [], 1000), /no longer leased/);
    await assert.rejects(() => store.extend(run, 1000), /no longer leased/);
    await store.release(run, 'running');
    const fenced = queries.filter((q) => q.sql.startsWith('update'));
    assert.equal(fenced.length, 4);
    for (const q of fenced) {
      assert.ok(q.sql.includes('"lease_token" = $'));
      assert.ok(q.parameters.includes('l1'));
    }
    assert.ok(fenced[3]?.sql.includes('"lease_expires_at" = now()'));
    await db.destroy();
  });

  it('maps claimed rows', async () => {
    const { db } = recordingDb([
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
    assert.deepEqual(
      [claimed?.lease, claimed?.state, claimed?.graphs, claimed?.tables, claimed?.parentWait],
      ['', state, [], [], 'w1']
    );
    await db.destroy();
  });

  it('checkpoints the state and its steps, and extends the lease, while it holds the lease', async () => {
    const { db, queries } = createRecordingDb(({ sql }) => (sql.startsWith('update') ? [{}] : []));
    const store = createRunStore({ db, boss: recordingBoss().boss });
    const run = { id: 'r1', lease: 'l1' };
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
    await store.checkpoint(run, { status: 'running' } as never, [], 5000);
    await store.extend(run, 2500);
    const [save, steps, emptySave, extend] = queries;
    assert.ok(save?.sql.startsWith('update "workflow_runs" set "state" = $1'));
    assert.deepEqual(save?.parameters, ['{"status":"running"}', 5000, 'r1', 'l1']);
    assert.ok(steps?.sql.startsWith('insert into "workflow_run_steps"'));
    assert.deepEqual(steps?.parameters, [
      'r1',
      3,
      'main',
      'n1',
      'n1',
      'std.math.add',
      1,
      'eval',
      '{"a":1}',
      '{"sum":2}',
      null,
      '{"message":"boom","path":"n1","node":"n1"}',
      '2026-11-16T00:00:00.000Z',
      4
    ]);
    assert.ok(emptySave?.sql.startsWith('update "workflow_runs" set "state"'));
    assert.deepEqual(extend?.parameters, [2500, 'r1', 'l1']);
    assert.equal(queries.length, 4);
    await db.destroy();
  });

  it('clears the lease time when releasing a run that is not running', async () => {
    const { db, queries } = recordingDb();
    await createRunStore({ db, boss: recordingBoss().boss }).release(
      { id: 'r1', lease: 'l1' },
      'completed'
    );
    assert.equal(
      queries[0]?.sql,
      'update "workflow_runs" set "status" = $1, "lease_expires_at" = $2, "lease_token" = $3, "updated_at" = now() where "id" = $4 and "lease_token" = $5'
    );
    assert.deepEqual(queries[0]?.parameters, ['completed', null, null, 'r1', 'l1']);
    await db.destroy();
  });

  it('claims nothing when no run matches the command', async () => {
    const { db } = recordingDb();
    assert.equal(
      await createRunStore({ db, boss: recordingBoss().boss }).claim(advance('r1'), 1000),
      undefined
    );
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
    const sweep = queries.find((q) => q.sql.startsWith('update "workflow_runs"'))?.sql ?? '';
    assert.ok(sweep.includes('"lease_expires_at" < now()'));
    assert.ok(sweep.includes('"lease_expires_at" is null and "updated_at" < now() - interval'));
    assert.deepEqual(inserts[0], [
      { data: { runId: 'r1', command: { type: 'advance' } } },
      { data: { runId: 'r2', command: { type: 'advance' } }, group: { id: 'p' } }
    ]);
    await db.destroy();
  });

  it('prunes old steps of long-lived active runs in bounded batches', async () => {
    const { db, queries } = recordingDb();
    assert.equal(await createRunStore({ db, boss: recordingBoss().boss }).prune(), 0);
    const sql = queries[0]?.sql ?? '';
    assert.ok(sql.startsWith('delete from "workflow_run_steps" as "s" where (s.run_id, s.seq) in'));
    assert.ok(sql.includes('"r"."status" in') && sql.includes('limit $'));
    await db.destroy();
  });
});
