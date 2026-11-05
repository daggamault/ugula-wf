import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createSignal } from '../../shared/signal.ts';
import { createAuthClient } from './client.ts';

const session = {
  user: {
    id: 'u-1',
    email: 'dev@example.com',
    firstName: 'Dev',
    lastName: 'User',
    type: 'organization',
    isOwner: false,
    organizationId: 'o-1',
    organizationName: 'Acme'
  },
  sseUrl: 'http://localhost:3002'
};

const respond = (status: number, body: unknown) =>
  createAuthClient(
    createApi('http://api.test', async () => new Response(JSON.stringify(body), { status })),
    createSignal()
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

describe('signOut', () => {
  it('posts to the sign-out endpoint and surfaces failures', async () => {
    const calls: string[] = [];
    const client = createAuthClient(
      createApi('http://api.test', async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)}`);
        return new Response('{}', { status: 200 });
      }),
      createSignal()
    );
    await client.signOut();
    assert.deepEqual(calls, ['POST http://api.test/api/auth/sign-out']);
    await assert.rejects(() => respond(500, {}).signOut(), /status 500/);
  });
});

describe('session expiry', () => {
  it('passes expiry notices from the API to subscribers', () => {
    const signal = createSignal();
    const client = createAuthClient(createApi('http://api.test'), signal);
    let expired = 0;
    const stop = client.onExpired(() => expired++);
    signal.emit();
    stop();
    signal.emit();
    assert.equal(expired, 1);
  });
});

describe('invitations and passwords', () => {
  it('previews and accepts invitations and sets passwords by token', async () => {
    const calls: string[] = [];
    const client = createAuthClient(
      createApi('http://api.test', async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)} ${init.body ?? ''}`);
        const body = String(url).includes('/invitation/preview') ? { email: 'a@b.co' } : session;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
      createSignal()
    );
    assert.deepEqual(await client.previewInvitation('a b'), { email: 'a@b.co' });
    assert.deepEqual(await client.acceptInvitation('t1', 'pw'), session);
    await client.setPassword('t2', 'pw2');
    assert.deepEqual(calls, [
      'POST http://api.test/api/auth/invitation/preview {"token":"a b"}',
      'POST http://api.test/api/auth/invitation/accept {"token":"t1","password":"pw"}',
      'POST http://api.test/api/auth/password {"token":"t2","password":"pw2"}'
    ]);
    await assert.rejects(() => respond(200, { user: {} }).acceptInvitation('t', 'p'));
  });
});
