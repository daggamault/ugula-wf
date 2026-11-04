import { advance, enqueueRuns, type RunQueueClient, resume } from '@ugula/run-queue';
import { type Kysely, sql } from 'kysely';
import { sqlExecutor } from './client.ts';
import { pinRunGraphs } from './graph-versions.ts';
import type { Database } from './schema.ts';

type NewRun = {
  agencyId: string;
  versionId: string;
  inputs: unknown;
};

const buildInsertRun = (db: Kysely<Database>, run: NewRun) =>
  db
    .insertInto('workflow_runs')
    .values({
      agency_id: run.agencyId,
      graph_version_id: run.versionId,
      status: 'running',
      inputs: JSON.stringify(run.inputs)
    })
    .returning('id');

export const startRun = async (tx: Kysely<Database>, boss: RunQueueClient, run: NewRun) => {
  const { id } = await buildInsertRun(tx, run).executeTakeFirstOrThrow();
  await pinRunGraphs(tx, { id, agencyId: run.agencyId, versionId: run.versionId });
  await enqueueRuns(boss, sqlExecutor(tx), [advance(id)]);
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

export const resolveWorkflowVersion = (db: Kysely<Database>, agencyId: string, key: string) =>
  db
    .selectFrom('graph_versions as gv')
    .innerJoin('graphs as g', 'g.id', 'gv.graph_id')
    .select(['gv.id', 'gv.version'])
    .where('g.key', '=', key)
    .where('g.kind', '=', 'workflow')
    .where('g.is_active', '=', true)
    .where('gv.published_at', 'is not', null)
    .where((eb) => eb.or([eb('g.agency_id', '=', agencyId), eb('g.agency_id', 'is', null)]))
    .orderBy(sql`g.agency_id nulls last`)
    .orderBy('gv.version', 'desc')
    .limit(1)
    .executeTakeFirst();
