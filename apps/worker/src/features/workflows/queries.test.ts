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
import { buildClaim, type ClaimedRun, createRunStore, taskNotification } from './queries.ts';

const recordingDb = (rows: Record<string, unknown>[] = []) => createRecordingDb(() => rows);

const parent: ClaimedRun = {
  id: 'p',
  lease: 'l',
  agencyId: 't',
  versionId: 'v',
  parentId: null,
  parentWait: null,
  inputs: {},
  state: null,
  graphs: [],
  tables: []
};

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
    const task = { agencyId: 't', kind: 'task' as const, title: 'Review PCR', subject: 'PCR-1' };
    assert.deepEqual(taskNotification(task, 'k1'), {
      agency_id: 't',
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

  it('upserts tasks idempotently and finds versions nearest the agency, preferring parent pins', async () => {
    const { db, queries } = recordingDb([{ id: 'v1', parent_index: 0 }]);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    await store.transaction(async (tx) => {
      await tx.insertTask({
        agencyId: 't',
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
        assigneeId: null,
        dueAt: null,
        permission: null
      });
      assert.equal(await tx.findVersion(parent, 'demo.x', 1), 'v1');
      assert.deepEqual(await tx.insertChildren(parent, '7', 'v1', [{}]), ['v1']);
    });
    const sqls = queries.map((q) => q.sql).join('\n');
    assert.ok(sqls.includes('on conflict ("run_id", "wait_id") do nothing returning "id"'));
    assert.ok(sqls.includes('insert into "notifications"'));
    assert.ok(sqls.includes('order by g.agency_id is null, g.organization_id is null'));
    const find = queries.find((q) => q.sql.includes('from workflow_run_graphs p'));
    assert.ok(find?.parameters.includes('p') && find.parameters.includes('t'));
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
      agencyId: 't',
      versionId: 'v',
      parentId: null,
      parentWait: null,
      inputs: {},
      state: null,
      graphs: [],
      tables: []
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

  it('claims nothing when no run matches the command', async () => {
    const { db } = recordingDb();
    assert.equal(
      await createRunStore({ db, boss: recordingBoss().boss }).claim(advance('r1'), 1000),
      undefined
    );
    await db.destroy();
  });

  it('reads the parent wait, its children in order and the active ones', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('for update')
        ? [{ status: 'suspended', wait_id: '7', kind: 'workflows' }]
        : q.sql.includes('order by "parent_index"')
          ? [
              { id: 'c0', status: 'completed', result: { pin: null, outputs: {} }, error: null },
              { id: 'c1', status: 'failed', result: null, error: { message: 'boom' } }
            ]
          : q.sql.includes('limit')
            ? []
            : [{ id: 'c2' }]
    );
    const store = createRunStore({ db, boss: recordingBoss().boss });
    await store.transaction(async (tx) => {
      assert.deepEqual(await tx.lockParent('p'), {
        status: 'suspended',
        waitId: '7',
        kind: 'workflows'
      });
      assert.equal(await tx.hasPendingChildren('p', '7'), false);
      assert.deepEqual(await tx.activeChildren('p'), ['c2']);
    });
    assert.deepEqual(await store.children('p', '7'), [
      { id: 'c0', status: 'completed', result: { pin: null, outputs: {} }, error: null },
      { id: 'c1', status: 'failed', result: null, error: { message: 'boom' } }
    ]);
    const pending = queries.find((q) => q.sql.includes('limit'));
    assert.deepEqual(pending?.parameters.slice(0, 2), ['p', '7']);
    assert.ok(
      pending?.parameters.includes('suspended') && !pending.parameters.includes('completed')
    );
    await db.destroy();
  });

  it('counts signals without consuming them and cancels only open tasks', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "signals"') ? [{ received: 3 }] : []
    );
    const store = createRunStore({ db, boss: recordingBoss().boss });
    await store.transaction(async (tx) => {
      assert.equal(await tx.lockSignal('t', 'claim:c1'), 3);
      await tx.cancelTasks('r1');
    });
    const [signal, cancel] = queries.map((q) => q.sql);
    assert.ok(signal?.endsWith('do update set "received" = signals.received returning "received"'));
    assert.ok(cancel?.startsWith('update "tasks" set "status" = $1'));
    assert.deepEqual(queries[1]?.parameters, ['cancelled', 'r1', 'open']);
    await db.destroy();
  });

  it('starts detached runs pinned to their parent graphs and assigns tasks only to agency members', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "workflow_runs"') || q.sql.startsWith('insert into "tasks"')
        ? [{ id: 'new-1' }]
        : []
    );
    const store = createRunStore({ db, boss: recordingBoss().boss });
    await store.transaction(async (tx) => {
      assert.equal(await tx.insertRun(parent, 'v1', { a: 1 }), 'new-1');
      await tx.insertTask({
        agencyId: 't',
        runId: 'r',
        waitId: '7',
        kind: 'task',
        queue: 'q',
        title: 'T',
        subject: null,
        instructions: '',
        context: null,
        fields: [],
        outcomes: ['ok'],
        defaults: null,
        priority: 0,
        assigneeId: 'u1',
        dueAt: '2026-12-01T00:00:00.000Z',
        permission: 'claims:approve'
      });
    });
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.deepEqual(run?.parameters, ['t', 'v1', 'running', JSON.stringify({ a: 1 })]);
    const pin = queries.find((q) => /insert into "?workflow_run_graphs/.test(q.sql));
    assert.ok(pin?.sql.includes('where p.run_id = $'));
    assert.ok(pin?.parameters.includes('p'));
    const task = queries.find((q) => q.sql.startsWith('insert into "tasks"'));
    assert.ok(task?.sql.includes('(select "user_id" from "memberships" where user_id::text = $'));
    assert.ok(task?.parameters.includes('u1'));
    const note = queries.find((q) => q.sql.startsWith('insert into "notifications"'));
    assert.ok(note?.parameters.includes('/tasks/new-1'));
    assert.ok(task?.parameters.includes('2026-12-01T00:00:00.000Z'));
    await db.destroy();
  });

  it('makes a date-only due date the end of that day in the agency time zone', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "tasks"') ? [{ id: 'new-1' }] : []
    );
    await createRunStore({ db, boss: recordingBoss().boss }).transaction((tx) =>
      tx.insertTask({
        agencyId: 't',
        runId: 'r',
        waitId: '7',
        kind: 'task',
        queue: 'q',
        title: 'T',
        subject: null,
        instructions: '',
        context: null,
        fields: [],
        outcomes: ['ok'],
        defaults: null,
        priority: 0,
        assigneeId: null,
        dueAt: '2026-11-10',
        permission: null
      })
    );
    const task = queries.find((q) => q.sql.startsWith('insert into "tasks"'));
    assert.ok(
      task?.sql.includes(
        "::date + interval '1 day' - interval '1 second') at time zone coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = $"
      )
    );
    assert.ok(task?.parameters.includes('2026-11-10'));
    await db.destroy();
  });
});
