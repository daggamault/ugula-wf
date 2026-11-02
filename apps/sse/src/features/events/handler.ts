import type { IncomingMessage, ServerResponse } from 'node:http';
import { readCookie, SESSION_COOKIE, type SessionStore } from '@ugula/auth';
import { corsHeaders, sendJson } from '../../shared/http.ts';
import type { Hub } from '../../shared/hub.ts';

export type EventsHandlerDeps = {
  sessions: Pick<SessionStore, 'get'>;
  hub: Hub;
  origins: readonly string[];
  heartbeatMs?: number;
};

export const createEventsHandler =
  ({ sessions, hub, origins, heartbeatMs = 30_000 }: EventsHandlerDeps) =>
  async (req: IncomingMessage, res: ServerResponse) => {
    const cors = corsHeaders(req.headers.origin, origins);
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = token ? await sessions.get(token).catch(() => undefined) : null;
    if (res.destroyed) return;
    if (session === undefined) {
      sendJson(res, 503, { error: 'Sessions unavailable' }, cors);
      return;
    }
    if (!token || !session) {
      sendJson(res, 401, { error: 'Unauthorized' }, cors);
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...cors
    });
    res.write(': connected\n\n');
    const remove = hub.add(session.tenantId, res);
    const heartbeat = setInterval(async () => {
      res.write(': ping\n\n');
      const current = await sessions.get(token).catch(() => undefined);
      if (current === null) res.end();
    }, heartbeatMs);
    req.on('close', () => {
      clearInterval(heartbeat);
      remove();
    });
  };
