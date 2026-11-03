import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createHub } from '../../shared/hub.ts';
import { createEventsHandler } from './handler.ts';

describe('events handler', () => {
  it('streams tenant events to signed-in members and rejects others', async () => {
    const hub = createHub();
    const valid = new Set(['good', 'expiring', 'deactivated']);
    const members = new Set(['good', 'expiring', 'deactivated']);
    const handler = createEventsHandler({
      hub,
      heartbeatMs: 50,
      origins: ['http://localhost:3000'],
      sessions: {
        get: async (token) =>
          token === 'down'
            ? Promise.reject(new Error('redis down'))
            : valid.has(token)
              ? { userId: token, tenantId: 't-1', email: 'dev@example.com' }
              : null
      },
      isActiveMember: async ({ userId }) => members.has(userId)
    });
    const server = createServer((req, res) => void handler(req, res)).listen(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const decoder = new TextDecoder();
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
      assert.equal(decoder.decode((await reader?.read())?.value), ': connected\n\n');
      hub.broadcast('t-1', '{"kind":"run"}');
      assert.equal(decoder.decode((await reader?.read())?.value), 'data: {"kind":"run"}\n\n');
      ctrl.abort();

      for (const [token, revoke] of [
        ['expiring', () => valid.delete('expiring')],
        ['deactivated', () => members.delete('deactivated')]
      ] as const) {
        const stream = (
          await fetch(url, { headers: { cookie: `ugula_session=${token}` } })
        ).body?.getReader();
        assert.equal(decoder.decode((await stream?.read())?.value), ': connected\n\n');
        revoke();
        assert.equal(decoder.decode((await stream?.read())?.value), ': ping\n\n');
        assert.equal((await stream?.read())?.done, true);
      }

      const inactive = await fetch(url, { headers: { cookie: 'ugula_session=deactivated' } });
      assert.equal(inactive.status, 401);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('streams only the events of the session tenant', async () => {
    const hub = createHub();
    const handler = createEventsHandler({
      hub,
      origins: ['http://localhost:3000'],
      sessions: {
        get: async (token) => ({ userId: `u-${token}`, tenantId: token, email: 'dev@example.com' })
      },
      isActiveMember: async () => true
    });
    const server = createServer((req, res) => void handler(req, res)).listen(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const decoder = new TextDecoder();
    try {
      const anonymous = await fetch(url, { headers: { origin: 'http://localhost:3000' } });
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.headers.get('access-control-allow-origin'), 'http://localhost:3000');
      const reader = (
        await fetch(url, { headers: { cookie: 'ugula_session=t-1' } })
      ).body?.getReader();
      assert.equal(decoder.decode((await reader?.read())?.value), ': connected\n\n');
      hub.broadcast('t-2', '{"kind":"claim","id":"other"}');
      hub.broadcast('t-1', '{"kind":"claim","id":"mine"}');
      assert.equal(
        decoder.decode((await reader?.read())?.value),
        'data: {"kind":"claim","id":"mine"}\n\n'
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
