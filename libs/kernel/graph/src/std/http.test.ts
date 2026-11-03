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

  it('blocks private, loopback, link-local and metadata addresses by default', async () => {
    const calls: string[] = [];
    const [node] = createHttpNodes({
      fetch: async (url) => {
        calls.push(String(url));
        return new Response('ok');
      }
    });
    if (!node) throw new Error('missing node');
    for (const url of [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://10.1.2.3/',
      'http://172.20.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://localhost:5432/',
      'http://redis:6379/',
      'http://metadata.google.internal/',
      'http://api.localhost./',
      'file:///etc/passwd',
      'not a url'
    ]) {
      await assert.rejects(
        () => invokeNode(node, { inputs: { url } }),
        /not allowed|valid URL/,
        url
      );
    }
    assert.deepEqual(calls, []);
    await invokeNode(node, { inputs: { url: 'https://8.8.8.8/' } });
    await invokeNode(node, { inputs: { url: 'https://[2001:4860::8888]/' } });
    assert.equal(calls.length, 2);
  });

  it('checks every redirect hop against the injected policy', async () => {
    const calls: string[] = [];
    const [node] = createHttpNodes({
      allowUrl: (url) => url.hostname !== 'internal.test',
      fetch: async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)}`);
        if (String(url).endsWith('/start'))
          return new Response(null, { status: 302, headers: { location: '/next' } });
        if (String(url).endsWith('/next'))
          return new Response(null, {
            status: 307,
            headers: { location: 'http://internal.test/' }
          });
        return new Response('ok');
      }
    });
    if (!node) throw new Error('missing node');
    await assert.rejects(
      () =>
        invokeNode(node, {
          config: { method: 'POST' },
          inputs: { url: 'https://x.test/start', body: 'b' }
        }),
      /internal\.test is not allowed/
    );
    assert.deepEqual(calls, ['POST https://x.test/start', 'GET https://x.test/next']);
  });

  it('caps the response size and times out slow servers', async () => {
    const [big] = createHttpNodes({
      maxResponseBytes: 4,
      fetch: async () => new Response('12345')
    });
    if (!big) throw new Error('missing node');
    await assert.rejects(
      () => invokeNode(big, { inputs: { url: 'https://x.test' } }),
      /exceeds 4 bytes/
    );
    const [slow] = createHttpNodes({
      timeoutMs: 10,
      fetch: (_, init = {}) =>
        new Promise((_, reject) => {
          const alive = setInterval(() => {}, 1000);
          init.signal?.addEventListener('abort', () => {
            clearInterval(alive);
            reject(init.signal?.reason);
          });
        })
    });
    if (!slow) throw new Error('missing node');
    await assert.rejects(
      () => invokeNode(slow, { inputs: { url: 'https://x.test' } }),
      /TimeoutError|timed out|aborted/i
    );
  });
});
