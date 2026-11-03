import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb, createRecordingDb } from '@ugula/db/testing';
import type { TraceEntry } from '@ugula/graph';
import {
  advance,
  RUN_QUEUE,
  type RunQueueClient,
  resume,
  type TimeoutClient,
  timeoutJobId
} from '@ugula/run-queue';
import { buildClaim, createRunStore, taskNotification } from './queries.ts';

const recordingDb = (rows: Record<string, unknown>[] = []) => createRecordingDb(() => rows);

const recordingBoss = () => {
  const inserts: { name: string; jobs: unknown[] }[] = [];
  const deleted: string[] = [];
  const boss: RunQueueClient & TimeoutClient = {
    insert: async (name, jobs, options) => {
      assert.equal(typeof options.db.executeSql, 'function');
      inserts.push({ name, jobs });
    },
    deleteJob: async (name, id, options) => {
      assert.equal(typeof options.db.executeSql, 'function');
      deleted.push(`${name}:${id}`);
    }
  };
  return { boss, inserts, deleted };
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
    await assert.rejects(() => store.extend(run, 1000), /no longer leased/);
    await store.release(run, 'running');
    const fenced = queries.filter((q) => q.sql.startsWith('update'));
    assert.equal(fenced.length, 4);
    for (const q of fenced) {
      assert.ok(q.sql.includes('"lease_token" = $'));
      assert.ok(q.parameters.includes('l1'));
    }
    assert.ok(fenced[3]?.sql.includes('"lease_until" = now()'));
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
        state: null,
        graphs: [{ id: 'v1', key: 'demo.x', version: 1 }]
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
      state: null,
      graphs: [{ id: 'v1', key: 'demo.x', version: 1 }]
    });
    await db.destroy();
  });

  it('writes steps in chunks and enqueues jobs inside the same transaction', async () => {
    const { db, queries } = createRecordingDb((q) => (q.sql.startsWith('update') ? [{}] : []));
    const { boss, inserts, deleted } = recordingBoss();
    const store = createRunStore({ db, boss });
    await store.transaction(async (tx) => {
      await tx.dropTimeout('r1', '6');
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
      await tx.enqueue([resume('r1', '7', null, '2026-01-01T00:00:00.000Z'), advance('r2', 'p1')]);
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
            startAfter: '2026-01-01T00:00:00.000Z',
            retryLimit: 1_000_000,
            priority: 1
          },
          { data: { runId: 'r2', command: { type: 'advance' } }, group: { id: 'p1' } }
        ]
      }
    ]);
    assert.deepEqual(deleted, [`${RUN_QUEUE}:${timeoutJobId('r1', '6')}`]);
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
    assert.ok(sweep.includes('"lease_until" < now()'));
    assert.ok(sweep.includes('"lease_until" is null and "updated_at" < now() - interval'));
    assert.deepEqual(inserts[0]?.jobs, [
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
            state: null,
            graphs: []
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

  it('names the claim a run works and starts draft recovery for its orphaned drafts', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('concat_ws')
        ? [{ reference: 'PCR-1 · Jane Doe' }]
        : q.sql.includes('with orphans as')
          ? [{ id: 'rec-1' }]
          : []
    );
    const store = createRunStore({ db, boss: recordingBoss().boss });
    const run = {
      id: 'r1',
      lease: 'l',
      tenantId: 't',
      versionId: 'v',
      parentId: null,
      parentWait: null,
      inputs: {},
      state: null,
      graphs: []
    };
    await store.transaction(async (tx) => {
      assert.equal(await tx.claimReference('r1'), 'PCR-1 · Jane Doe');
      assert.deepEqual(await tx.recoverDrafts(run, 'v-rec', 'The run was cancelled'), ['rec-1']);
    });
    const recover = queries.find((q) => q.sql.includes('with orphans as'));
    assert.ok(recover?.sql.includes("c.status = 'draft'"));
    assert.ok(recover?.sql.includes('and not exists ('));
    assert.ok(
      recover?.sql.includes("jsonb_build_object('claimId', o.id, 'report', o.report, 'reason'")
    );
    assert.ok(recover?.sql.includes('insert into claim_runs (run_id, claim_id)'));
    assert.deepEqual(recover?.parameters.slice(0, 2), ['r1', 'r1']);
    assert.ok(recover?.parameters.includes('The run was cancelled'));
    assert.ok(queries.some((q) => /insert into "?workflow_run_graphs/.test(q.sql)));
    await db.destroy();
  });

  it('has no claim reference for runs that work no claim', async () => {
    const { db } = recordingDb();
    const store = createRunStore({ db, boss: recordingBoss().boss });
    assert.equal(await store.transaction((tx) => tx.claimReference('r1')), null);
    await db.destroy();
  });
});
