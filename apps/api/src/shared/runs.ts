import { type Database, sqlExecutor } from '@ugula/db';
import { advance, enqueueRuns, type JobBoss, resume } from '@ugula/jobs';
import { type Kysely, sql } from 'kysely';

export type NewRun = {
  tenantId: string;
  versionId: string;
  inputs: unknown;
};

export const buildInsertRun = (db: Kysely<Database>, run: NewRun) =>
  db
    .insertInto('workflow_runs')
    .values({
      tenant_id: run.tenantId,
      graph_version_id: run.versionId,
      status: 'running',
      inputs: JSON.stringify(run.inputs)
    })
    .returning('id');

export const startRun = async (tx: Kysely<Database>, boss: JobBoss, run: NewRun) => {
  const { id } = await buildInsertRun(tx, run).executeTakeFirstOrThrow();
  await enqueueRuns(boss, sqlExecutor(tx), [advance(id)]);
  return id;
};

export const findRunWait = (db: Kysely<Database>, tenantId: string, waitKey: string) =>
  db
    .selectFrom('workflow_runs')
    .select(['id', sql<string>`state -> 'suspension' ->> 'id'`.as('wait_id')])
    .where('tenant_id', '=', tenantId)
    .where('wait_key', '=', waitKey)
    .where('status', '=', 'suspended')
    .execute();

export const signalRuns = async (
  tx: Kysely<Database>,
  boss: JobBoss,
  signal: { tenantId: string; name: string; key: string; payload: unknown }
) => {
  const waiting = await findRunWait(tx, signal.tenantId, `${signal.name}:${signal.key}`);
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    waiting.map((r) => resume(r.id, r.wait_id, { payload: signal.payload }))
  );
  return waiting.length;
};
