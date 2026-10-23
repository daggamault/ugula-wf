import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createSseServer, relay } from './main.ts';
import { createHub } from './shared/hub.ts';

describe('sse server', () => {
  it('routes /health and /events and 404s the rest', async () => {
    const hits: string[] = [];
    const server = createSseServer({
      events: async (req, res) => {
        hits.push(req.url ?? '');
        res.writeHead(204).end();
      }
    }).listen(0);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
      assert.equal((await fetch(`${base}/events?x=1`)).status, 204);
      assert.deepEqual(hits, ['/events?x=1']);
      assert.equal((await fetch(`${base}/unknown`)).status, 404);
    } finally {
      server.close();
    }
  });

  it('relays valid tenant events from Redis to the hub', () => {
    const hub = createHub();
    const seen: string[] = [];
    hub.add('t-1', { write: (chunk) => void seen.push(chunk) });
    const onMessage = relay(hub);
    onMessage('events:*', 'events:t-1', '{"kind":"run","id":"r1","status":"completed"}');
    onMessage('events:*', 'events:t-1', 'garbage');
    onMessage('events:*', 'other', '{"kind":"run","id":"r1","status":"completed"}');
    assert.deepEqual(seen, ['data: {"kind":"run","id":"r1","status":"completed"}\n\n']);
  });
});
