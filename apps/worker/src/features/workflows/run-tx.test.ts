import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { TraceEntry } from '@ugula/graph';
import { advance, RUN_QUEUE, resume, timeout } from '@ugula/run-queue';
import type { ClaimedRun } from './run-lease.ts';
import { createRunTx, type QueueClient } from './run-tx.ts';

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
  const boss: QueueClient = {
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

describe('createRunTx', () => {
  it('saves a run only while holding its lease', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const tx = createRunTx(db, recordingBoss().boss);
    await assert.rejects(
      () => tx.saveRun({ id: 'r1', lease: 'l1' }, { status: 'running', state: null }),
      /no longer leased/
    );
    assert.ok(queries[0]?.sql.includes('"lease_token" = $'));
    assert.ok(queries[0]?.parameters.includes('l1'));
    await db.destroy();
  });

  it('writes steps in chunks and enqueues jobs inside the same transaction', async () => {
    const { db, queries } = createRecordingDb((q) => (q.sql.startsWith('update') ? [{}] : []));
    const { boss, inserts, deleted } = recordingBoss();
    const tx = createRunTx(db, boss);
    await tx.dropTimeout('r1', '6');
    await tx.insertSteps(
      'r1',
      Array.from({ length: 501 }, (_, i) => step(i))
    );
    await tx.saveRun(
      { id: 'r1', lease: 'l1' },
      { status: 'completed', state: null, result: { pin: null, outputs: {} } }
    );
    await tx.enqueue([resume('r1', '7', null, '2026-01-01T00:00:00.000Z'), advance('r2', 'p1')]);
    await tx.enqueue([]);
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
    assert.deepEqual(deleted, [`${RUN_QUEUE}:${timeout('r1', '6', '2026-01-01').id}`]);
    await db.destroy();
  });

  it('inserts tasks and finds versions nearest the agency, preferring parent pins', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'v1', parent_index: 0 }]);
    const tx = createRunTx(db, recordingBoss().boss);
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
    const sqls = queries.map((q) => q.sql).join('\n');
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
    const tx = createRunTx(db, recordingBoss().boss);
    assert.equal(await tx.claimReference('r1'), 'PCR-1 · Jane Doe');
    assert.deepEqual(
      await tx.recoverDrafts({ ...parent, id: 'r1' }, 'v-rec', 'The run was cancelled'),
      ['rec-1']
    );
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
    const { db } = createRecordingDb(() => []);
    assert.equal(await createRunTx(db, recordingBoss().boss).claimReference('r1'), null);
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
    const tx = createRunTx(db, recordingBoss().boss);
    assert.deepEqual(await tx.lockParent('p'), {
      status: 'suspended',
      waitId: '7',
      kind: 'workflows'
    });
    assert.equal(await tx.hasPendingChildren('p', '7'), false);
    assert.deepEqual(await tx.activeChildren('p'), ['c2']);
    assert.deepEqual(await tx.children('p', '7'), [
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
    const tx = createRunTx(db, recordingBoss().boss);
    assert.equal(await tx.lockSignal('t', 'claim:c1'), 3);
    await tx.cancelTasks('r1');
    const [signal, cancel] = queries.map((q) => q.sql);
    assert.ok(signal?.endsWith('do update set "received" = signals.received returning "received"'));
    assert.ok(cancel?.startsWith('update "tasks" set "status" = $1'));
    await db.destroy();
  });

  it('starts detached runs pinned to their parent graphs', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "workflow_runs"') ? [{ id: 'new-1' }] : []
    );
    const tx = createRunTx(db, recordingBoss().boss);
    assert.equal(await tx.insertRun(parent, 'v1', { a: 1 }), 'new-1');
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.deepEqual(run?.parameters, ['t', 'v1', 'running', JSON.stringify({ a: 1 })]);
    const pin = queries.find((q) => /insert into "?workflow_run_graphs/.test(q.sql));
    assert.ok(pin?.sql.includes('where p.run_id = $'));
    assert.ok(pin?.parameters.includes('p'));
    await db.destroy();
  });
});
