import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb, createRecordingDb } from '@ugula/db';
import type { TraceEntry } from '@ugula/graph';
import { advance, type JobBoss, RUN_QUEUE, resume } from '@ugula/jobs';
import { buildClaim, createRunStore, taskNotification } from './queries.ts';

const recordingDb = (rows: Record<string, unknown>[] = []) => createRecordingDb(() => rows);

const recordingBoss = () => {
  const inserts: { name: string; jobs: unknown[] }[] = [];
  const boss: JobBoss = {
    insert: async (name, jobs, options) => {
      assert.equal(typeof options.db.executeSql, 'function');
      inserts.push({ name, jobs });
    }
  };
  return { boss, inserts };
};

const step = (seq: number): TraceEntry => ({
  seq,
  scope: 's1',
  path: '',
  node: 'n',
  type: 'std.math.add',
  version: 1,
  event: 'eval',
  inputs: { a: 1 },
  outputs: { result: 2 },
  pin: null,
  error: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 0.1
});

describe('taskNotification', () => {
  it('announces new tasks and stuck runs with a link to the task', () => {
    const task = { tenantId: 't', kind: 'task' as const, title: 'Review PCR', subject: 'PCR-1' };
    assert.deepEqual(taskNotification(task, 'k1'), {
      tenant_id: 't',
      intent: 'info',
      title: 'New task: Review PCR',
      description: 'PCR-1',
      link_label: 'Open task',
      link_to: '/tasks/k1'
    });
    const fault = taskNotification({ ...task, kind: 'fault', title: 'Stuck at Price' }, 'k2');
    assert.equal(fault.intent, 'danger');
    assert.equal(fault.title, 'Stuck run: Stuck at Price');
  });
});

describe('buildClaim', () => {
  it('claims only unleased runs in the status each command expects', async () => {
    const db = createDummyDb();
    const sqlFor = (command: Parameters<typeof buildClaim>[1]['command']) =>
      buildClaim(db, { runId: 'r', command }, 1000).compile().sql;
    assert.ok(
      sqlFor({ type: 'advance' }).includes('"lease_until" is null or "lease_until" < now()')
    );
    assert.ok(sqlFor({ type: 'advance' }).includes('"status" = $'));
    assert.ok(
      sqlFor({ type: 'resume', suspensionId: '7', payload: null }).includes(
        `state -> 'suspension' ->> 'id' = $`
      )
    );
    assert.ok(sqlFor({ type: 'cancel' }).includes('"status" in ($'));
    assert.ok(!sqlFor({ type: 'cancel' }).includes('"lease_until" is null'));
    assert.ok(sqlFor({ type: 'advance' }).includes('"lease_token" = gen_random_uuid()'));
    const compiled = buildClaim(db, { runId: 'r', command: { type: 'retry' } }, 1000).compile();
    assert.ok(compiled.parameters.includes('faulted'));
    assert.ok(compiled.sql.includes("interval '1 millisecond'"));
    await db.destroy();
  });
});

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
    await store.release(run, 'running');
    const fenced = queries.filter((q) => q.sql.startsWith('update'));
    assert.equal(fenced.length, 3);
    for (const q of fenced) {
      assert.ok(q.sql.includes('"lease_token" = $'));
      assert.ok(q.parameters.includes('l1'));
    }
    assert.ok(fenced[2]?.sql.includes('"lease_until" = now()'));
    await db.destroy();
  });

  it('maps claimed rows', async () => {
    const { db } = recordingDb([
      {
        id: 'r1',
        lease_token: 'l1',
        tenant_id: 't1',
        graph_version_id: 'v1',
        parent_id: null,
        parent_wait: null,
        inputs: { a: 1 },
        state: null
      }
    ]);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    assert.deepEqual(await store.claim(advance('r1'), 1000), {
      id: 'r1',
      lease: 'l1',
      tenantId: 't1',
      versionId: 'v1',
      parentId: null,
      parentWait: null,
      inputs: { a: 1 },
      state: null
    });
    await db.destroy();
  });

  it('writes steps in chunks and enqueues jobs inside the same transaction', async () => {
    const { db, queries } = createRecordingDb((q) => (q.sql.startsWith('update') ? [{}] : []));
    const { boss, inserts } = recordingBoss();
    const store = createRunStore({ db, boss });
    await store.transaction(async (tx) => {
      await tx.insertSteps(
        'r1',
        Array.from({ length: 501 }, (_, i) => step(i))
      );
      await tx.saveRun(
        { id: 'r1', lease: 'l1' },
        {
          status: 'completed',
          state: null,
          result: { pin: null, outputs: {} }
        }
      );
      await tx.enqueue([resume('r1', '7', null, '2026-01-01T00:00:00.000Z'), advance('r2')]);
      await tx.enqueue([]);
    });
    const sqls = queries.map((q) => q.sql);
    assert.equal(sqls.filter((s) => s.startsWith('insert into "workflow_run_steps"')).length, 2);
    const save = queries.find((q) => q.sql.startsWith('update "workflow_runs"'));
    assert.ok(save?.sql.includes('"completed_at" = now()'));
    assert.deepEqual(inserts, [
      {
        name: RUN_QUEUE,
        jobs: [
          {
            data: { runId: 'r1', command: { type: 'resume', suspensionId: '7', payload: null } },
            startAfter: '2026-01-01T00:00:00.000Z'
          },
          { data: { runId: 'r2', command: { type: 'advance' } } }
        ]
      }
    ]);
    await db.destroy();
  });

  it('sweeps expired leases back onto the queue', async () => {
    const { db, queries } = recordingDb([{ id: 'r1' }, { id: 'r2' }]);
    const { boss, inserts } = recordingBoss();
    assert.equal(await createRunStore({ db, boss }).sweep(), 2);
    assert.ok(queries.some((q) => q.sql.includes('"lease_until" < now()')));
    assert.equal(inserts[0]?.jobs.length, 2);
    await db.destroy();
  });

  it('upserts tasks idempotently and finds tenant versions before global ones', async () => {
    const { db, queries } = recordingDb([{ id: 'v1', parent_index: 0 }]);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    await store.transaction(async (tx) => {
      await tx.insertTask({
        tenantId: 't',
        runId: 'r',
        waitId: '7',
        kind: 'task',
        queue: 'q',
        title: 'T',
        subject: 'PCR-1',
        instructions: '',
        context: null,
        fields: [],
        outcomes: ['ok'],
        defaults: null,
        priority: 0,
        assigneeId: null
      });
      assert.equal(await tx.findVersion('t', 'demo.x', 1), 'v1');
      assert.deepEqual(
        await tx.insertChildren(
          {
            id: 'p',
            lease: 'l',
            tenantId: 't',
            versionId: 'v',
            parentId: null,
            parentWait: null,
            inputs: {},
            state: null
          },
          '7',
          'v1',
          [{}]
        ),
        ['v1']
      );
    });
    const sqls = queries.map((q) => q.sql).join('\n');
    assert.ok(sqls.includes('on conflict ("run_id", "wait_id") do nothing returning "id"'));
    assert.ok(sqls.includes('insert into "notifications"'));
    assert.ok(sqls.includes('g.tenant_id nulls last'));
    await db.destroy();
  });
});
