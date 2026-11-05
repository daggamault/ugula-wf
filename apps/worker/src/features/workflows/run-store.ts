import { ACTIVE_RUN_STATUSES, type Db, type RunStatus } from '@ugula/db';
import type { RunState, TraceEntry, Values } from '@ugula/graph';
import { advance, type RunJob } from '@ugula/run-queue';
import { sql } from 'kysely';
import {
  assertLeased,
  buildClaim,
  type ClaimedRun,
  type LeasedRun,
  leaseUntil
} from './run-lease.ts';
import { type ChildRun, createRunTx, type QueueClient, type RunTx } from './run-tx.ts';

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

const STRANDED_AFTER = sql<Date>`now() - interval '10 minutes'`;

const PRUNE_BEFORE = sql<Date>`now() - interval '30 days'`;

const PRUNE_BATCH = 10_000;

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
        graphs: row.graphs ?? [],
        tables: row.tables ?? []
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
