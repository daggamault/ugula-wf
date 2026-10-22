import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createSseServer } from './main.ts';

describe('sse createSseServer', () => {
  it('serves /health and /events', async () => {
    const server = createSseServer().listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    try {
      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(healthRes.status, 200);
      assert.deepEqual(await healthRes.json(), { status: 'ok' });

      const ctrl = new AbortController();
      const sseRes = await fetch(`http://127.0.0.1:${port}/events`, { signal: ctrl.signal });
      assert.equal(sseRes.status, 200);
      assert.equal(sseRes.headers.get('content-type'), 'text/event-stream');
      ctrl.abort();

      const missingRes = await fetch(`http://127.0.0.1:${port}/unknown`);
      assert.equal(missingRes.status, 404);
    } finally {
      server.close();
    }
  });
});
