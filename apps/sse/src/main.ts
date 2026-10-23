import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { EVENTS_PATTERN, parseEvent, tenantOf } from '@ugula/events';
import { createSessionStore } from '@ugula/sessions';
import { Redis } from 'ioredis';
import { parseConfig } from './config.ts';
import { createEventsHandler } from './features/events/handler.ts';
import { handleHealth } from './features/health/handler.ts';
import { sendJson } from './shared/http.ts';
import { createHub, type Hub } from './shared/hub.ts';

const HEARTBEAT_MS = 25_000;

export type SseRoutes = {
  events: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

export const handleRequest =
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
  if (tenantId && parseEvent(message)) hub.broadcast(tenantId, message);
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const redis = {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD
  };
  const hub = createHub();
  const subscriber = new Redis(redis);
  await subscriber.psubscribe(EVENTS_PATTERN);
  subscriber.on('pmessage', relay(hub));
  setInterval(hub.beat, HEARTBEAT_MS);
  createSseServer({
    events: createEventsHandler({
      hub,
      sessions: createSessionStore(new Redis(redis)),
      origins: config.HTTP_CORS_ORIGINS.split(',').map((o) => o.trim())
    })
  }).listen(config.SSE_PORT);
}
