import { advance, enqueueRuns, type RunQueueClient, resume, start } from '@ugula/run-queue';
import { type Kysely, sql } from 'kysely';
import { sqlExecutor } from './client.ts';
import { buildLatestVersion, findPublishedGraphs, pinRunGraphs } from './graph-versions.ts';
import type { Database } from './schema.ts';

type NewRun = {
  agencyId: string;
  versionId: string;
  inputs: unknown;
  interactive?: boolean;
  startedBy?: string;
};

const buildInsertRun = (db: Kysely<Database>, run: NewRun) =>
  db
    .insertInto('workflow_runs')
    .values({
      agency_id: run.agencyId,
      graph_version_id: run.versionId,
      status: 'running',
      inputs: JSON.stringify(run.inputs),
      started_by: run.startedBy ?? null
    })
    .returning('id');

export const startRun = async (tx: Kysely<Database>, boss: RunQueueClient, run: NewRun) => {
  const { id } = await buildInsertRun(tx, run).executeTakeFirstOrThrow();
  await pinRunGraphs(tx, { id, agencyId: run.agencyId, versionId: run.versionId });
  await enqueueRuns(boss, sqlExecutor(tx), [run.interactive ? start(id) : advance(id)]);
  return id;
};

const findRunWait = (db: Kysely<Database>, agencyId: string, waitKey: string) =>
  db
    .selectFrom('workflow_runs')
    .select(['id', sql<string>`state -> 'suspension' ->> 'id'`.as('wait_id')])
    .where('agency_id', '=', agencyId)
    .where('wait_key', '=', waitKey)
    .where('status', '=', 'suspended')
    .execute();

const countSignal = (db: Kysely<Database>, agencyId: string, waitKey: string) =>
  db
    .insertInto('signals')
    .values({ agency_id: agencyId, key: waitKey, received: 1 })
    .onConflict((oc) =>
      oc.columns(['agency_id', 'key']).doUpdateSet({
        received: sql`signals.received + 1`,
        updated_at: sql`now()`
      })
    );

export const signalRuns = async (
  tx: Kysely<Database>,
  boss: RunQueueClient,
  signal: { agencyId: string; name: string; key: string; payload: unknown }
) => {
  const waitKey = `${signal.name}:${signal.key}`;
  await countSignal(tx, signal.agencyId, waitKey).execute();
  const waiting = await findRunWait(tx, signal.agencyId, waitKey);
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    waiting.map((r) => resume(r.id, r.wait_id, { payload: signal.payload }))
  );
  return waiting.length;
};

export const resolveWorkflowVersion = async (
  db: Kysely<Database>,
  agencyId: string,
  key: string
): Promise<{ id: string; version: number } | undefined> => {
  const latest = (await buildLatestVersion(agencyId, key).execute(db)).rows[0];
  if (!latest) return undefined;
  const [found] = await findPublishedGraphs(db, agencyId, [{ key, version: latest.version }]);
  return found && { id: found.id, version: found.version };
};
