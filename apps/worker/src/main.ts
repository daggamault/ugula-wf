import { createNodeCatalog } from '@ugula/catalog';
import {
  createDb,
  dispatchEvents,
  EVENTS_CHANNEL,
  findDefinitions,
  findTableDefinitions
} from '@ugula/db';
import { createEmbedder } from '@ugula/inference';
import { publishLiveEvent } from '@ugula/live';
import { createBlobStore, createS3Storage } from '@ugula/storage';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
import { type Config, parseConfig } from './config.ts';
import { createFeeStore } from './features/charges/queries.ts';
import { announceClaims } from './features/claims/announce.ts';
import { createClaimStore } from './features/claims/queries.ts';
import { createDiagnosisStore } from './features/diagnoses/queries.ts';
import { announceEncounters } from './features/encounters/announce.ts';
import { createEncounterStore } from './features/encounters/queries.ts';
import { startEventDispatcher } from './features/events/job.ts';
import { registerHealthJob } from './features/health/job.ts';
import { announceImports } from './features/imports/announce.ts';
import { createReportStore } from './features/imports/reports.ts';
import { createPatientStore } from './features/patients/queries.ts';
import { createPayerStore } from './features/payers/queries.ts';
import { registerScheduleJob, startDueSchedules } from './features/schedules/job.ts';
import { createEngineCache } from './features/workflows/engines.ts';
import { registerWorkflowJobs } from './features/workflows/job.ts';
import { createRunStore } from './features/workflows/run-store.ts';
import { createRunner } from './features/workflows/runner.ts';
import { createListen } from './shared/listen.ts';
import { coalescePublish, createAnnouncer, type Publish } from './shared/live.ts';
import {
  createLoadGate,
  createProcessSampler,
  defaultHeapBytes,
  megabytes
} from './shared/load.ts';
import { createPublicFetch } from './shared/public-fetch.ts';
import { createRunScope } from './shared/run-scope.ts';
import { createAgencyOf } from './shared/tenancy.ts';

const connection = (config: Config) => ({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME
});

export const createWorker = (config: Config) =>
  new PgBoss({ ...connection(config), useListenNotify: true });

const SHUTDOWN_TIMEOUT_MS = 30_000;

const CONNECTIONS_PER_SLOT = 3;

const SPARE_CONNECTIONS = 4;

const LISTEN_RETRY_MS = 5_000;

export const poolSize = (concurrency: number) =>
  concurrency * CONNECTIONS_PER_SLOT + SPARE_CONNECTIONS;

type Running = {
  jobs: { stop: () => void };
  events: { stop: () => Promise<void> };
  live: { flush: () => Promise<void> };
  boss: Pick<PgBoss, 'stop'>;
  db: { destroy: () => Promise<void> };
  redis: { quit: () => Promise<unknown> };
};

export const stopWorker = async (
  { jobs, events, live, boss, db, redis }: Running,
  timeoutMs: number
) => {
  jobs.stop();
  await events.stop();
  await boss.stop({ graceful: true, timeout: timeoutMs });
  await live.flush();
  await Promise.all([db.destroy(), redis.quit()]);
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const db = createDb({ ...connection(config), max: poolSize(config.WORKER_RUN_CONCURRENCY) });
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
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY
    })
  );
  await blobs.ensureBucket();
  const store = createRunStore({ db, boss });
  const live = coalescePublish((agencyId, event) => publishLiveEvent(redis, agencyId, event));
  const publish: Publish = live.publish;
  const scope = createRunScope();
  const publicFetch = scope.fetch(createPublicFetch(fetch));
  const report = (message: string) => process.stderr.write(`${message}\n`);
  const now = () => new Date();
  const agencyOf = createAgencyOf(db, scope.agencyOf);
  const announce = createAnnouncer(agencyOf, publish);
  const runner = createRunner({
    store,
    engines: createEngineCache({
      nodes: createNodeCatalog({
        fetch: publicFetch,
        nemsis: {
          reports: announceImports(createReportStore(db, blobs, agencyOf), announce),
          encounters: announceEncounters(createEncounterStore(db), announce)
        },
        billing: {
          patients: createPatientStore(db),
          payers: createPayerStore(db),
          fees: createFeeStore(db),
          claims: announceClaims(createClaimStore(db, boss), announce),
          diagnoses: createDiagnosisStore(db, createEmbedder({ url: config.EMBEDDINGS_URL, fetch }))
        }
      }),
      loadDefinitions: (ids) => findDefinitions(db, ids),
      loadTables: (ids) => findTableDefinitions(db, ids)
    }),
    now,
    publish,
    within: scope.within
  });
  await registerHealthJob(boss);
  const jobs = await registerWorkflowJobs({
    boss,
    runner,
    store,
    concurrency: config.WORKER_RUN_CONCURRENCY,
    gate: createLoadGate(createProcessSampler(), {
      eventLoop: config.WORKER_MAX_EVENT_LOOP_UTILIZATION,
      heapBytes: config.WORKER_MAX_HEAP_MB
        ? megabytes(config.WORKER_MAX_HEAP_MB)
        : defaultHeapBytes(),
      rssBytes: config.WORKER_MAX_RSS_MB ? megabytes(config.WORKER_MAX_RSS_MB) : null
    }),
    report
  });
  await registerScheduleJob({ boss, start: startDueSchedules({ db, boss, report }) });
  const events = startEventDispatcher({
    dispatch: (limit) => dispatchEvents(db, boss, limit),
    listen: createListen({
      client: () => new Client(connection(config)),
      channel: EVENTS_CHANNEL,
      report,
      retryMs: LISTEN_RETRY_MS
    }),
    report
  });
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    stopWorker({ jobs, events, live, boss, db, redis }, SHUTDOWN_TIMEOUT_MS).then(
      () => process.exit(0),
      (err: unknown) => {
        report(`Stopping after ${signal} failed: ${String(err)}`);
        process.exit(1);
      }
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
