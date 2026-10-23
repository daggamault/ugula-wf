import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createAuthClient } from './client.ts';

const session = {
  user: { id: 'u-1', tenantId: 't-1', email: 'dev@example.com' },
  sseUrl: 'http://localhost:3002'
};

const respond = (status: number, body: unknown) =>
  createAuthClient(
    createApi('http://api.test', async () => new Response(JSON.stringify(body), { status }))
  );

describe('createAuthClient', () => {
  it('signs in and validates session payloads', async () => {
    const client = respond(200, session);
    assert.deepEqual(await client.signIn('dev@example.com', 'P@ssw0rd123'), session);
    assert.deepEqual(await client.getMe(), session);
    await assert.rejects(() => respond(200, { user: {} }).getMe());
  });

  it('surfaces sign-in errors and treats 401 as signed out', async () => {
    const client = respond(401, { error: 'Invalid email or password' });
    await assert.rejects(
      () => client.signIn('dev@example.com', 'wrong'),
      /Invalid email or password/
    );
    assert.equal(await client.getMe(), null);
    await assert.rejects(() => respond(500, {}).getMe(), /status 500/);
  });
});
