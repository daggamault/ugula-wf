import type { IncomingMessage, ServerResponse } from 'node:http';
import { readCookie, SESSION_COOKIE, type SessionStore } from '@ugula/auth';
import { corsHeaders, sendJson } from '../../shared/http.ts';
import type { Hub } from '../../shared/hub.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventsHandlerDeps = {
  sessions: Pick<SessionStore, 'get'>;
  isActiveMember: (userId: string, agencyId: string) => Promise<boolean>;
  hub: Hub;
  origins: readonly string[];
  heartbeatMs?: number;
};

export const createEventsHandler = ({
  sessions,
  isActiveMember,
  hub,
  origins,
  heartbeatMs = 30_000
}: EventsHandlerDeps) => {
  const signedIn = async (token: string, agencyId: string) => {
    const session = await sessions.get(token);
    return session && (await isActiveMember(session.userId, agencyId)) ? session : null;
  };

  const agencyOf = (req: IncomingMessage) => {
    const id = new URL(req.url ?? '/', 'http://local').searchParams.get('agency') ?? '';
    return UUID.test(id) ? id : null;
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    const cors = corsHeaders(req.headers.origin, origins);
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const agencyId = agencyOf(req);
    const session =
      token && agencyId ? await signedIn(token, agencyId).catch(() => undefined) : null;
    if (res.destroyed) return;
    if (session === undefined) {
      sendJson(res, 503, { error: 'Sessions unavailable' }, cors);
      return;
    }
    if (!token || !agencyId || !session) {
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
    const remove = hub.add(agencyId, res);
    const heartbeat = setInterval(async () => {
      res.write(': ping\n\n');
      if ((await signedIn(token, agencyId).catch(() => undefined)) === null) res.end();
    }, heartbeatMs);
    req.on('close', () => {
      clearInterval(heartbeat);
      remove();
    });
  };
};
