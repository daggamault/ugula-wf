import { advance, enqueueRuns, type RunQueueClient, start } from '@ugula/run-queue';
import type { Kysely } from 'kysely';
import { sqlExecutor } from './client.ts';
import { pinRunGraphs } from './graph-versions.ts';
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
      started_by_id: run.startedBy ?? null
    })
    .returning('id');

export const startRun = async (tx: Kysely<Database>, boss: RunQueueClient, run: NewRun) => {
  const { id } = await buildInsertRun(tx, run).executeTakeFirstOrThrow();
  await pinRunGraphs(tx, { id, agencyId: run.agencyId, versionId: run.versionId });
  await enqueueRuns(boss, sqlExecutor(tx), [run.interactive ? start(id) : advance(id)]);
  return id;
};
