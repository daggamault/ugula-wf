import { createNodeCatalog } from '@ugula/catalog';
import { createDb, findDefinitions, listRunGraphRefs } from '@ugula/db';
import { createCompleter, createCompletionLimiter, createEmbedder } from '@ugula/inference';
import { publishLiveEvent } from '@ugula/live';
import { createBlobStore, createS3Storage } from '@ugula/storage';
import { Redis } from 'ioredis';
import { PgBoss } from 'pg-boss';
import { type Config, parseConfig } from './config.ts';
import { createFeeStore } from './features/charges/queries.ts';
import { announceClaims } from './features/claims/announce.ts';
import { createClaimStore } from './features/claims/queries.ts';
import { registerHealthJob } from './features/health/job.ts';
import { announceImports } from './features/imports/announce.ts';
import { createReportStore } from './features/imports/reports.ts';
import { createPatientStore } from './features/patients/queries.ts';
import { createPayerStore } from './features/payers/queries.ts';
import { createEngineCache } from './features/workflows/engines.ts';
import { registerWorkflowJobs } from './features/workflows/job.ts';
import { createRunStore } from './features/workflows/queries.ts';
import { createRunner } from './features/workflows/runner.ts';
import { createAnnouncer, type Publish } from './shared/live.ts';
import {
  createLoadGate,
  createProcessSampler,
  defaultHeapBytes,
  megabytes
} from './shared/load.ts';

const connection = (config: Config) => ({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME
});

export const createWorker = (config: Config) =>
  new PgBoss({ ...connection(config), useListenNotify: true });

if (import.meta.main) {
  const config = parseConfig(process.env);
  const db = createDb({ ...connection(config), max: config.WORKFLOW_CONCURRENCY + 2 });
  const boss = createWorker(config);
  await boss.start();
  const redis = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD
  });
  const blobs = createBlobStore(
    createS3Storage({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY
    })
  );
  await blobs.ensureBucket();
  const store = createRunStore({ db, boss });
  const publish: Publish = (tenantId, event) => publishLiveEvent(redis, tenantId, event);
  const announce = createAnnouncer(db, publish);
  const runner = createRunner({
    store,
    engines: createEngineCache({
      nodes: createNodeCatalog({
        fetch,
        reports: announceImports(createReportStore(db, blobs), announce),
        billing: {
          patients: createPatientStore(db),
          payers: createPayerStore(db, createEmbedder({ url: config.EMBEDDINGS_URL, fetch })),
          fees: createFeeStore(db),
          claims: announceClaims(createClaimStore(db, blobs), announce),
          completer: createCompleter({
            url: config.COMPLETIONS_URL,
            model: config.COMPLETIONS_MODEL,
            limit: createCompletionLimiter(redis, config.COMPLETIONS_CONCURRENCY),
            fetch
          })
        }
      }),
      loadRefs: (runId) => listRunGraphRefs(db, runId),
      loadDefinitions: (ids) => findDefinitions(db, ids)
    }),
    now: () => new Date(),
    publish
  });
  await registerHealthJob(boss);
  await registerWorkflowJobs({
    boss,
    runner,
    store,
    concurrency: config.WORKFLOW_CONCURRENCY,
    gate: createLoadGate(createProcessSampler(), {
      eventLoop: config.WORKER_MAX_EVENT_LOOP_UTILIZATION,
      heapBytes: config.WORKER_MAX_HEAP_MB
        ? megabytes(config.WORKER_MAX_HEAP_MB)
        : defaultHeapBytes(),
      rssBytes: config.WORKER_MAX_RSS_MB ? megabytes(config.WORKER_MAX_RSS_MB) : null
    }),
    report: (message) => process.stderr.write(`${message}\n`)
  });
}
