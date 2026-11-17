import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
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

const fakeServer = (status = 200, body: unknown = session) => {
  const calls: string[] = [];
  const client = createAuthClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        return new Response(JSON.stringify(body), { status });
      },
      () => undefined,
      () => 'a1'
    ),
    createSignal()
  );
  return { client, calls };
};

describe('createAuthClient', () => {
  it('signs in with the email and password, outside any agency', async () => {
    const { client, calls } = fakeServer();
    assert.deepEqual(await client.signIn('dev@example.com', 'P@ssw0rd123'), session);
    assert.deepEqual(calls, [
      'POST http://api.test/api/auth/sign-in {"email":"dev@example.com","password":"P@ssw0rd123"}'
    ]);
  });

  it('refuses a sign-in answer that is not a session', async () => {
    const { client } = fakeServer(200, { ...session, sseUrl: 'not a url' });
    await assert.rejects(() => client.signIn('dev@example.com', 'pw'), v.ValiError);
  });

  it('says why a sign-in was refused', async () => {
    const { client } = fakeServer(401, { error: 'Invalid email or password' });
    await assert.rejects(() => client.signIn('dev@example.com', 'wrong'), {
      message: 'Invalid email or password',
      status: 401
    });
  });

  it('reads the current session', async () => {
    const { client, calls } = fakeServer();
    assert.deepEqual(await client.getMe(), session);
    assert.deepEqual(calls, ['GET http://api.test/api/auth/me ']);
  });

  it('accepts a platform user without an organization', async () => {
    const platform = {
      ...session,
      user: { ...session.user, type: 'platform', organizationId: null, organizationName: null }
    };
    assert.deepEqual(await fakeServer(200, platform).client.getMe(), platform);
  });

  it('treats an unauthorized session check as signed out', async () => {
    assert.equal(await fakeServer(401, { error: 'Unauthorized' }).client.getMe(), null);
  });

  it('surfaces other session check failures', async () => {
    await assert.rejects(() => fakeServer(500, {}).client.getMe(), {
      message: 'Request failed with status 500'
    });
    await assert.rejects(
      () =>
        fakeServer(200, { ...session, user: { ...session.user, type: 'guest' } }).client.getMe(),
      v.ValiError
    );
  });

  it('signs out', async () => {
    const { client, calls } = fakeServer(200, {});
    assert.equal(await client.signOut(), undefined);
    assert.deepEqual(calls, ['POST http://api.test/api/auth/sign-out ']);
  });

  it('surfaces sign-out failures', async () => {
    await assert.rejects(() => fakeServer(500, {}).client.signOut(), {
      message: 'Request failed with status 500'
    });
  });

  it('passes expiry notices to subscribers until they stop listening', () => {
    const signal = createSignal();
    const client = createAuthClient(createApi('http://api.test'), signal);
    let expired = 0;
    const stop = client.onExpired(() => expired++);
    signal.emit();
    stop();
    signal.emit();
    assert.equal(expired, 1);
  });

  it('previews an invitation by its token', async () => {
    const preview = {
      email: 'a@b.co',
      firstName: 'Ann',
      lastName: 'Bee',
      agencyName: 'North EMS',
      organizationName: 'Acme',
      roleName: 'Biller',
      hasAccount: false
    };
    const { client, calls } = fakeServer(200, preview);
    assert.deepEqual(await client.previewInvitation('a b'), preview);
    assert.deepEqual(calls, ['POST http://api.test/api/auth/invitation/preview {"token":"a b"}']);
  });

  it('accepts an invitation into a session', async () => {
    const { client, calls } = fakeServer();
    assert.deepEqual(await client.acceptInvitation('t1', 'pw'), session);
    assert.deepEqual(calls, [
      'POST http://api.test/api/auth/invitation/accept {"token":"t1","password":"pw"}'
    ]);
    await assert.rejects(
      () => fakeServer(200, { user: {} }).client.acceptInvitation('t', 'p'),
      v.ValiError
    );
  });

  it('sets a password by its token', async () => {
    const { client, calls } = fakeServer(200, {});
    assert.equal(await client.setPassword('t2', 'pw2'), undefined);
    assert.deepEqual(calls, [
      'POST http://api.test/api/auth/password {"token":"t2","password":"pw2"}'
    ]);
  });
});
