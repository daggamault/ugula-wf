import {
  ACTIVE_RUN_STATUSES,
  type Database,
  findPublishedGraphs,
  pinRunGraphs,
  pinRunsGraphs,
  type RunStatus,
  sqlExecutor,
  TERMINAL_RUN_STATUSES
} from '@ugula/db';
import type { Json, RunState, TraceEntry, Values } from '@ugula/graph';
import {
  dropTimeout,
  enqueueRuns,
  type RunJob,
  type RunQueueClient,
  type TimeoutClient
} from '@ugula/run-queue';
import { type Kysely, sql } from 'kysely';
import { assertLeased, type ClaimedRun, type LeasedRun } from './run-lease.ts';
import { cancelTasks, insertTask, type TaskInsert } from './run-tasks.ts';

export type RunPatch = {
  status: RunStatus;
  state: RunState | null;
  result?: Json;
  error?: Json;
  waitKey?: string;
};

export type ParentWait = {
  status: RunStatus;
  waitId: string | null;
  kind: string | null;
};

export type ChildRun = {
  id: string;
  status: RunStatus;
  result: Json;
  error: Json;
};

export type RunTx = {
  saveRun: (run: LeasedRun, patch: RunPatch) => Promise<void>;
  insertSteps: (runId: string, steps: TraceEntry[]) => Promise<void>;
  insertTask: (task: TaskInsert) => Promise<void>;
  cancelTasks: (runId: string) => Promise<void>;
  findVersion: (run: ClaimedRun, key: string, version: number) => Promise<string | undefined>;
  insertRun: (parent: ClaimedRun, versionId: string, inputs: Values) => Promise<string>;
  insertChildren: (
    parent: ClaimedRun,
    waitId: string,
    versionId: string,
    inputs: Values[]
  ) => Promise<string[]>;
  lockParent: (parentId: string) => Promise<ParentWait | undefined>;
  hasPendingChildren: (parentId: string, waitId: string) => Promise<boolean>;
  children: (parentId: string, waitId: string) => Promise<ChildRun[]>;
  activeChildren: (runId: string) => Promise<string[]>;
  lockSignal: (agencyId: string, key: string) => Promise<number>;
  enqueue: (jobs: RunJob[]) => Promise<void>;
  dropTimeout: (runId: string, waitId: string) => Promise<void>;
};

export type QueueClient = RunQueueClient & TimeoutClient;

const STEP_CHUNK = 5_000;

const STEP_COLUMNS = [
  'run_id',
  'seq',
  'scope',
  'path',
  'node',
  'node_type',
  'node_version',
  'event',
  'inputs',
  'outputs',
  'pin',
  'error',
  'started_at',
  'duration_ms'
] as const;

const stepRow = (s: TraceEntry) => ({
  seq: s.seq,
  scope: s.scope,
  path: s.path,
  node: s.node,
  node_type: s.type,
  node_version: s.version,
  event: s.event,
  inputs: s.inputs,
  outputs: s.outputs,
  pin: s.pin,
  error: s.error ?? null,
  started_at: s.startedAt,
  duration_ms: s.durationMs
});

const CHILD_CHUNK = 1_000;

const json = (value: Json | undefined) => (value === undefined ? null : JSON.stringify(value));

export const createRunTx = (tx: Kysely<Database>, boss: QueueClient): RunTx => ({
  saveRun: async (run, patch) => {
    const saved = await tx
      .updateTable('workflow_runs')
      .set({
        status: patch.status,
        state: patch.state === null ? null : JSON.stringify(patch.state),
        result: json(patch.result),
        error: json(patch.error),
        wait_key: patch.waitKey ?? null,
        lease_expires_at: null,
        lease_token: null,
        updated_at: sql`now()`,
        completed_at: TERMINAL_RUN_STATUSES.includes(patch.status) ? sql`now()` : null
      })
      .where('id', '=', run.id)
      .where('lease_token', '=', run.lease)
      .executeTakeFirst();
    assertLeased(run.id, saved);
  },
  insertSteps: async (runId, steps) => {
    for (let i = 0; i < steps.length; i += STEP_CHUNK) {
      await tx
        .insertInto('workflow_run_steps')
        .columns(STEP_COLUMNS)
        .expression(
          sql<never>`select ${runId}::uuid, ${sql.join(STEP_COLUMNS.slice(1).map((c) => sql.ref(`s.${c}`)))}
            from jsonb_to_recordset(${JSON.stringify(steps.slice(i, i + STEP_CHUNK).map(stepRow))}::jsonb)
              as s(seq int, scope text, path text, node text, node_type text, node_version int, event text,
                inputs jsonb, outputs jsonb, pin text, error jsonb, started_at timestamptz, duration_ms float8)`
        )
        .execute();
    }
  },
  insertTask: (t) => insertTask(tx, t),
  cancelTasks: (runId) => cancelTasks(tx, runId),
  findVersion: async (run, key, version) =>
    (await findPublishedGraphs(tx, run.agencyId, [{ key, version }], run.id))[0]?.id,
  insertRun: async (parent, versionId, inputs) => {
    const { agencyId } = parent;
    const { id } = await tx
      .insertInto('workflow_runs')
      .values({
        agency_id: agencyId,
        graph_version_id: versionId,
        status: 'running',
        inputs: JSON.stringify(inputs)
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pinRunGraphs(tx, { id, agencyId, versionId, parentRunId: parent.id });
    return id;
  },
  insertChildren: async (parent, waitId, versionId, inputs) => {
    const ids: string[] = [];
    for (let i = 0; i < inputs.length; i += CHILD_CHUNK) {
      const rows = await tx
        .insertInto('workflow_runs')
        .values(
          inputs.slice(i, i + CHILD_CHUNK).map((values, j) => ({
            agency_id: parent.agencyId,
            graph_version_id: versionId,
            parent_id: parent.id,
            parent_wait: waitId,
            parent_index: i + j,
            status: 'running' as const,
            inputs: JSON.stringify(values)
          }))
        )
        .returning(['id', 'parent_index'])
        .execute();
      ids.push(
        ...rows.sort((a, b) => (a.parent_index ?? 0) - (b.parent_index ?? 0)).map((r) => r.id)
      );
    }
    await pinRunsGraphs(tx, { ids, agencyId: parent.agencyId, versionId, parentRunId: parent.id });
    return ids;
  },
  lockParent: async (parentId) => {
    const row = await tx
      .selectFrom('workflow_runs')
      .select([
        'status',
        sql<string | null>`state -> 'suspension' ->> 'id'`.as('wait_id'),
        sql<string | null>`state -> 'suspension' ->> 'kind'`.as('kind')
      ])
      .where('id', '=', parentId)
      .forUpdate()
      .executeTakeFirst();
    return row && { status: row.status, waitId: row.wait_id, kind: row.kind };
  },
  hasPendingChildren: async (parentId, waitId) =>
    (await tx
      .selectFrom('workflow_runs')
      .select('id')
      .where('parent_id', '=', parentId)
      .where('parent_wait', '=', waitId)
      .where('status', 'in', ACTIVE_RUN_STATUSES)
      .limit(1)
      .executeTakeFirst()) !== undefined,
  children: async (parentId, waitId) =>
    (
      await tx
        .selectFrom('workflow_runs')
        .select(['id', 'status', 'result', 'error'])
        .where('parent_id', '=', parentId)
        .where('parent_wait', '=', waitId)
        .orderBy('parent_index')
        .execute()
    ).map((r) => ({
      id: r.id,
      status: r.status,
      result: (r.result ?? null) as Json,
      error: (r.error ?? null) as Json
    })),
  activeChildren: async (runId) =>
    (
      await tx
        .selectFrom('workflow_runs')
        .select('id')
        .where('parent_id', '=', runId)
        .where('status', 'in', ACTIVE_RUN_STATUSES)
        .execute()
    ).map((r) => r.id),
  lockSignal: async (agencyId, key) =>
    (
      await tx
        .insertInto('signals')
        .values({ agency_id: agencyId, key })
        .onConflict((oc) =>
          oc.columns(['agency_id', 'key']).doUpdateSet({ received: sql`signals.received` })
        )
        .returning('received')
        .executeTakeFirstOrThrow()
    ).received,
  enqueue: (jobs) => enqueueRuns(boss, sqlExecutor(tx), jobs),
  dropTimeout: (runId, waitId) => dropTimeout(boss, sqlExecutor(tx), runId, waitId)
});
