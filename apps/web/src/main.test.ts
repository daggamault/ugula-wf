import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClients, mountApp } from './main.ts';

describe('web composition root', () => {
  it('builds every feature client against the configured API', async () => {
    const urls: string[] = [];
    const clients = createClients({ apiUrl: 'http://api.test' }, async (url) => {
      urls.push(String(url));
      return new Response('{"graphs":[]}', { status: 200 });
    });
    assert.deepEqual(Object.keys(clients), [
      'auth',
      'agencies',
      'users',
      'roles',
      'workflows',
      'runs',
      'tasks',
      'imports',
      'payerFiles',
      'fees',
      'claims',
      'patients',
      'settings',
      'reports',
      'notifications'
    ]);
    await clients.workflows.search('show=workflows');
    assert.deepEqual(urls, ['http://api.test/api/graphs?show=workflows']);
  });

  it('tells the session a request outside sign-in was refused', async () => {
    const clients = createClients(
      { apiUrl: 'http://api.test' },
      async () => new Response('{"error":"Unauthorized"}', { status: 401 })
    );
    let expired = 0;
    clients.auth.onExpired(() => expired++);
    await assert.rejects(() => clients.workflows.search(''), /Unauthorized/);
    assert.equal(await clients.auth.getMe(), null);
    assert.equal(expired, 1);
  });

  it('throws when the root element is missing', () => {
    assert.throws(
      () => mountApp(null, { apiUrl: 'http://localhost:3001' }),
      /Missing root element/
    );
  });
});
