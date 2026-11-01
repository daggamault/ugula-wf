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
      'workflows',
      'runs',
      'tasks',
      'imports',
      'fees',
      'claims',
      'patients',
      'settings',
      'reports',
      'notifications'
    ]);
    await clients.workflows.list();
    assert.deepEqual(urls, ['http://api.test/api/graphs']);
  });

  it('throws when the root element is missing', () => {
    assert.throws(
      () => mountApp(null, { apiUrl: 'http://localhost:3001' }),
      /Missing root element/
    );
  });
});
