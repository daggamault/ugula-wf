import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createSessionStore } from '@ugula/auth';
import { createDb } from '@ugula/db';
import { LIVE_PATTERN, parseLiveEvent, tenantOf } from '@ugula/live';
import { Redis } from 'ioredis';
import { parseConfig } from './config.ts';
import { createEventsHandler } from './features/events/handler.ts';
import { isActiveMember } from './features/events/queries.ts';
import { handleHealth } from './features/health/handler.ts';
import { sendJson } from './shared/http.ts';
import { createHub, type Hub } from './shared/hub.ts';

const DB_POOL_MAX = 4;

type SseRoutes = {
  events: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

const handleRequest =
  ({ events }: SseRoutes) =>
  (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      handleHealth(res);
      return;
    }
    if (req.method === 'GET' && path === '/events') {
      events(req, res).catch(() => res.destroy());
      return;
    }
    sendJson(res, 404, { error: 'Not Found' });
  };

export const createSseServer = (routes: SseRoutes) => createServer(handleRequest(routes));

export const relay = (hub: Hub) => (_pattern: string, channel: string, message: string) => {
  const tenantId = tenantOf(channel);
  if (tenantId && parseLiveEvent(message)) hub.broadcast(tenantId, message);
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const redis = {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD
  };
  const db = createDb({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    max: DB_POOL_MAX
  });
  const hub = createHub();
  const subscriber = new Redis(redis);
  await subscriber.psubscribe(LIVE_PATTERN);
  subscriber.on('pmessage', relay(hub));
  createSseServer({
    events: createEventsHandler({
      hub,
      sessions: createSessionStore(new Redis(redis)),
      isActiveMember: (s) => isActiveMember(db, s.userId, s.tenantId),
      origins: config.HTTP_CORS_ORIGINS.split(',').map((o) => o.trim())
    })
  }).listen(config.SSE_PORT);
}
