import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import { createHttpNodes } from './http.ts';

describe('http request node', () => {
  it('sends JSON with an idempotency key and parses JSON responses', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const [node] = createHttpNodes({
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return new Response('{"ok":true}', {
          status: 201,
          headers: { 'content-type': 'application/json' }
        });
      }
    });
    if (!node) throw new Error('missing node');
    const { outputs } = await invokeNode(node, {
      config: { method: 'POST' },
      inputs: { url: 'https://x.test/claims', body: { id: 1 }, headers: { 'x-api': 'k' } }
    });
    assert.equal(outputs.status, 201);
    assert.deepEqual(outputs.body, { ok: true });
    assert.equal(calls[0]?.init.body, '{"id":1}');
    assert.deepEqual(calls[0]?.init.headers, {
      'idempotency-key': 'key',
      'content-type': 'application/json',
      'x-api': 'k'
    });
  });

  it('fails on error statuses unless told otherwise', async () => {
    const [node] = createHttpNodes({ fetch: async () => new Response('nope', { status: 503 }) });
    if (!node) throw new Error('missing node');
    await assert.rejects(
      () => invokeNode(node, { inputs: { url: 'https://x.test' } }),
      /HTTP 503: nope/
    );
    const { outputs } = await invokeNode(node, {
      config: { failOnError: false },
      inputs: { url: 'https://x.test' }
    });
    assert.deepEqual([outputs.status, outputs.body], [503, 'nope']);
  });
});
