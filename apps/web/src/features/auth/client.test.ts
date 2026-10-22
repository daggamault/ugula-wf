import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAuthClient } from './client.ts';

describe('createAuthClient', () => {
  it('signs in and validates session payload', async () => {
    const session = {
      user: { id: 'u-1', tenantId: 't-1', email: 'dev@example.com' },
      sseUrl: 'http://localhost:3002'
    };
    const client = createAuthClient(
      'http://localhost:3001',
      async () => new Response(JSON.stringify(session), { status: 200 })
    );

    const res = await client.signIn('dev@example.com', 'P@ssw0rd123');
    assert.deepEqual(res, session);
    assert.deepEqual(await client.getMe(), session);
  });

  it('throws error message on failed sign in and failed sign out', async () => {
    const client = createAuthClient(
      'http://localhost:3001',
      async () =>
        new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401 })
    );

    await assert.rejects(
      () => client.signIn('dev@example.com', 'wrong'),
      /Invalid email or password/
    );
    await assert.rejects(() => client.signOut(), /Sign out failed with status 401/);
    assert.equal(await client.getMe(), null);
  });
});
