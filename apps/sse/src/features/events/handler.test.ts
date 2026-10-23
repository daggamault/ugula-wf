import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createHub } from '../../shared/hub.ts';
import { createEventsHandler } from './handler.ts';

describe('events handler', () => {
  it('streams tenant events to signed-in clients and rejects others', async () => {
    const hub = createHub();
    const valid = new Set(['good', 'expiring']);
    const handler = createEventsHandler({
      hub,
      heartbeatMs: 50,
      origins: ['http://localhost:3000'],
      sessions: {
        get: async (token) =>
          token === 'down'
            ? Promise.reject(new Error('redis down'))
            : valid.has(token)
              ? { userId: 'u', tenantId: 't-1', email: 'dev@example.com' }
              : null
      }
    });
    const server = createServer((req, res) => void handler(req, res)).listen(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const denied = await fetch(url, { headers: { cookie: 'ugula_session=bad' } });
      assert.equal(denied.status, 401);
      const garbled = await fetch(url, { headers: { cookie: 'ugula_session=%E0%A4%A' } });
      assert.equal(garbled.status, 401);
      const down = await fetch(url, { headers: { cookie: 'ugula_session=down' } });
      assert.equal(down.status, 503);

      const ctrl = new AbortController();
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { cookie: 'ugula_session=good', origin: 'http://localhost:3000' }
      });
      assert.equal(res.headers.get('content-type'), 'text/event-stream');
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      assert.equal(decoder.decode((await reader?.read())?.value), ': connected\n\n');
      hub.broadcast('t-1', '{"kind":"run"}');
      assert.equal(decoder.decode((await reader?.read())?.value), 'data: {"kind":"run"}\n\n');
      ctrl.abort();

      const signedOut = await fetch(url, { headers: { cookie: 'ugula_session=expiring' } });
      const stream = signedOut.body?.getReader();
      assert.equal(decoder.decode((await stream?.read())?.value), ': connected\n\n');
      valid.delete('expiring');
      assert.equal(decoder.decode((await stream?.read())?.value), ': ping\n\n');
      assert.equal((await stream?.read())?.done, true);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
