import {
  ACTIVE_RUN_STATUSES,
  type Database,
  type Db,
  findPublishedGraphs,
  type RunStatus,
  sqlExecutor,
  type TaskKind,
  TERMINAL_RUN_STATUSES
} from '@ugula/db';
import type { Json, RunState, TraceEntry, Values } from '@ugula/graph';
import { advance, enqueueRuns, type JobBoss, type RunJob } from '@ugula/jobs';
import { type Kysely, sql } from 'kysely';

export type ClaimedRun = {
  id: string;
  lease: string;
  tenantId: string;
  versionId: string;
  parentId: string | null;
  parentWait: string | null;
  inputs: Values;
  state: RunState | null;
};

export type RunPatch = {
  status: RunStatus;
  state: RunState | null;
  result?: Json;
  error?: Json;
  waitKey?: string;
};

export type TaskInsert = {
  tenantId: string;
  runId: string;
  waitId: string;
  kind: TaskKind;
  queue: string;
  title: string;
  instructions: string;
  context: Json;
  fields: Json;
  outcomes: string[];
  defaults: Json;
  priority: number;
  assigneeId: string | null;
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

export type LeasedRun = Pick<ClaimedRun, 'id' | 'lease'>;

export type RunTx = {
  saveRun: (run: LeasedRun, patch: RunPatch) => Promise<void>;
  insertSteps: (runId: string, steps: TraceEntry[]) => Promise<void>;
  insertTask: (task: TaskInsert) => Promise<void>;
  cancelTasks: (runId: string) => Promise<void>;
  findVersion: (tenantId: string, key: string, version: number) => Promise<string | undefined>;
  insertRun: (tenantId: string, versionId: string, inputs: Values) => Promise<string>;
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
  lockSignal: (tenantId: string, key: string) => Promise<number>;
  enqueue: (jobs: RunJob[]) => Promise<void>;
};

export type RunStore = {
  claim: (job: RunJob, leaseMs: number) => Promise<ClaimedRun | undefined>;
  checkpoint: (
    run: LeasedRun,
    state: RunState,
    steps: TraceEntry[],
    leaseMs: number
  ) => Promise<void>;
  release: (run: LeasedRun, status: RunStatus) => Promise<void>;
  transaction: <T>(fn: (tx: RunTx) => Promise<T>) => Promise<T>;
  sweep: () => Promise<number>;
};

const STEP_CHUNK = 500;

const CHILD_CHUNK = 1_000;

const LEASE_LOST = 'LEASE_LOST';

export const leaseLost = (runId: string) =>
  Object.assign(new Error(`Run ${runId} is no longer leased by this worker`), {
    code: LEASE_LOST
  });

export const isLeaseLost = (err: unknown) =>
  err instanceof Error && 'code' in err && err.code === LEASE_LOST;

const assertLeased = (runId: string, result: { numUpdatedRows: bigint }) => {
  if (result.numUpdatedRows === 0n) throw leaseLost(runId);
};

const json = (value: Json | undefined) => (value === undefined ? null : JSON.stringify(value));

const leaseUntil = (ms: number) => sql<Date>`now() + ${ms} * interval '1 millisecond'`;

export const buildClaim = (db: Kysely<Database>, { runId, command }: RunJob, leaseMs: number) => {
  const base = db
    .updateTable('workflow_runs')
    .set({
      status: 'running',
      lease_until: leaseUntil(leaseMs),
      lease_token: sql<string>`gen_random_uuid()`,
      updated_at: sql`now()`
    })
    .where('id', '=', runId);
  const idle = base.where((eb) =>
    eb.or([eb('lease_until', 'is', null), eb('lease_until', '<', sql<Date>`now()`)])
  );
  const scoped =
    command.type === 'advance'
      ? idle.where('status', '=', 'running')
      : command.type === 'resume'
        ? idle
            .where('status', '=', 'suspended')
            .where(sql<string>`state -> 'suspension' ->> 'id'`, '=', command.suspensionId)
        : command.type === 'cancel'
          ? base.where('status', 'in', ACTIVE_RUN_STATUSES)
          : idle.where('status', '=', 'faulted');
  return scoped.returning([
    'id',
    'lease_token',
    'tenant_id',
    'graph_version_id',
    'parent_id',
    'parent_wait',
    'inputs',
    'state'
  ]);
};

const createRunTx = (tx: Kysely<Database>, boss: JobBoss): RunTx => ({
  saveRun: async (run, patch) => {
    const saved = await tx
      .updateTable('workflow_runs')
      .set({
        status: patch.status,
        state: patch.state === null ? null : JSON.stringify(patch.state),
        result: json(patch.result),
        error: json(patch.error),
        wait_key: patch.waitKey ?? null,
        lease_until: null,
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
        .values(
          steps.slice(i, i + STEP_CHUNK).map((s) => ({
            run_id: runId,
            seq: s.seq,
            scope: s.scope,
            path: s.path,
            node: s.node,
            node_type: s.type,
            node_version: s.version,
            event: s.event,
            inputs: JSON.stringify(s.inputs),
            outputs: JSON.stringify(s.outputs),
            pin: s.pin,
            error: s.error ? JSON.stringify(s.error) : null,
            started_at: s.startedAt,
            duration_ms: s.durationMs
          }))
        )
        .execute();
    }
  },
  insertTask: async (t) => {
    await tx
      .insertInto('tasks')
      .values({
        tenant_id: t.tenantId,
        run_id: t.runId,
        wait_id: t.waitId,
        kind: t.kind,
        queue: t.queue,
        title: t.title,
        instructions: t.instructions,
        context: JSON.stringify(t.context),
        fields: JSON.stringify(t.fields),
        outcomes: t.outcomes,
        defaults: json(t.defaults),
        priority: t.priority,
        assignee_id:
          t.assigneeId === null
            ? null
            : tx
                .selectFrom('users')
                .select('id')
                .where(sql<string>`id::text`, '=', t.assigneeId)
                .where('tenant_id', '=', t.tenantId)
      })
      .onConflict((oc) => oc.columns(['run_id', 'wait_id']).doNothing())
      .execute();
  },
  cancelTasks: async (runId) => {
    await tx
      .updateTable('tasks')
      .set({ status: 'cancelled', updated_at: sql`now()` })
      .where('run_id', '=', runId)
      .where('status', '=', 'open')
      .execute();
  },
  findVersion: async (tenantId, key, version) =>
    (await findPublishedGraphs(tx, tenantId, [{ key, version }]))[0]?.id,
  insertRun: async (tenantId, versionId, inputs) =>
    (
      await tx
        .insertInto('workflow_runs')
        .values({
          tenant_id: tenantId,
          graph_version_id: versionId,
          status: 'running',
          inputs: JSON.stringify(inputs)
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id,
  insertChildren: async (parent, waitId, versionId, inputs) => {
    const ids: string[] = [];
    for (let i = 0; i < inputs.length; i += CHILD_CHUNK) {
      const rows = await tx
        .insertInto('workflow_runs')
        .values(
          inputs.slice(i, i + CHILD_CHUNK).map((values, j) => ({
            tenant_id: parent.tenantId,
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
  lockSignal: async (tenantId, key) =>
    (
      await tx
        .insertInto('signals')
        .values({ tenant_id: tenantId, key })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'key']).doUpdateSet({ received: sql`signals.received` })
        )
        .returning('received')
        .executeTakeFirstOrThrow()
    ).received,
  enqueue: (jobs) => enqueueRuns(boss, sqlExecutor(tx), jobs)
});

export const createRunStore = ({ db, boss }: { db: Db; boss: JobBoss }): RunStore => ({
  claim: async (job, leaseMs) => {
    const row = await buildClaim(db, job, leaseMs).executeTakeFirst();
    return (
      row && {
        id: row.id,
        lease: row.lease_token ?? '',
        tenantId: row.tenant_id,
        versionId: row.graph_version_id,
        parentId: row.parent_id,
        parentWait: row.parent_wait,
        inputs: row.inputs as Values,
        state: (row.state ?? null) as RunState | null
      }
    );
  },
  checkpoint: async (run, state, steps, leaseMs) => {
    await db.transaction().execute(async (tx) => {
      const saved = await tx
        .updateTable('workflow_runs')
        .set({
          state: JSON.stringify(state),
          lease_until: leaseUntil(leaseMs),
          updated_at: sql`now()`
        })
        .where('id', '=', run.id)
        .where('lease_token', '=', run.lease)
        .executeTakeFirst();
      assertLeased(run.id, saved);
      await createRunTx(tx, boss).insertSteps(run.id, steps);
    });
  },
  release: async (run, status) => {
    await db
      .updateTable('workflow_runs')
      .set({
        status,
        lease_until: status === 'running' ? sql<Date>`now()` : null,
        lease_token: null,
        updated_at: sql`now()`
      })
      .where('id', '=', run.id)
      .where('lease_token', '=', run.lease)
      .execute();
  },
  transaction: (fn) => db.transaction().execute((tx) => fn(createRunTx(tx, boss))),
  sweep: () =>
    db.transaction().execute(async (tx) => {
      const rows = await tx
        .updateTable('workflow_runs')
        .set({ lease_until: null, lease_token: null, updated_at: sql`now()` })
        .where('status', '=', 'running')
        .where('lease_until', '<', sql<Date>`now()`)
        .returning('id')
        .execute();
      await createRunTx(tx, boss).enqueue(rows.map((r) => advance(r.id)));
      return rows.length;
    })
});
