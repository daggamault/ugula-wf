import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi, isApiError, messageOf, scopedPath } from './api.ts';

const recorder = (
  respond: () => Response = () => new Response('{"ok":true}', { status: 200 }),
  agencyOf: () => string | null = () => null
) => {
  const calls: { url: string; init: RequestInit }[] = [];
  let expired = 0;
  const api = createApi(
    'http://api.test',
    async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return respond();
    },
    () => {
      expired += 1;
    },
    agencyOf
  );
  return { api, calls, expired: () => expired };
};

const failure = (status: number, body: string) => () => new Response(body, { status });

const errorOf = async (request: Promise<unknown>) => {
  const err = await request.catch((e: unknown) => e);
  assert.ok(isApiError(err), 'expected an API error');
  return { message: err.message, status: err.status, body: err.body };
};

describe('createApi requests', () => {
  it('reads with credentials and returns the parsed body', async () => {
    const { api, calls } = recorder();
    assert.deepEqual(await api.get('/y'), { ok: true });
    assert.deepEqual(calls, [
      { url: 'http://api.test/y', init: { method: 'GET', credentials: 'include' } }
    ]);
  });

  it('posts and puts JSON bodies', async () => {
    const { api, calls } = recorder();
    await api.post('/x', { a: 1 });
    await api.put('/x/1', { a: 2 });
    const json = { 'content-type': 'application/json' };
    assert.deepEqual(calls, [
      {
        url: 'http://api.test/x',
        init: { method: 'POST', credentials: 'include', headers: json, body: '{"a":1}' }
      },
      {
        url: 'http://api.test/x/1',
        init: { method: 'PUT', credentials: 'include', headers: json, body: '{"a":2}' }
      }
    ]);
  });

  it('posts without a body when none is given', async () => {
    const { api, calls } = recorder();
    await api.post('/x/run');
    assert.deepEqual(calls[0]?.init, { method: 'POST', credentials: 'include' });
  });

  it('deletes with credentials', async () => {
    const { api, calls } = recorder();
    await api.remove('/d');
    assert.deepEqual(calls, [
      { url: 'http://api.test/d', init: { method: 'DELETE', credentials: 'include' } }
    ]);
  });

  it('uploads form data as it is, without a JSON content type', async () => {
    const { api, calls } = recorder();
    const form = new FormData();
    await api.upload('/u', form);
    assert.deepEqual(calls[0]?.init, { method: 'POST', credentials: 'include', body: form });
  });

  it('returns null for a successful response without a JSON body', async () => {
    const { api } = recorder(() => new Response(null, { status: 204 }));
    assert.equal(await api.post('/x'), null);
  });

  it('hands the abort signal of a read to fetch', async () => {
    const { api, calls } = recorder();
    const controller = new AbortController();
    await api.get('/a', controller.signal);
    await api.get('/b');
    assert.deepEqual(
      calls.map((c) => c.init.signal),
      [controller.signal, undefined]
    );
  });

  it('links to paths under the base URL', () => {
    const { api } = recorder();
    assert.equal(api.href('/x'), 'http://api.test/x');
  });
});

describe('createApi errors', () => {
  it('raises the error message and body the API sent', async () => {
    const { api } = recorder(failure(422, '{"error":"Fix","issues":[1]}'));
    assert.deepEqual(await errorOf(api.put('/z', {})), {
      message: 'Fix',
      status: 422,
      body: { error: 'Fix', issues: [1] }
    });
  });

  it('names the status when the body is not JSON', async () => {
    const { api } = recorder(failure(500, 'oops'));
    assert.deepEqual(await errorOf(api.get('/')), {
      message: 'Request failed with status 500',
      status: 500,
      body: {}
    });
  });

  it('names the status when the error field is not text', async () => {
    const { api } = recorder(failure(400, '{"error":{"code":1}}'));
    assert.deepEqual(await errorOf(api.get('/')), {
      message: 'Request failed with status 400',
      status: 400,
      body: { error: { code: 1 } }
    });
  });

  it('keeps an empty body for a JSON value that is not an object', async () => {
    const { api } = recorder(failure(502, '"Bad gateway"'));
    assert.deepEqual(await errorOf(api.get('/')), {
      message: 'Request failed with status 502',
      status: 502,
      body: {}
    });
  });

  it('reports an expired session for a 401 from any API but the auth endpoints', async () => {
    const { api, expired } = recorder(failure(401, '{"error":"Unauthorized"}'));
    await assert.rejects(api.get('/api/claims'), /Unauthorized/);
    assert.equal(expired(), 1);
    await assert.rejects(api.get('/api/auth/me'), /Unauthorized/);
    assert.equal(expired(), 1);
  });

  it('does not report an expired session for other failures', async () => {
    const { api, expired } = recorder(failure(403, '{"error":"Forbidden"}'));
    await assert.rejects(api.get('/api/claims'), /Forbidden/);
    assert.equal(expired(), 0);
  });
});

describe('createApi agency scope', () => {
  it('scopes requests and links to the agency the page is on', async () => {
    let agency: string | null = 'a1';
    const { api, calls } = recorder(undefined, () => agency);
    await api.get('/api/runs');
    assert.equal(api.href('/api/files/f1'), 'http://api.test/api/agencies/a1/files/f1');
    agency = null;
    await api.get('/api/runs');
    assert.deepEqual(
      calls.map((c) => c.url),
      ['http://api.test/api/agencies/a1/runs', 'http://api.test/api/runs']
    );
  });

  it('uploads to the agency it is given rather than the one on screen now', async () => {
    const { api, calls } = recorder(undefined, () => 'b-2');
    await api.upload('/api/imports', new FormData(), 'a-1');
    await api.upload('/api/imports', new FormData());
    assert.deepEqual(
      calls.map((c) => c.url),
      ['http://api.test/api/agencies/a-1/imports', 'http://api.test/api/agencies/b-2/imports']
    );
  });
});

describe('isApiError', () => {
  it('tells API errors from other errors and values', () => {
    assert.equal(isApiError(Object.assign(new Error('x'), { status: 500, body: {} })), true);
    assert.equal(isApiError(new Error('x')), false);
    assert.equal(isApiError({ message: 'x', status: 500, body: {} }), false);
  });
});

describe('messageOf', () => {
  it('describes errors by their message', () => {
    assert.equal(messageOf(new Error('x')), 'x');
  });

  it('describes other thrown values as text', () => {
    assert.equal(messageOf('plain'), 'plain');
    assert.equal(messageOf(42), '42');
    assert.equal(messageOf(null), 'null');
  });
});

describe('scopedPath', () => {
  it('moves agency APIs under the current agency', () => {
    assert.equal(scopedPath('/api/claims?q=1', 'a1'), '/api/agencies/a1/claims?q=1');
  });

  it('leaves paths alone without an agency', () => {
    assert.equal(scopedPath('/api/claims', null), '/api/claims');
  });

  it('leaves auth, agency and non-API paths alone', () => {
    assert.equal(scopedPath('/api/auth/me', 'a1'), '/api/auth/me');
    assert.equal(scopedPath('/api/agencies', 'a1'), '/api/agencies');
    assert.equal(scopedPath('/api/agencies/a2/access', 'a1'), '/api/agencies/a2/access');
    assert.equal(scopedPath('/health', 'a1'), '/health');
  });
});
