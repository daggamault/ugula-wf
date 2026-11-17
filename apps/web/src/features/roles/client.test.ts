import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createRolesClient } from './client.ts';

type Call = { method: string | undefined; url: string; body: unknown; signal: boolean };

const recording = (reply: unknown = {}, status = 200) => {
  const calls: Call[] = [];
  const client = createRolesClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        calls.push({
          method: init.method,
          url: String(url),
          body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
          signal: init.signal !== undefined
        });
        return Response.json(reply, { status });
      },
      () => undefined,
      () => null
    )
  );
  return { client, calls };
};

describe('createRolesClient', () => {
  it('searches roles with the given query and forwards the abort signal', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recording(page);
    assert.deepEqual(await client.search('q=bill', new AbortController().signal), page);
    assert.deepEqual(calls, [
      { method: 'GET', url: 'http://api.test/api/roles?q=bill', body: undefined, signal: true }
    ]);
  });

  it('reads one role by its encoded id', async () => {
    const { client, calls } = recording({ id: 'r/1' });
    assert.deepEqual(await client.role('r/1'), { id: 'r/1' });
    assert.deepEqual(calls, [
      { method: 'GET', url: 'http://api.test/api/roles/r%2F1', body: undefined, signal: false }
    ]);
  });

  it('unwraps the grantable permissions', async () => {
    const grant = { permission: 'claims:read', description: 'Read claims', isGrantable: true };
    const { client, calls } = recording({ items: [grant] });
    assert.deepEqual(await client.grants(), [grant]);
    assert.deepEqual(calls, [
      {
        method: 'GET',
        url: 'http://api.test/api/roles/permissions',
        body: undefined,
        signal: false
      }
    ]);
  });

  it('creates, updates and removes roles with their inputs', async () => {
    const { client, calls } = recording({ id: 'r1' });
    assert.deepEqual(await client.create({ name: 'Biller', permissions: ['claims:read'] }), {
      id: 'r1'
    });
    await client.update('r/1', { name: 'Biller', permissions: [], version: 2 });
    assert.deepEqual(await client.remove('r/1'), { id: 'r1' });
    assert.deepEqual(calls, [
      {
        method: 'POST',
        url: 'http://api.test/api/roles',
        body: { name: 'Biller', permissions: ['claims:read'] },
        signal: false
      },
      {
        method: 'PUT',
        url: 'http://api.test/api/roles/r%2F1',
        body: { name: 'Biller', permissions: [], version: 2 },
        signal: false
      },
      { method: 'DELETE', url: 'http://api.test/api/roles/r%2F1', body: undefined, signal: false }
    ]);
  });

  it('rejects with the server error and its status', async () => {
    const { client } = recording({ error: 'Role is held by 3 users' }, 409);
    await assert.rejects(client.remove('r1'), { message: 'Role is held by 3 users', status: 409 });
  });
});
