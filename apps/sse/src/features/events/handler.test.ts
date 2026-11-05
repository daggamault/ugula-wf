import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createHub } from '../../shared/hub.ts';
import { createEventsHandler } from './handler.ts';

const A1 = '00000000-0000-4000-8000-000000000001';
const A2 = '00000000-0000-4000-8000-000000000002';

const serve = async (handler: ReturnType<typeof createEventsHandler>) => {
  const server = createServer((req, res) => void handler(req, res)).listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return { server, at: (agency: string) => `${base}?agency=${agency}` };
};

describe('events handler', () => {
  it('streams agency events to signed-in members and rejects others', async () => {
    const hub = createHub();
    const valid = new Set(['good', 'expiring', 'deactivated']);
    const members = new Set([`good:${A1}`, `expiring:${A1}`, `deactivated:${A1}`]);
    const checked: string[] = [];
    const handler = createEventsHandler({
      hub,
      heartbeatMs: 50,
      origins: ['http://localhost:3000'],
      sessions: {
        get: async (token) =>
          token === 'down'
            ? Promise.reject(new Error('redis down'))
            : valid.has(token)
              ? { userId: token, email: 'dev@example.com' }
              : null
      },
      canOpenAgency: async (userId, agencyId) => {
        checked.push(`${userId}:${agencyId}`);
        return members.has(`${userId}:${agencyId}`);
      }
    });
    const { server, at } = await serve(handler);
    const url = at(A1);
    const decoder = new TextDecoder();
    try {
      const denied = await fetch(url, { headers: { cookie: 'ugula_session=bad' } });
      assert.equal(denied.status, 401);
      const garbled = await fetch(url, { headers: { cookie: 'ugula_session=%E0%A4%A' } });
      assert.equal(garbled.status, 401);
      const down = await fetch(url, { headers: { cookie: 'ugula_session=down' } });
      assert.equal(down.status, 503);
      const elsewhere = await fetch(at(A2), { headers: { cookie: 'ugula_session=good' } });
      assert.equal(elsewhere.status, 401);
      assert.ok(checked.includes(`good:${A2}`));

      const ctrl = new AbortController();
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { cookie: 'ugula_session=good', origin: 'http://localhost:3000' }
      });
      assert.equal(res.headers.get('content-type'), 'text/event-stream');
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
      const reader = res.body?.getReader();
      assert.equal(decoder.decode((await reader?.read())?.value), ': connected\n\n');
      hub.broadcast(A1, '{"kind":"run"}');
      assert.equal(decoder.decode((await reader?.read())?.value), 'data: {"kind":"run"}\n\n');
      ctrl.abort();

      for (const [token, revoke] of [
        ['expiring', () => valid.delete('expiring')],
        ['deactivated', () => members.delete(`deactivated:${A1}`)]
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

  it('requires a valid agency id before looking up the session', async () => {
    const looked: string[] = [];
    const handler = createEventsHandler({
      hub: createHub(),
      origins: [],
      sessions: {
        get: async (token) => {
          looked.push(token);
          return { userId: 'u-1', email: 'dev@example.com' };
        }
      },
      canOpenAgency: async () => true
    });
    const { server, at } = await serve(handler);
    try {
      for (const agency of ['', 'not-a-uuid', `${A1}x`]) {
        const res = await fetch(at(agency), { headers: { cookie: 'ugula_session=good' } });
        assert.equal(res.status, 401);
      }
      assert.deepEqual(looked, []);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('streams only the events of the requested agency', async () => {
    const hub = createHub();
    const handler = createEventsHandler({
      hub,
      origins: ['http://localhost:3000'],
      sessions: { get: async (token) => ({ userId: `u-${token}`, email: 'dev@example.com' }) },
      canOpenAgency: async () => true
    });
    const { server, at } = await serve(handler);
    const decoder = new TextDecoder();
    try {
      const anonymous = await fetch(at(A1), { headers: { origin: 'http://localhost:3000' } });
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.headers.get('access-control-allow-origin'), 'http://localhost:3000');
      const reader = (
        await fetch(at(A1), { headers: { cookie: 'ugula_session=t' } })
      ).body?.getReader();
      assert.equal(decoder.decode((await reader?.read())?.value), ': connected\n\n');
      hub.broadcast(A2, '{"kind":"claim","id":"other"}');
      hub.broadcast(A1, '{"kind":"claim","id":"mine"}');
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
