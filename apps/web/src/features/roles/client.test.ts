import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createRolesClient } from './client.ts';

describe('createRolesClient', () => {
  it('calls the role endpoints and unwraps the grantable permissions', async () => {
    const calls: string[] = [];
    const client = createRolesClient(
      createApi('', async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)}`);
        return new Response(JSON.stringify({ items: [1] }), { status: 200 });
      })
    );
    await client.search('q=bill');
    await client.role('r/1');
    assert.deepEqual(await client.grants(), [1]);
    await client.create({ name: 'Biller', permissions: ['claims:read'] });
    await client.update('r1', { name: 'Biller', permissions: [], version: 2 });
    await client.remove('r1');
    assert.deepEqual(calls, [
      'GET /api/roles?q=bill',
      'GET /api/roles/r%2F1',
      'GET /api/roles/permissions',
      'POST /api/roles',
      'PUT /api/roles/r1',
      'DELETE /api/roles/r1'
    ]);
  });
});
