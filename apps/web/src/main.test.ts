import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClients, mountApp } from './main.ts';

const recording = (status: number, body: unknown) => {
  const calls: string[] = [];
  const clients = createClients({ apiUrl: 'http://api.test' }, async (url, init = {}) => {
    calls.push(`${init.method} ${String(url)}`);
    return new Response(JSON.stringify(body), { status });
  });
  return { clients, calls };
};

describe('createClients', () => {
  it('builds every feature client', () => {
    assert.deepEqual(Object.keys(recording(200, {}).clients), [
      'auth',
      'agencies',
      'users',
      'roles',
      'workflows',
      'runs',
      'tasks',
      'imports',
      'payerFiles',
      'deposits',
      'fees',
      'claims',
      'patients',
      'payers',
      'facilities',
      'settings',
      'periods',
      'reports',
      'notifications',
      'codes'
    ]);
  });

  it('sends requests to the configured API with the given fetch', async () => {
    const { clients, calls } = recording(200, { items: [] });
    await clients.workflows.search('show=workflows');
    assert.deepEqual(calls, ['GET http://api.test/api/graphs?show=workflows']);
  });

  it('tells the session once a request outside sign-in is refused', async () => {
    const { clients } = recording(401, { error: 'Unauthorized' });
    let expired = 0;
    clients.auth.onExpired(() => expired++);
    await assert.rejects(() => clients.workflows.search(''), { message: 'Unauthorized' });
    assert.equal(expired, 1);
  });

  it('does not treat a refused session check as an expiry', async () => {
    const { clients } = recording(401, { error: 'Unauthorized' });
    let expired = 0;
    clients.auth.onExpired(() => expired++);
    assert.equal(await clients.auth.getMe(), null);
    assert.equal(expired, 0);
  });
});

describe('mountApp', () => {
  it('throws when the root element is missing', () => {
    assert.throws(() => mountApp(null, { apiUrl: 'http://localhost:3001' }), {
      message: 'Missing root element'
    });
  });
});
