import { createBillingNodes } from '@ugula/billing';
import { createBlobStore, createS3Storage } from '@ugula/blobs';
import { createDb, findGraphBundle } from '@ugula/db';
import { publishEvent } from '@ugula/events';
import { createStdNodes } from '@ugula/graph';
import { createNemsisNodes } from '@ugula/nemsis';
import { Redis } from 'ioredis';
import { PgBoss } from 'pg-boss';
import { type Config, parseConfig } from './config.ts';
import { createFeeStore } from './features/charges/queries.ts';
import { createClaimStore } from './features/claims/queries.ts';
import { registerHealthJob } from './features/health/job.ts';
import { createReportStore } from './features/imports/reports.ts';
import { createPatientStore } from './features/patients/queries.ts';
import { createEngineCache } from './features/workflows/engines.ts';
import { registerWorkflowJobs } from './features/workflows/job.ts';
import { createRunStore } from './features/workflows/queries.ts';
import { createRunner } from './features/workflows/runner.ts';

const connection = (config: Config) => ({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME
});

export const createWorker = (config: Config) => new PgBoss(connection(config));

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
    config.S3_BUCKET,
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
  const runner = createRunner({
    store,
    engines: createEngineCache({
      nodes: [
        ...createStdNodes({ fetch }),
        ...createNemsisNodes(createReportStore(db, blobs)),
        ...createBillingNodes({
          patients: createPatientStore(db),
          fees: createFeeStore(db),
          claims: createClaimStore(db, blobs)
        })
      ],
      loadBundle: (versionId) => findGraphBundle(db, versionId)
    }),
    now: () => new Date(),
    publish: (tenantId, event) => publishEvent(redis, tenantId, event)
  });
  await registerHealthJob(boss);
  await registerWorkflowJobs({ boss, runner, store, concurrency: config.WORKFLOW_CONCURRENCY });
}
