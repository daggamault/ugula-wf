import { serve } from '@hono/node-server';
import { createDb, type Db } from '@ugula/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Redis } from 'ioredis';
import { type Config, parseConfig } from './config.ts';
import { findActiveUserByEmail } from './features/auth/queries.ts';
import { createAuthRoutes } from './features/auth/routes.ts';
import { createHealthRoutes } from './features/health/routes.ts';
import { createSessionStore, type RedisLike } from './shared/session.ts';

export type AppDeps = {
  config: Config;
  db: Db;
  redis: RedisLike;
};

export const createApp = ({ config, db, redis }: AppDeps) => {
  const app = new Hono();
  const origins = config.HTTP_CORS_ORIGINS.split(',').map((o) => o.trim());

  app.use(
    '*',
    cors({
      origin: origins,
      credentials: true
    })
  );

  app.route('/health', createHealthRoutes());
  app.route(
    '/api/auth',
    createAuthRoutes({
      findUserByEmail: (email) => findActiveUserByEmail(db, email),
      sessions: createSessionStore(redis),
      sseUrl: config.SSE_URL,
      secureCookie: config.NODE_ENV === 'production'
    })
  );

  return app;
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const db = createDb({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    max: config.API_DB_POOL_MAX
  });
  const redis = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD
  });

  serve({
    fetch: createApp({ config, db, redis }).fetch,
    port: config.API_PORT
  });
}
