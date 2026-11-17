import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import { createHttpNodes, isPublicAddress } from './http.ts';

describe('isPublicAddress', () => {
  it('tells resolved public addresses from private, loopback and link-local ones', () => {
    for (const ip of ['8.8.8.8', '2001:4860::8888', '::ffff:8.8.8.8']) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
    for (const ip of ['169.254.169.254', '10.1.2.3', '::1', '::ffff:10.0.0.1', 'fe80::1%eth0']) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  it('draws the private ranges at their exact edges', () => {
    const edges: [string, boolean][] = [
      ['172.15.255.255', true],
      ['172.16.0.1', false],
      ['172.31.255.255', false],
      ['172.32.0.1', true],
      ['100.63.255.255', true],
      ['100.64.0.1', false],
      ['100.127.255.255', false],
      ['100.128.0.0', true],
      ['198.17.255.255', true],
      ['198.18.0.1', false],
      ['198.19.255.255', false],
      ['198.20.0.0', true],
      ['192.0.0.8', false],
      ['192.0.2.1', true],
      ['0.1.2.3', false],
      ['223.255.255.255', true],
      ['224.0.0.1', false],
      ['255.255.255.255', false]
    ];
    assert.deepEqual(
      edges.map(([ip]) => [ip, isPublicAddress(ip)]),
      edges
    );
  });

  it('treats IPv6 unique-local, link-local, multicast and unspecified addresses as private', () => {
    const cases: [string, boolean][] = [
      ['::', false],
      ['fc00::1', false],
      ['fbff::1', true],
      ['febf::1', false],
      ['fec0::1', true],
      ['ff02::1', false],
      ['::ffff:192.168.1.1', false],
      ['64:ff9b::808:808', true],
      ['64:ff9b::a00:1', false]
    ];
    assert.deepEqual(
      cases.map(([ip]) => [ip, isPublicAddress(ip)]),
      cases
    );
  });

  it('rejects text that is not an address', () => {
    for (const ip of ['1.2.3', '256.1.1.1', 'example.com', ''])
      assert.equal(isPublicAddress(ip), false, ip);
  });
});

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

  it('sends text bodies as is and returns non-JSON responses as text', async () => {
    const calls: RequestInit[] = [];
    const [node] = createHttpNodes({
      fetch: async (_, init = {}) => {
        calls.push(init);
        return new Response('{"a":1}', { headers: { 'content-type': 'text/plain' } });
      }
    });
    if (!node) throw new Error('missing node');
    const { outputs } = await invokeNode(node, {
      config: { method: 'PUT' },
      inputs: { url: 'https://x.test', body: 'raw' }
    });
    assert.deepEqual([calls[0]?.method, calls[0]?.body], ['PUT', 'raw']);
    assert.deepEqual(calls[0]?.headers, { 'idempotency-key': 'key' });
    assert.equal(outputs.body, '{"a":1}');
    assert.equal((outputs.headers as Record<string, string>)['content-type'], 'text/plain');
    await invokeNode(node, { inputs: { url: 'https://x.test' } });
    assert.deepEqual([calls[1]?.method, 'body' in (calls[1] ?? {})], ['GET', false]);
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
    const [json] = createHttpNodes({
      fetch: async () =>
        new Response('{"error":"bad"}', {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
    });
    if (!json) throw new Error('missing node');
    await assert.rejects(
      () => invokeNode(json, { inputs: { url: 'https://x.test' } }),
      /HTTP 400: \{"error":"bad"\}/
    );
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

  it('keeps the method on 307 and drops headers when a redirect leaves the origin', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const [node] = createHttpNodes({
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url) === 'https://x.test/a')
          return new Response(null, { status: 307, headers: { location: '/b' } });
        if (String(url) === 'https://x.test/b')
          return new Response(null, { status: 308, headers: { location: 'https://y.test/c' } });
        return new Response('ok');
      }
    });
    if (!node) throw new Error('missing node');
    await invokeNode(node, {
      config: { method: 'POST' },
      inputs: { url: 'https://x.test/a', body: 'b', headers: { authorization: 't' } }
    });
    assert.deepEqual(
      calls.map((c) => [c.url, c.init.method, c.init.body, c.init.headers]),
      [
        ['https://x.test/a', 'POST', 'b', { 'idempotency-key': 'key', authorization: 't' }],
        ['https://x.test/b', 'POST', 'b', { 'idempotency-key': 'key', authorization: 't' }],
        ['https://y.test/c', 'POST', 'b', {}]
      ]
    );
  });

  it('stops after too many redirects', async () => {
    let hops = 0;
    const [node] = createHttpNodes({
      fetch: async () => {
        hops++;
        return new Response(null, { status: 302, headers: { location: `/r${hops}` } });
      }
    });
    if (!node) throw new Error('missing node');
    await assert.rejects(
      () => invokeNode(node, { inputs: { url: 'https://x.test' } }),
      /redirected more than 5 times/
    );
    assert.equal(hops, 6);
  });

  it('reads an empty answer as empty text, or nothing when it says JSON', async () => {
    const answer = (res: Response) => {
      const [node] = createHttpNodes({ fetch: async () => res });
      if (!node) throw new Error('missing node');
      return invokeNode(node, { inputs: { url: 'https://x.test' } });
    };
    assert.deepEqual((await answer(new Response(null, { status: 204 }))).outputs, {
      status: 204,
      headers: {},
      body: ''
    });
    const json = await answer(
      new Response('', { headers: { 'content-type': 'application/json; charset=utf-8' } })
    );
    assert.deepEqual(json.outputs.body, null);
  });

  it('returns a redirect status without a location as the answer', async () => {
    let calls = 0;
    const [node] = createHttpNodes({
      fetch: async () => {
        calls++;
        return new Response(null, { status: 304 });
      }
    });
    if (!node) throw new Error('missing node');
    const { outputs } = await invokeNode(node, {
      config: { failOnError: false },
      inputs: { url: 'https://x.test' }
    });
    assert.deepEqual([outputs.status, calls], [304, 1]);
  });

  it('cuts the error message to 500 characters', async () => {
    const [node] = createHttpNodes({
      fetch: async () => new Response('x'.repeat(1000), { status: 500 })
    });
    if (!node) throw new Error('missing node');
    await assert.rejects(
      () => invokeNode(node, { inputs: { url: 'https://x.test' } }),
      (e: Error) => e.message === `HTTP 500: ${'x'.repeat(490)}`
    );
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
    const [declared] = createHttpNodes({
      maxResponseBytes: 4,
      fetch: async () => new Response('1', { headers: { 'content-length': '5' } })
    });
    if (!declared) throw new Error('missing node');
    await assert.rejects(
      () => invokeNode(declared, { inputs: { url: 'https://x.test' } }),
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
