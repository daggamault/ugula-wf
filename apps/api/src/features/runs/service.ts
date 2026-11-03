import { type Db, findRunGraphs, sqlExecutor, TERMINAL_RUN_STATUSES } from '@ugula/db';
import { cancel, enqueueRuns, type RunQueueClient } from '@ugula/run-queue';
import type { BlobStore } from '@ugula/storage';
import { type UploadedFile, uploadKey } from '../../shared/files.ts';
import { fail, ok } from '../../shared/result.ts';
import { startRun } from '../../shared/runs.ts';
import {
  countChildren,
  findPublishedVersion,
  findRun,
  listAncestors,
  listChildren,
  listRuns,
  listRunTasks,
  listSteps,
  type RunFilters,
  type StepFilters
} from './queries.ts';

type RunServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  blobs: Pick<BlobStore, 'putBytes'>;
  maxBytes: number;
};

const notFound = fail('not_found', 'Run not found');

export const createRunService = ({ db, boss, blobs, maxBytes }: RunServiceDeps) => ({
  uploadFile: async (tenantId: string, file: UploadedFile) => {
    if (!file.bytes.byteLength) return fail('invalid', 'The file is empty');
    if (file.bytes.byteLength > maxBytes) {
      return fail('invalid', `The file is larger than ${maxBytes} bytes`);
    }
    const ref = await blobs.putBytes(
      uploadKey(tenantId, file.name, 'uploads/'),
      file.bytes,
      file.type || 'application/octet-stream'
    );
    return ok({ file: { bucket: ref.bucket, key: ref.key }, name: file.name });
  },

  list: async (tenantId: string, filters: RunFilters) => ok(await listRuns(db, tenantId, filters)),

  find: async (tenantId: string, id: string) => {
    const run = await findRun(db, tenantId, id);
    if (!run) return notFound;
    const [children, childCount, tasks, ancestors] = await Promise.all([
      listChildren(db, id),
      countChildren(db, id),
      listRunTasks(db, id),
      listAncestors(db, id)
    ]);
    return ok({ run, children, childCount, tasks, ancestors });
  },

  graphs: async (tenantId: string, id: string) => {
    const run = await findRun(db, tenantId, id);
    return run ? ok({ graphs: await findRunGraphs(db, id) }) : notFound;
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
    })
});

export type RunService = ReturnType<typeof createRunService>;
