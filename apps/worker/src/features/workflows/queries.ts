import {
  ACTIVE_RUN_STATUSES,
  type Database,
  type Db,
  findPublishedGraphs,
  type GraphRef,
  pinRunGraphs,
  pinRunsGraphs,
  type RunStatus,
  sqlExecutor,
  type TaskKind,
  TERMINAL_RUN_STATUSES
} from '@ugula/db';
import type { Json, RunState, TraceEntry, Values } from '@ugula/graph';
import {
  advance,
  dropTimeout,
  enqueueRuns,
  type RunJob,
  type RunQueueClient,
  type TimeoutClient
} from '@ugula/run-queue';
import { type Kysely, sql } from 'kysely';

export type ClaimedRun = {
  id: string;
  lease: string;
  agencyId: string;
  versionId: string;
  parentId: string | null;
  parentWait: string | null;
  inputs: Values;
  state: RunState | null;
  graphs: GraphRef[];
};

export type RunPatch = {
  status: RunStatus;
  state: RunState | null;
  result?: Json;
  error?: Json;
  waitKey?: string;
};

export type TaskInsert = {
  agencyId: string;
  runId: string;
  waitId: string;
  kind: TaskKind;
  queue: string;
  title: string;
  subject: string | null;
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

type LeasedRun = Pick<ClaimedRun, 'id' | 'lease'>;

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
  claimReference: (runId: string) => Promise<string | null>;
  recoverDrafts: (run: ClaimedRun, versionId: string, reason: string) => Promise<string[]>;
  enqueue: (jobs: RunJob[]) => Promise<void>;
  dropTimeout: (runId: string, waitId: string) => Promise<void>;
};

export type RunStore = {
  claim: (job: RunJob, leaseMs: number) => Promise<ClaimedRun | undefined>;
  checkpoint: (
    run: LeasedRun,
    state: RunState,
    steps: TraceEntry[],
    leaseMs: number
  ) => Promise<void>;
  extend: (run: LeasedRun, leaseMs: number) => Promise<void>;
  children: (parentId: string, waitId: string) => Promise<ChildRun[]>;
  release: (run: LeasedRun, status: RunStatus) => Promise<void>;
  transaction: <T>(fn: (tx: RunTx) => Promise<T>) => Promise<T>;
  sweep: () => Promise<number>;
  prune: () => Promise<number>;
};

type QueueClient = RunQueueClient & TimeoutClient;

export const taskNotification = (
  t: { agencyId: string; kind: 'task' | 'fault'; title: string; subject: string | null },
  id: string
) => ({
  agency_id: t.agencyId,
  intent: t.kind === 'fault' ? ('danger' as const) : ('info' as const),
  title: t.kind === 'fault' ? `Stuck run: ${t.title}` : `New task: ${t.title}`,
  description: t.subject,
  link_label: 'Open task',
  link_to: `/tasks/${id}`
});

const STEP_CHUNK = 500;

const CHILD_CHUNK = 1_000;

const STRANDED_AFTER = sql<Date>`now() - interval '10 minutes'`;

const PRUNE_BEFORE = sql<Date>`now() - interval '30 days'`;

const PRUNE_BATCH = 10_000;

const LEASE_LOST = 'LEASE_LOST';

const leaseLost = (runId: string) =>
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
  return scoped.returning((eb) => [
    'id',
    'lease_token',
    'agency_id',
    'graph_version_id',
    'parent_id',
    'parent_wait',
    'inputs',
    'state',
    eb
      .selectFrom('workflow_run_graphs as g')
      .select(
        sql<
          GraphRef[]
        >`coalesce(json_agg(json_build_object('id', g.graph_version_id, 'key', g.key, 'version', g.version) order by g.key, g.version), '[]')`.as(
          'graphs'
        )
      )
      .whereRef('g.run_id', '=', 'workflow_runs.id')
      .as('graphs')
  ]);
};

const createRunTx = (tx: Kysely<Database>, boss: QueueClient): RunTx => ({
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
    const task = await tx
      .insertInto('tasks')
      .values({
        agency_id: t.agencyId,
        run_id: t.runId,
        wait_id: t.waitId,
        kind: t.kind,
        queue: t.queue,
        title: t.title,
        subject: t.subject,
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
                .selectFrom('memberships')
                .select('user_id')
                .where(sql<string>`user_id::text`, '=', t.assigneeId)
                .where('agency_id', '=', t.agencyId)
      })
      .onConflict((oc) => oc.columns(['run_id', 'wait_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (task) await tx.insertInto('notifications').values(taskNotification(t, task.id)).execute();
  },
  cancelTasks: async (runId) => {
    await tx
      .updateTable('tasks')
      .set({ status: 'cancelled', updated_at: sql`now()` })
      .where('run_id', '=', runId)
      .where('status', '=', 'open')
      .execute();
  },
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
  claimReference: async (runId) =>
    (
      await tx
        .selectFrom('claim_runs as cr')
        .innerJoin('claims as c', 'c.id', 'cr.claim_id')
        .leftJoin('patients as p', 'p.id', 'c.patient_id')
        .select(
          sql<string>`concat_ws(' · ', c.pcr_number, nullif(concat_ws(' ', p.first_name, p.last_name), ''))`.as(
            'reference'
          )
        )
        .where('cr.run_id', '=', runId)
        .executeTakeFirst()
    )?.reference || null,
  recoverDrafts: async (run, versionId, reason) => {
    const { rows } = await sql<{ id: string }>`
      with orphans as (
        select c.id, r.report from claim_runs cr
        join claims c on c.id = cr.claim_id
        left join import_reports r on r.id = c.import_report_id
        where cr.run_id = ${run.id} and c.status = 'draft'
          and not exists (
            select 1 from claim_runs o
            join workflow_runs w on w.id = o.run_id
            where o.claim_id = c.id and o.run_id <> ${run.id}
              and w.status in (${sql.join(ACTIVE_RUN_STATUSES)})
          )
      ), started as (
        insert into workflow_runs (agency_id, graph_version_id, status, inputs)
        select ${run.agencyId}, ${versionId}, 'running',
          jsonb_build_object('claimId', o.id, 'report', o.report, 'reason', ${reason}::text)
        from orphans o
        returning id, (inputs ->> 'claimId')::uuid as claim_id
      ), linked as (
        insert into claim_runs (run_id, claim_id) select id, claim_id from started
      )
      select id from started`.execute(tx);
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await pinRunsGraphs(tx, { ids, agencyId: run.agencyId, versionId, parentRunId: run.id });
    }
    return ids;
  },
  enqueue: (jobs) => enqueueRuns(boss, sqlExecutor(tx), jobs),
  dropTimeout: (runId, waitId) => dropTimeout(boss, sqlExecutor(tx), runId, waitId)
});

export const createRunStore = ({ db, boss }: { db: Db; boss: QueueClient }): RunStore => ({
  claim: async (job, leaseMs) => {
    const row = await buildClaim(db, job, leaseMs).executeTakeFirst();
    return (
      row && {
        id: row.id,
        lease: row.lease_token ?? '',
        agencyId: row.agency_id,
        versionId: row.graph_version_id,
        parentId: row.parent_id,
        parentWait: row.parent_wait,
        inputs: row.inputs as Values,
        state: (row.state ?? null) as RunState | null,
        graphs: row.graphs ?? []
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
  extend: async (run, leaseMs) => {
    const extended = await db
      .updateTable('workflow_runs')
      .set({ lease_until: leaseUntil(leaseMs) })
      .where('id', '=', run.id)
      .where('lease_token', '=', run.lease)
      .executeTakeFirst();
    assertLeased(run.id, extended);
  },
  children: (parentId, waitId) => createRunTx(db, boss).children(parentId, waitId),
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
        .where((eb) =>
          eb.or([
            eb('lease_until', '<', sql<Date>`now()`),
            eb.and([eb('lease_until', 'is', null), eb('updated_at', '<', STRANDED_AFTER)])
          ])
        )
        .returning(['id', 'parent_id'])
        .execute();
      await createRunTx(tx, boss).enqueue(rows.map((r) => advance(r.id, r.parent_id)));
      return rows.length;
    }),
  prune: async () => {
    const { numDeletedRows } = await db
      .deleteFrom('workflow_run_steps as s')
      .where(
        sql<boolean>`(s.run_id, s.seq) in (${db
          .selectFrom('workflow_run_steps as o')
          .innerJoin('workflow_runs as r', 'r.id', 'o.run_id')
          .select(['o.run_id', 'o.seq'])
          .where('r.status', 'in', ACTIVE_RUN_STATUSES)
          .where('r.created_at', '<', PRUNE_BEFORE)
          .where('o.started_at', '<', PRUNE_BEFORE)
          .limit(PRUNE_BATCH)})`
      )
      .executeTakeFirst();
    return Number(numDeletedRows);
  }
});
