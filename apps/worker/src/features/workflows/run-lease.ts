import { ACTIVE_RUN_STATUSES, type Database, type GraphRef, type RunTableRef } from '@ugula/db';
import type { RunState, Values } from '@ugula/graph';
import type { RunJob } from '@ugula/run-queue';
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
  tables: RunTableRef[];
};

export type LeasedRun = Pick<ClaimedRun, 'id' | 'lease'>;

const LEASE_LOST = 'LEASE_LOST';

const leaseLost = (runId: string) =>
  Object.assign(new Error(`Run ${runId} is no longer leased by this worker`), {
    code: LEASE_LOST
  });

export const isLeaseLost = (err: unknown) =>
  err instanceof Error && 'code' in err && err.code === LEASE_LOST;

export const assertLeased = (runId: string, result: { numUpdatedRows: bigint }) => {
  if (result.numUpdatedRows === 0n) throw leaseLost(runId);
};

export const leaseUntil = (ms: number) => sql<Date>`now() + ${ms} * interval '1 millisecond'`;

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
      .as('graphs'),
    eb
      .selectFrom('workflow_run_tables as t')
      .select(
        sql<
          RunTableRef[]
        >`coalesce(json_agg(json_build_object('id', t.table_version_id, 'key', t.key) order by t.key), '[]')`.as(
          'tables'
        )
      )
      .whereRef('t.run_id', '=', 'workflow_runs.id')
      .as('tables')
  ]);
};
