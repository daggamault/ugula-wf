import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunState, TraceEntry } from '@ugula/graph';
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

const flat = (sql: string | undefined) => sql?.replace(/\s+/g, ' ');

const SAVE =
  'update "workflow_runs" set "status" = $1, "state" = $2, "result" = $3, "error" = $4, "wait_key" = $5, "lease_expires_at" = $6, "lease_token" = $7, "updated_at" = now(), "completed_at" = ';

const STEPS =
  'insert into "workflow_run_steps" ("run_id", "seq", "scope", "path", "node", "node_type", "node_version", "event", "inputs", "outputs", "pin", "error", "started_at", "duration_ms") select $1::uuid, "s"."seq", "s"."scope", "s"."path", "s"."node", "s"."node_type", "s"."node_version", "s"."event", "s"."inputs", "s"."outputs", "s"."pin", "s"."error", "s"."started_at", "s"."duration_ms" from jsonb_to_recordset($2::jsonb) as s(seq int, scope text, path text, node text, node_type text, node_version int, event text, inputs jsonb, outputs jsonb, pin text, error jsonb, started_at timestamptz, duration_ms float8)';

const isPin = (sql: string) => /^\s*insert into workflow_run_graphs /.test(sql);

describe('createRunTx', () => {
  describe('saveRun', () => {
    const updated = () => createRecordingDb((q) => (q.sql.startsWith('update') ? [{}] : []));

    it('saves a suspended run with its state and wait key, releasing the lease', async () => {
      const { db, queries } = updated();
      const state = { status: 'suspended', seq: 4 } as unknown as RunState;
      await createRunTx(db, recordingBoss().boss).saveRun(
        { id: 'r1', lease: 'l1' },
        { status: 'suspended', state, waitKey: 'claim:c1' }
      );
      assert.equal(queries[0]?.sql, `${SAVE}$8 where "id" = $9 and "lease_token" = $10`);
      assert.deepEqual(queries[0]?.parameters, [
        'suspended',
        '{"status":"suspended","seq":4}',
        null,
        null,
        'claim:c1',
        null,
        null,
        null,
        'r1',
        'l1'
      ]);
      await db.destroy();
    });

    it('stamps the completion time of a run that reached a terminal status', async () => {
      const { db, queries } = updated();
      const tx = createRunTx(db, recordingBoss().boss);
      await tx.saveRun(
        { id: 'r1', lease: 'l1' },
        { status: 'completed', state: null, result: { pin: null, outputs: {} } }
      );
      await tx.saveRun(
        { id: 'r1', lease: 'l1' },
        { status: 'failed', state: null, error: { message: 'boom' } }
      );
      assert.deepEqual(
        queries.map((q) => [q.sql, q.parameters]),
        [
          [
            `${SAVE}now() where "id" = $8 and "lease_token" = $9`,
            ['completed', null, '{"pin":null,"outputs":{}}', null, null, null, null, 'r1', 'l1']
          ],
          [
            `${SAVE}now() where "id" = $8 and "lease_token" = $9`,
            ['failed', null, null, '{"message":"boom"}', null, null, null, 'r1', 'l1']
          ]
        ]
      );
      await db.destroy();
    });

    it('refuses to save a run whose lease another worker took', async () => {
      const { db } = createRecordingDb(() => []);
      await assert.rejects(
        () =>
          createRunTx(db, recordingBoss().boss).saveRun(
            { id: 'r1', lease: 'l1' },
            { status: 'running', state: null }
          ),
        /Run r1 is no longer leased by this worker/
      );
      await db.destroy();
    });
  });

  describe('insertSteps', () => {
    it('writes a chunk of steps as one JSON parameter, keeping values as JSON', async () => {
      const { db, queries } = createRecordingDb(() => []);
      await createRunTx(db, recordingBoss().boss).insertSteps('r1', [
        step(1),
        { ...step(2), error: { message: 'x', path: '', node: 'n' } }
      ]);
      assert.equal(queries.length, 1);
      assert.equal(flat(queries[0]?.sql), STEPS);
      assert.equal(queries[0]?.parameters[0], 'r1');
      assert.deepEqual(JSON.parse(String(queries[0]?.parameters[1])), [
        {
          seq: 1,
          scope: 's1',
          path: '',
          node: 'n',
          node_type: 'std.math.add',
          node_version: 1,
          event: 'eval',
          inputs: { a: 1 },
          outputs: { result: 2 },
          pin: null,
          error: null,
          started_at: '2026-01-01T00:00:00.000Z',
          duration_ms: 0.1
        },
        {
          seq: 2,
          scope: 's1',
          path: '',
          node: 'n',
          node_type: 'std.math.add',
          node_version: 1,
          event: 'eval',
          inputs: { a: 1 },
          outputs: { result: 2 },
          pin: null,
          error: { message: 'x', path: '', node: 'n' },
          started_at: '2026-01-01T00:00:00.000Z',
          duration_ms: 0.1
        }
      ]);
      await db.destroy();
    });

    it('writes steps in chunks of 5000 and nothing when there are none', async () => {
      const { db, queries } = createRecordingDb(() => []);
      const tx = createRunTx(db, recordingBoss().boss);
      await tx.insertSteps('r1', []);
      assert.equal(queries.length, 0);
      await tx.insertSteps(
        'r1',
        Array.from({ length: 5_001 }, (_, i) => step(i))
      );
      const chunks = queries.map((q) =>
        (JSON.parse(String(q.parameters[1])) as { seq: number }[]).map((s) => s.seq)
      );
      assert.deepEqual(
        chunks.map((seqs) => [seqs.length, seqs[0], seqs.at(-1)]),
        [
          [5_000, 0, 4_999],
          [1, 5_000, 5_000]
        ]
      );
      await db.destroy();
    });
  });

  describe('queue', () => {
    it('enqueues jobs and drops timeouts inside the same transaction', async () => {
      const { db } = createRecordingDb(() => []);
      const { boss, inserts, deleted } = recordingBoss();
      const tx = createRunTx(db, boss);
      await tx.dropTimeout('r1', '6');
      await tx.enqueue([resume('r1', '7', null, '2026-01-01T00:00:00.000Z'), advance('r2', 'p1')]);
      await tx.enqueue([]);
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
  });

  describe('tasks', () => {
    it('inserts tasks with their notification and cancels only open tasks', async () => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.startsWith('insert into "tasks"') ? [{ id: 'k1' }] : []
      );
      const tx = createRunTx(db, recordingBoss().boss);
      await tx.insertTask({
        agencyId: 't',
        runId: 'r',
        waitId: '7',
        kind: 'task',
        queue: 'q',
        title: 'T',
        subject: 'PCR-1',
        summary: null,
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
      await tx.cancelTasks('r1');
      assert.deepEqual(
        queries.map((q) => q.sql.split(' (')[0]?.split(' set ')[0]),
        ['insert into "tasks"', 'insert into "notifications"', 'update "tasks"']
      );
      assert.deepEqual(queries[2]?.parameters, ['cancelled', 'r1', 'open']);
      await db.destroy();
    });
  });

  describe('findVersion', () => {
    it('looks the version up for the run agency, preferring the run pins', async () => {
      const { db, queries } = createRecordingDb(() => [{ id: 'v1' }, { id: 'v2' }]);
      assert.equal(
        await createRunTx(db, recordingBoss().boss).findVersion(parent, 'demo.x', 3),
        'v1'
      );
      assert.deepEqual(queries[0]?.parameters, [['demo.x'], [3], 'p', 't']);
      assert.match(queries[0]?.sql ?? '', /order by g\.agency_id is null, v\.version desc/);
      await db.destroy();
    });

    it('finds nothing for an unpublished workflow', async () => {
      const { db } = createRecordingDb(() => []);
      assert.equal(
        await createRunTx(db, recordingBoss().boss).findVersion(parent, 'demo.x', 3),
        undefined
      );
      await db.destroy();
    });
  });

  describe('insertRun', () => {
    it('starts a detached run in the parent agency pinned to the parent graphs', async () => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.startsWith('insert into "workflow_runs"') ? [{ id: 'new-1' }] : []
      );
      assert.equal(
        await createRunTx(db, recordingBoss().boss).insertRun(parent, 'v1', { a: 1 }),
        'new-1'
      );
      assert.equal(
        queries[0]?.sql,
        'insert into "workflow_runs" ("agency_id", "graph_version_id", "status", "inputs") values ($1, $2, $3, $4) returning "id"'
      );
      assert.deepEqual(queries[0]?.parameters, ['t', 'v1', 'running', '{"a":1}']);
      const pin = queries.find((q) => isPin(q.sql));
      assert.deepEqual(pin?.parameters, ['v1', 'p', 't', 'new-1']);
      await db.destroy();
    });
  });

  describe('insertChildren', () => {
    it('inserts children indexed in input order and returns their ids in that order', async () => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.startsWith('insert into "workflow_runs"')
          ? [
              { id: 'c1', parent_index: 1 },
              { id: 'c0', parent_index: 0 }
            ]
          : []
      );
      const ids = await createRunTx(db, recordingBoss().boss).insertChildren(parent, '7', 'v1', [
        { a: 1 },
        { a: 2 }
      ]);
      assert.deepEqual(ids, ['c0', 'c1']);
      assert.equal(
        queries[0]?.sql,
        'insert into "workflow_runs" ("agency_id", "graph_version_id", "parent_id", "parent_wait", "parent_index", "status", "inputs") values ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14) returning "id", "parent_index"'
      );
      assert.deepEqual(queries[0]?.parameters, [
        't',
        'v1',
        'p',
        '7',
        0,
        'running',
        '{"a":1}',
        't',
        'v1',
        'p',
        '7',
        1,
        'running',
        '{"a":2}'
      ]);
      assert.deepEqual(queries.find((q) => isPin(q.sql))?.parameters, ['v1', 'p', 't', 'c0']);
      await db.destroy();
    });

    it('inserts children in chunks of 1000, continuing the index across chunks', async () => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.startsWith('insert into "workflow_runs"')
          ? Array.from({ length: q.parameters.length / 7 }, (_, j) => {
              const index = Number(q.parameters[j * 7 + 4]);
              return { id: `c${index}`, parent_index: index };
            })
          : []
      );
      const ids = await createRunTx(db, recordingBoss().boss).insertChildren(
        parent,
        '7',
        'v1',
        Array.from({ length: 1_001 }, () => ({}))
      );
      assert.deepEqual([ids.length, ids[0], ids[999], ids[1_000]], [1_001, 'c0', 'c999', 'c1000']);
      const inserts = queries.filter((q) => q.sql.startsWith('insert into "workflow_runs"'));
      assert.deepEqual(
        inserts.map((q) => [q.parameters.length / 7, q.parameters[4]]),
        [
          [1_000, 0],
          [1, 1_000]
        ]
      );
      await db.destroy();
    });
  });

  describe('child waits', () => {
    it('locks the parent and reads the wait it is suspended on', async () => {
      const { db, queries } = createRecordingDb(() => [
        { status: 'suspended', wait_id: '7', kind: 'workflows' }
      ]);
      assert.deepEqual(await createRunTx(db, recordingBoss().boss).lockParent('p'), {
        status: 'suspended',
        waitId: '7',
        kind: 'workflows'
      });
      assert.equal(
        queries[0]?.sql,
        'select "status", state -> \'suspension\' ->> \'id\' as "wait_id", state -> \'suspension\' ->> \'kind\' as "kind" from "workflow_runs" where "id" = $1 for update'
      );
      assert.deepEqual(queries[0]?.parameters, ['p']);
      await db.destroy();
    });

    it('finds no parent once it is gone', async () => {
      const { db } = createRecordingDb(() => []);
      assert.equal(await createRunTx(db, recordingBoss().boss).lockParent('p'), undefined);
      await db.destroy();
    });

    it('tells whether any child of the wait is still active', async () => {
      const pending = createRecordingDb(() => [{ id: 'c1' }]);
      assert.equal(
        await createRunTx(pending.db, recordingBoss().boss).hasPendingChildren('p', '7'),
        true
      );
      assert.equal(
        pending.queries[0]?.sql,
        'select "id" from "workflow_runs" where "parent_id" = $1 and "parent_wait" = $2 and "status" in ($3, $4, $5) limit $6'
      );
      assert.deepEqual(pending.queries[0]?.parameters, [
        'p',
        '7',
        'running',
        'suspended',
        'faulted',
        1
      ]);
      const done = createRecordingDb(() => []);
      assert.equal(
        await createRunTx(done.db, recordingBoss().boss).hasPendingChildren('p', '7'),
        false
      );
      await pending.db.destroy();
      await done.db.destroy();
    });

    it('reads the children of a wait in index order, blanking missing results and errors', async () => {
      const { db, queries } = createRecordingDb(() => [
        { id: 'c0', status: 'completed', result: { pin: null, outputs: {} }, error: undefined },
        { id: 'c1', status: 'failed', result: undefined, error: { message: 'boom' } }
      ]);
      assert.deepEqual(await createRunTx(db, recordingBoss().boss).children('p', '7'), [
        { id: 'c0', status: 'completed', result: { pin: null, outputs: {} }, error: null },
        { id: 'c1', status: 'failed', result: null, error: { message: 'boom' } }
      ]);
      assert.equal(
        queries[0]?.sql,
        'select "id", "status", "result", "error" from "workflow_runs" where "parent_id" = $1 and "parent_wait" = $2 order by "parent_index"'
      );
      assert.deepEqual(queries[0]?.parameters, ['p', '7']);
      await db.destroy();
    });

    it('lists the active children of a run across all its waits', async () => {
      const { db, queries } = createRecordingDb(() => [{ id: 'c1' }, { id: 'c2' }]);
      assert.deepEqual(await createRunTx(db, recordingBoss().boss).activeChildren('p'), [
        'c1',
        'c2'
      ]);
      assert.equal(
        queries[0]?.sql,
        'select "id" from "workflow_runs" where "parent_id" = $1 and "status" in ($2, $3, $4)'
      );
      assert.deepEqual(queries[0]?.parameters, ['p', 'running', 'suspended', 'faulted']);
      await db.destroy();
    });
  });

  describe('lockSignal', () => {
    it('locks the agency signal and counts what arrived without consuming it', async () => {
      const { db, queries } = createRecordingDb(() => [{ received: 3 }]);
      assert.equal(await createRunTx(db, recordingBoss().boss).lockSignal('t', 'claim:c1'), 3);
      assert.equal(
        queries[0]?.sql,
        'insert into "signals" ("agency_id", "key") values ($1, $2) on conflict ("agency_id", "key") do update set "received" = signals.received returning "received"'
      );
      assert.deepEqual(queries[0]?.parameters, ['t', 'claim:c1']);
      await db.destroy();
    });
  });
});
