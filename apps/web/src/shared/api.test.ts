import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi, isApiError, messageOf, scopedPath } from './api.ts';

describe('createApi', () => {
  it('sends JSON with credentials and returns parsed bodies', async () => {
    const calls: [string, RequestInit][] = [];
    const api = createApi('http://api.test', async (url, init = {}) => {
      calls.push([String(url), init]);
      return new Response('{"ok":true}', { status: 200 });
    });
    assert.deepEqual(await api.post('/x', { a: 1 }), { ok: true });
    await api.get('/y');
    assert.deepEqual(calls[0], [
      'http://api.test/x',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}'
      }
    ]);
    assert.deepEqual(calls[1]?.[1], { method: 'GET', credentials: 'include' });
    const form = new FormData();
    await api.upload('/u', form);
    assert.deepEqual(calls[2]?.[1], { method: 'POST', credentials: 'include', body: form });
    await api.remove('/d');
    assert.equal(api.href('/x'), 'http://api.test/x');
    assert.deepEqual(calls[3]?.[1], { method: 'DELETE', credentials: 'include' });
  });

  it('raises typed errors carrying the status and body', async () => {
    const api = createApi(
      '',
      async () => new Response('{"error":"Fix","issues":[1]}', { status: 422 })
    );
    const err = await api.put('/z', {}).catch((e: unknown) => e);
    assert.ok(isApiError(err));
    assert.equal(err.message, 'Fix');
    assert.equal(err.status, 422);
    assert.deepEqual(err.body.issues, [1]);
    const plain = await createApi('', async () => new Response('oops', { status: 500 }))
      .get('/')
      .catch((e: unknown) => e);
    assert.ok(isApiError(plain) && plain.message === 'Request failed with status 500');
    assert.equal(isApiError(new Error('x')), false);
  });
});

describe('messageOf', () => {
  it('describes errors and thrown values', () => {
    assert.equal(messageOf(new Error('x')), 'x');
    assert.equal(messageOf('plain'), 'plain');
  });
});

describe('createApi session expiry', () => {
  it('reports a 401 from any API but the auth endpoints', async () => {
    let expired = 0;
    const api = createApi(
      'http://api.test',
      async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      () => expired++
    );
    await assert.rejects(() => api.get('/api/claims'), /Unauthorized/);
    await assert.rejects(() => api.get('/api/auth/me'), /Unauthorized/);
    assert.equal(expired, 1);
  });
});

describe('createApi cancellation', () => {
  it('hands the abort signal of a read to fetch', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const api = createApi('', async (_, init) => {
      seen.push(init?.signal);
      return new Response('{}', { status: 200 });
    });
    const controller = new AbortController();
    await api.get('/a', controller.signal);
    await api.get('/b');
    assert.deepEqual(seen, [controller.signal, undefined]);
  });
});

describe('scopedPath', () => {
  it('moves agency APIs under the current agency and leaves the rest alone', () => {
    assert.equal(scopedPath('/api/claims?q=1', 'a1'), '/api/agencies/a1/claims?q=1');
    assert.equal(scopedPath('/api/claims', null), '/api/claims');
    assert.equal(scopedPath('/api/auth/me', 'a1'), '/api/auth/me');
    assert.equal(scopedPath('/api/agencies/a2/access', 'a1'), '/api/agencies/a2/access');
    assert.equal(scopedPath('/health', 'a1'), '/health');
  });

  it('scopes requests and links to the agency the page is on', async () => {
    const urls: string[] = [];
    let agency: string | null = 'a1';
    const api = createApi(
      'http://api.test',
      async (url) => {
        urls.push(String(url));
        return new Response('{}', { status: 200 });
      },
      () => undefined,
      () => agency
    );
    await api.get('/api/runs');
    assert.equal(api.href('/api/files/f1'), 'http://api.test/api/agencies/a1/files/f1');
    agency = null;
    await api.get('/api/runs');
    assert.deepEqual(urls, ['http://api.test/api/agencies/a1/runs', 'http://api.test/api/runs']);
  });
});
