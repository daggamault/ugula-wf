import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Permission } from '@ugula/access';
import { createSessionStore, type RedisLike } from '@ugula/auth';
import { createNodeCatalog } from '@ugula/catalog';
import { parseKeyring, sealSecret } from '@ugula/clearinghouse';
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
import { createAgencyAccessRoutes, createAgencyListRoutes } from './features/agencies/routes.ts';
import { createAgencyService } from './features/agencies/service.ts';
import { createAuthRoutes } from './features/auth/routes.ts';
import { createAuthService } from './features/auth/service.ts';
import { createBillingProfileRoutes } from './features/billing-profile/routes.ts';
import { createBillingProfileService } from './features/billing-profile/service.ts';
import { createClaimRoutes } from './features/claims/routes.ts';
import { createClaimService } from './features/claims/service.ts';
import { createConnectionRoutes } from './features/clearinghouse-connection/routes.ts';
import { createConnectionService } from './features/clearinghouse-connection/service.ts';
import { createFacilityRoutes } from './features/facilities/routes.ts';
import { createFacilityService } from './features/facilities/service.ts';
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
import { createRoleRoutes } from './features/roles/routes.ts';
import { createRoleService } from './features/roles/service.ts';
import { createRunRoutes } from './features/runs/routes.ts';
import { createRunService } from './features/runs/service.ts';
import { createSubmissionRoutes } from './features/submissions/routes.ts';
import { createSubmissionService } from './features/submissions/service.ts';
import { createTableRoutes } from './features/tables/routes.ts';
import { createTableService } from './features/tables/service.ts';
import { createTaskRoutes } from './features/tasks/routes.ts';
import { createTaskService } from './features/tasks/service.ts';
import { createInvitationRoutes, createUserRoutes } from './features/users/routes.ts';
import { createUserService } from './features/users/service.ts';
import { type AgencyEnv, guardMethods, requireAgencyAccess } from './shared/access.ts';
import { type AuthEnv, requireAuth } from './shared/auth.ts';
import type { Announce } from './shared/live.ts';
import { createRuleRunner } from './shared/rules.ts';
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
  sealSecret: ((secret: string, agencyId: string) => string) | null;
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
  clientIp,
  sealSecret
}: AppDeps) => {
  const app = new Hono();
  const origins = config.HTTP_CORS_ORIGINS.split(',').map((o) => o.trim());
  const sessions = createSessionStore(redis);
  const auth = createAuthService({ db, sessions, throttle: createSignInThrottle(redis) });
  const authenticate = async (token: string | undefined) => {
    const res = await auth.session(token);
    return res.ok ? res.value : null;
  };
  const protect = <E extends AuthEnv>(routes: Hono<E>) =>
    new Hono<E>().use(requireAuth(authenticate)).route('/', routes);
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
  const imports = createImportService({
    db,
    boss,
    blobs,
    announce,
    maxBytes: config.IMPORT_FILE_MAX_BYTES,
    sftp: sftpStorage(config)
  });
  const agencies = createAgencyService({ db });
  const users = createUserService({
    db,
    webUrl: config.WEB_URL,
    now: () => new Date(),
    endSessions: sessions.destroyAll
  });
  const read = <P extends Permission>(get: P) => ({ GET: get });
  const agency = new Hono<AgencyEnv>()
    .use(requireAgencyAccess(agencies.access))
    .route('/access', createAgencyAccessRoutes())
    .route('/roles', createRoleRoutes(createRoleService({ db })))
    .route('/users', createUserRoutes(users))
    .route('/invitations', createInvitationRoutes(users))
    .use(
      '/graphs/*',
      guardMethods({
        ...read('workflows:read'),
        POST: 'workflows:update',
        PUT: 'workflows:update',
        DELETE: 'workflows:update'
      })
    )
    .route('/graphs', createGraphRoutes(createGraphService({ db, nodes })))
    .use(
      '/tables/*',
      guardMethods({
        ...read('workflows:read'),
        POST: 'workflows:update',
        PUT: 'workflows:update',
        DELETE: 'workflows:update'
      })
    )
    .route('/tables', createTableRoutes(createTableService({ db })))
    .use('/runs/*', guardMethods({ ...read('runs:read'), POST: 'runs:create' }))
    .route(
      '/runs',
      createRunRoutes(
        createRunService({ db, boss, blobs, maxBytes: config.IMPORT_FILE_MAX_BYTES }),
        config.IMPORT_FILE_MAX_BYTES
      )
    )
    .use('/tasks/*', guardMethods({ ...read('tasks:read'), POST: 'tasks:update' }))
    .route('/tasks', createTaskRoutes(createTaskService({ db, boss, announce })))
    .use(
      '/fees/*',
      guardMethods({ ...read('fees:read'), PUT: 'fees:update', DELETE: 'fees:delete' })
    )
    .route('/fees', createFeeRoutes(createFeeService({ db })))
    .use(
      '/payers/*',
      guardMethods({ ...read('payers:read'), PUT: 'payers:update', DELETE: 'payers:delete' })
    )
    .route('/payers', createPayerRoutes(createPayerService({ db, announce, embedder })))
    .use(
      '/facilities/*',
      guardMethods({
        ...read('payers:read'),
        POST: 'payers:create',
        PUT: 'payers:update',
        DELETE: 'payers:delete'
      })
    )
    .route('/facilities', createFacilityRoutes(createFacilityService({ db })))
    .use('/patients/*', guardMethods(read('patients:read')))
    .route('/patients', createPatientRoutes(createPatientService({ db })))
    .use('/notifications/*', guardMethods({ GET: null, POST: null }))
    .route('/notifications', createNotificationRoutes(createNotificationService({ db, announce })))
    .use('/billing-profile/*', guardMethods({ ...read('settings:read'), PUT: 'settings:update' }))
    .route('/billing-profile', createBillingProfileRoutes(createBillingProfileService({ db })))
    .use(
      '/clearinghouse-connection/*',
      guardMethods({ ...read('settings:read'), PUT: 'settings:update', DELETE: 'settings:update' })
    )
    .route(
      '/clearinghouse-connection',
      createConnectionRoutes(
        createConnectionService({
          db,
          seal: sealSecret,
          allowLocal: config.NODE_ENV === 'development'
        })
      )
    )
    .use(
      '/claims/*',
      guardMethods({ ...read('claims:read'), PUT: 'claims:update', POST: 'claims:update' })
    )
    .route(
      '/claims',
      createClaimRoutes(
        createClaimService({
          db,
          boss,
          blobs,
          announce,
          now: () => new Date(),
          rules: createRuleRunner(db, nodes),
          maxBytes: config.IMPORT_FILE_MAX_BYTES
        }),
        config.IMPORT_FILE_MAX_BYTES
      )
    )
    .use('/submissions/*', guardMethods({ ...read('claims:read'), POST: 'claims:update' }))
    .route(
      '/submissions',
      createSubmissionRoutes(createSubmissionService({ db, boss, blobs, now: () => new Date() }))
    )
    .use('/reports/*', guardMethods(read('reports:read')))
    .route('/reports', createReportRoutes(createReportService({ db, now: () => new Date() })))
    .use('/imports/*', guardMethods({ ...read('imports:read'), POST: 'imports:create' }))
    .route('/imports', createImportRoutes(imports, config.IMPORT_FILE_MAX_BYTES))
    .use(
      '/payer-files/*',
      guardMethods({ ...read('payer_files:read'), POST: 'payer_files:create' })
    )
    .route(
      '/payer-files',
      createPayerFileRoutes(
        createPayerFileService({
          db,
          boss,
          blobs,
          maxBytes: config.IMPORT_FILE_MAX_BYTES
        }),
        config.IMPORT_FILE_MAX_BYTES
      )
    );
  app.route('/api/imports/sftp', createSftpRoutes(imports, config.SFTP_HOOK_SECRET));
  app.route('/api/agencies', protect(createAgencyListRoutes(agencies)));
  app.route('/api/agencies/:agencyId', protect(agency));

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
  const keyring = config.CLEARINGHOUSE_SECRET_KEY
    ? parseKeyring(config.CLEARINGHOUSE_SECRET_KEY, config.CLEARINGHOUSE_PREVIOUS_SECRET_KEYS)
    : null;
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
      announce: (agencyId, event) => publishLiveEvent(redis, agencyId, event),
      clientIp: (c) => getConnInfo(c).remote.address ?? 'unknown',
      sealSecret: keyring ? (secret, agencyId) => sealSecret(keyring, secret, agencyId) : null
    }).fetch,
    port: config.API_PORT
  });
}
