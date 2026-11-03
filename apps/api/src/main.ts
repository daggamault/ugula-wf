import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createSessionStore, type RedisLike } from '@ugula/auth';
import { createNodeCatalog } from '@ugula/catalog';
import { createDb, type Db } from '@ugula/db';
import type { NodeDef } from '@ugula/graph';
import { createEmbedder, type Embedder } from '@ugula/inference';
import { publishLiveEvent } from '@ugula/live';
import type { RunQueueClient } from '@ugula/run-queue';
import { type BlobStore, createBlobStore, createS3Storage } from '@ugula/storage';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { Redis } from 'ioredis';
import { PgBoss } from 'pg-boss';
import { type Config, parseConfig } from './config.ts';
import { createAuthRoutes } from './features/auth/routes.ts';
import { createAuthService } from './features/auth/service.ts';
import { createBillingProfileRoutes } from './features/billing-profile/routes.ts';
import { createBillingProfileService } from './features/billing-profile/service.ts';
import { createClaimRoutes } from './features/claims/routes.ts';
import { createClaimService } from './features/claims/service.ts';
import { createFeeRoutes } from './features/fees/routes.ts';
import { createFeeService } from './features/fees/service.ts';
import { createGraphRoutes } from './features/graphs/routes.ts';
import { createGraphService } from './features/graphs/service.ts';
import { createHealthRoutes } from './features/health/routes.ts';
import { createImportRoutes, createSftpRoutes } from './features/imports/routes.ts';
import { createImportService } from './features/imports/service.ts';
import { createNotificationRoutes } from './features/notifications/routes.ts';
import { createNotificationService } from './features/notifications/service.ts';
import { createPatientRoutes } from './features/patients/routes.ts';
import { createPatientService } from './features/patients/service.ts';
import { createPayerFileRoutes } from './features/payer-files/routes.ts';
import { createPayerFileService } from './features/payer-files/service.ts';
import { createPayerRoutes } from './features/payers/routes.ts';
import { createPayerService } from './features/payers/service.ts';
import { createReportRoutes } from './features/reports/routes.ts';
import { createReportService } from './features/reports/service.ts';
import { createRunRoutes } from './features/runs/routes.ts';
import { createRunService } from './features/runs/service.ts';
import { createSubmissionRoutes } from './features/submissions/routes.ts';
import { createSubmissionService } from './features/submissions/service.ts';
import { createTaskRoutes } from './features/tasks/routes.ts';
import { createTaskService } from './features/tasks/service.ts';
import { type AuthEnv, requireAuth } from './shared/auth.ts';
import type { Announce } from './shared/live.ts';
import { createSignInThrottle, type ThrottleStore } from './shared/throttle.ts';

type AppDeps = {
  config: Config;
  db: Db;
  redis: RedisLike & ThrottleStore;
  boss: RunQueueClient;
  blobs: BlobStore;
  embedder: Embedder;
  nodes: NodeDef[];
  announce: Announce;
  clientIp: (c: Context) => string;
};

const sftpStorage = (config: Config) => ({
  bucket: config.S3_BUCKET,
  region: config.S3_REGION,
  endpoint: config.SFTP_S3_ENDPOINT,
  homeRoot: config.SFTP_HOME_ROOT
});

const isMultipart = (c: Context) =>
  c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data') ?? false;

export const createApp = ({
  config,
  db,
  redis,
  boss,
  blobs,
  embedder,
  nodes,
  announce,
  clientIp
}: AppDeps) => {
  const app = new Hono();
  const origins = config.HTTP_CORS_ORIGINS.split(',').map((o) => o.trim());
  const sessions = createSessionStore(redis);
  const auth = createAuthService({ db, sessions, throttle: createSignInThrottle(redis) });
  const authenticate = async (token: string | undefined) => {
    const res = await auth.session(token);
    return res.ok ? res.value : null;
  };
  const protect = (routes: Hono<AuthEnv>) =>
    new Hono<AuthEnv>().use(requireAuth(authenticate)).route('/', routes);
  const limitBody = bodyLimit({
    maxSize: config.HTTP_MAX_BODY_BYTES,
    onError: (c) => c.json({ error: 'Request body too large' }, 413)
  });

  app.use(
    '*',
    cors({
      origin: origins,
      credentials: true
    })
  );
  app.use('*', csrf({ origin: origins }));
  app.use('*', async (c, next) => (isMultipart(c) ? next() : limitBody(c, next)));

  app.route('/health', createHealthRoutes());
  app.route(
    '/api/auth',
    createAuthRoutes({
      service: auth,
      sseUrl: config.SSE_URL,
      secureCookie: config.NODE_ENV === 'production',
      clientIp
    })
  );
  app.route('/api/graphs', protect(createGraphRoutes(createGraphService({ db, nodes }))));
  app.route(
    '/api/runs',
    protect(
      createRunRoutes(
        createRunService({ db, boss, blobs, maxBytes: config.IMPORT_FILE_MAX_BYTES }),
        config.IMPORT_FILE_MAX_BYTES
      )
    )
  );
  app.route('/api/tasks', protect(createTaskRoutes(createTaskService({ db, boss, announce }))));
  app.route('/api/fees', protect(createFeeRoutes(createFeeService({ db }))));
  app.route(
    '/api/payers',
    protect(createPayerRoutes(createPayerService({ db, announce, embedder })))
  );
  app.route('/api/patients', protect(createPatientRoutes(createPatientService({ db }))));
  app.route(
    '/api/notifications',
    protect(createNotificationRoutes(createNotificationService({ db, announce })))
  );
  app.route(
    '/api/billing-profile',
    protect(createBillingProfileRoutes(createBillingProfileService({ db })))
  );
  app.route(
    '/api/claims',
    protect(
      createClaimRoutes(createClaimService({ db, boss, blobs, announce, now: () => new Date() }))
    )
  );
  app.route(
    '/api/submissions',
    protect(createSubmissionRoutes(createSubmissionService({ db, blobs, now: () => new Date() })))
  );
  app.route(
    '/api/reports',
    protect(createReportRoutes(createReportService({ db, now: () => new Date() })))
  );
  const imports = createImportService({
    db,
    boss,
    blobs,
    announce,
    maxBytes: config.IMPORT_FILE_MAX_BYTES,
    sftp: sftpStorage(config)
  });
  app.route('/api/imports/sftp', createSftpRoutes(imports, config.SFTP_HOOK_SECRET));
  app.route('/api/imports', protect(createImportRoutes(imports, config.IMPORT_FILE_MAX_BYTES)));
  app.route(
    '/api/payer-files',
    protect(
      createPayerFileRoutes(
        createPayerFileService({
          db,
          boss,
          blobs,
          announce,
          now: () => new Date(),
          maxBytes: config.IMPORT_FILE_MAX_BYTES
        }),
        config.IMPORT_FILE_MAX_BYTES
      )
    )
  );

  return app;
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const connection = {
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME
  };
  const db = createDb({ ...connection, max: config.API_DB_POOL_MAX });
  const redis = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD
  });
  const boss = new PgBoss({ ...connection, supervise: false, schedule: false });
  await boss.start();
  const blobs = createBlobStore(
    createS3Storage({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY
    })
  );

  serve({
    fetch: createApp({
      config,
      db,
      redis,
      boss,
      blobs,
      embedder: createEmbedder({ url: config.EMBEDDINGS_URL, fetch }),
      nodes: createNodeCatalog({ fetch }),
      announce: (tenantId, event) => publishLiveEvent(redis, tenantId, event),
      clientIp: (c) => getConnInfo(c).remote.address ?? 'unknown'
    }).fetch,
    port: config.API_PORT
  });
}
