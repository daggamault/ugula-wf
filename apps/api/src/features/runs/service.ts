import { type Db, findGraphBundle, sqlExecutor, TERMINAL_RUN_STATUSES } from '@ugula/db';
import { cancel, enqueueRuns, type JobBoss } from '@ugula/jobs';
import { fail, ok } from '../../shared/result.ts';
import { signalRuns, startRun } from '../../shared/runs.ts';
import {
  countChildren,
  findPublishedVersion,
  findRun,
  listChildren,
  listRuns,
  listRunTasks,
  listSteps,
  type RunFilters,
  type StepFilters
} from './queries.ts';

export type RunServiceDeps = {
  db: Db;
  boss: JobBoss;
};

const notFound = fail('not_found', 'Run not found');

export const createRunService = ({ db, boss }: RunServiceDeps) => ({
  list: async (tenantId: string, filters: RunFilters) =>
    ok({ runs: await listRuns(db, tenantId, filters) }),

  find: async (tenantId: string, id: string) => {
    const run = await findRun(db, tenantId, id);
    if (!run) return notFound;
    const [children, childCount, tasks] = await Promise.all([
      listChildren(db, id),
      countChildren(db, id),
      listRunTasks(db, id)
    ]);
    return ok({ run, children, childCount, tasks });
  },

  graphs: async (tenantId: string, id: string) => {
    const run = await findRun(db, tenantId, id);
    return run ? ok({ graphs: await findGraphBundle(db, run.version_id) }) : notFound;
  },

  steps: async (tenantId: string, id: string, filters: StepFilters) =>
    (await findRun(db, tenantId, id)) ? ok({ steps: await listSteps(db, id, filters) }) : notFound,

  start: (tenantId: string, graphId: string, version: number | undefined, inputs: unknown) =>
    db.transaction().execute(async (tx) => {
      const found = await findPublishedVersion(tx, tenantId, graphId, version);
      if (!found) return fail('not_found', 'No published version to run');
      const id = await startRun(tx, boss, { tenantId, versionId: found.id, inputs });
      return ok({ id, version: found.version });
    }),

  cancel: (tenantId: string, id: string) =>
    db.transaction().execute(async (tx) => {
      const run = await findRun(tx, tenantId, id);
      if (!run) return notFound;
      if (TERMINAL_RUN_STATUSES.includes(run.status)) {
        return fail('conflict', 'Run already finished');
      }
      await enqueueRuns(boss, sqlExecutor(tx), [cancel(id)]);
      return ok({ status: 'cancelling' });
    }),

  signal: (tenantId: string, name: string, key: string, payload: unknown) =>
    db.transaction().execute(async (tx) => {
      return ok({ resumed: await signalRuns(tx, boss, { tenantId, name, key, payload }) });
    })
});

export type RunService = ReturnType<typeof createRunService>;
