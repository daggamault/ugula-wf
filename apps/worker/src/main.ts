import { createNodeCatalog } from '@ugula/catalog';
import { parseKeyring } from '@ugula/clearinghouse';
import { createDb, findDefinitions, findTableDefinitions } from '@ugula/db';
import { createCompleter, createCompletionLimiter, createEmbedder } from '@ugula/inference';
import { publishLiveEvent } from '@ugula/live';
import { createBlobStore, createS3Storage } from '@ugula/storage';
import { Redis } from 'ioredis';
import { PgBoss } from 'pg-boss';
import { type Config, clearinghouseOf, parseConfig } from './config.ts';
import { createFeeStore } from './features/charges/queries.ts';
import { announceClaims } from './features/claims/announce.ts';
import { createClaimStore } from './features/claims/queries.ts';
import { createExchangeStore } from './features/clearinghouse/exchange.ts';
import { registerPollJob } from './features/clearinghouse/job.ts';
import { createPayerFileStore } from './features/clearinghouse/payer-files.ts';
import { createClearinghousePoll } from './features/clearinghouse/poll.ts';
import { registerHealthJob } from './features/health/job.ts';
import { announceImports } from './features/imports/announce.ts';
import { createReportStore } from './features/imports/reports.ts';
import { createPatientStore } from './features/patients/queries.ts';
import { createPayerStore } from './features/payers/queries.ts';
import { createRecoveryStore } from './features/recovery/queries.ts';
import { registerScheduleJobs, startDueAgencies } from './features/schedules/job.ts';
import { createCalendarStore, createScheduleStore } from './features/schedules/queries.ts';
import { createEngineCache } from './features/workflows/engines.ts';
import { registerWorkflowJobs } from './features/workflows/job.ts';
import { createRunStore } from './features/workflows/run-store.ts';
import { createRunner } from './features/workflows/runner.ts';
import { createConnections } from './shared/clearinghouse.ts';
import { coalescePublish, createAnnouncer, type Publish } from './shared/live.ts';
import {
  createLoadGate,
  createProcessSampler,
  defaultHeapBytes,
  megabytes
} from './shared/load.ts';
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

export const poolSize = (concurrency: number) =>
  concurrency * CONNECTIONS_PER_SLOT + SPARE_CONNECTIONS;

type Running = {
  jobs: { stop: () => void };
  live: { flush: () => Promise<void> };
  boss: Pick<PgBoss, 'stop'>;
  db: { destroy: () => Promise<void> };
  redis: { quit: () => Promise<unknown> };
};

export const stopWorker = async ({ jobs, live, boss, db, redis }: Running, timeoutMs: number) => {
  jobs.stop();
  await boss.stop({ graceful: true, timeout: timeoutMs });
  await live.flush();
  await Promise.all([db.destroy(), redis.quit()]);
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const db = createDb({ ...connection(config), max: poolSize(config.WORKFLOW_CONCURRENCY) });
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
  const live = coalescePublish((agencyId, event) => publishLiveEvent(redis, agencyId, event));
  const publish: Publish = live.publish;
  const scope = createRunScope();
  const agencyOf = createAgencyOf(db, scope.agencyOf);
  const announce = createAnnouncer(agencyOf, publish);
  const guardedFetch = scope.fetch(fetch);
  const report = (message: string) => process.stderr.write(`${message}\n`);
  const connections = createConnections({
    db,
    keyring: config.CLEARINGHOUSE_SECRET_KEY
      ? parseKeyring(config.CLEARINGHOUSE_SECRET_KEY, config.CLEARINGHOUSE_PREVIOUS_SECRET_KEYS)
      : null,
    fallback: clearinghouseOf(config),
    fetch: guardedFetch,
    realtimeTimeoutMs: config.CLEARINGHOUSE_REALTIME_TIMEOUT_SECONDS * 1000,
    report
  });
  const payerFiles = createPayerFileStore(db, blobs, boss, announce);
  const runner = createRunner({
    store,
    engines: createEngineCache({
      nodes: createNodeCatalog({
        fetch: guardedFetch,
        reports: scope.guard(announceImports(createReportStore(db, blobs, agencyOf), announce)),
        billing: {
          patients: scope.guard(createPatientStore(db)),
          payers: scope.guard(
            createPayerStore(
              db,
              createEmbedder({ url: config.EMBEDDINGS_URL, fetch: guardedFetch })
            )
          ),
          fees: scope.guard(createFeeStore(db)),
          claims: scope.guard(
            announceClaims(createClaimStore(db, blobs, boss, connections.forAgency), announce)
          ),
          payerFiles: scope.guard(payerFiles),
          exchange: scope.guard(
            createExchangeStore({
              db,
              blobs,
              applyDocument: payerFiles.applyDocument,
              clearinghouseFor: connections.forAgency
            })
          ),
          recovery: scope.guard(createRecoveryStore(db, blobs, boss)),
          schedules: scope.guard(createScheduleStore(db, blobs)),
          calendar: scope.guard(createCalendarStore(db)),
          completer: createCompleter({
            url: config.COMPLETIONS_URL,
            model: config.COMPLETIONS_MODEL,
            limit: createCompletionLimiter(redis, config.COMPLETIONS_CONCURRENCY),
            fetch: guardedFetch
          })
        }
      }),
      loadDefinitions: (ids) => findDefinitions(db, ids),
      loadTables: (ids) => findTableDefinitions(db, ids)
    }),
    now: () => new Date(),
    publish,
    within: scope.within
  });
  await registerHealthJob(boss);
  const jobs = await registerWorkflowJobs({
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
    report
  });
  await registerPollJob({
    boss,
    poll: createClearinghousePoll({ db, boss, blobs, targets: connections.pollTargets, report }),
    pollMinutes: config.CLEARINGHOUSE_POLL_MINUTES,
    report
  });
  await registerScheduleJobs({
    boss,
    start: startDueAgencies({ db, boss, report })
  });
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    stopWorker({ jobs, live, boss, db, redis }, SHUTDOWN_TIMEOUT_MS).then(
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
