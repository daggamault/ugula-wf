import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionStore } from '@ugula/auth';
import type { Db } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import { createStdNodes } from '@ugula/graph';
import { createNemsisNodes } from '@ugula/nemsis';
import type { BlobStore } from '@ugula/storage';
import type { Config } from './config.ts';
import { createApp } from './main.ts';
import { memoryRedis } from './shared/testing.ts';

const ORIGIN = 'http://localhost:3000';

const AGENCY_ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const AGENCY = `/api/agencies/${AGENCY_ID}`;

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f966';

const deps: Parameters<typeof createApp>[0] = {
  config: {
    NODE_ENV: 'test',
    HTTP_CORS_ORIGINS: ORIGIN,
    HTTP_MAX_BODY_BYTES: 1024,
    SSE_URL: 'http://localhost:3002',
    WEB_URL: ORIGIN,
    SFTP_HOOK_SECRET: 'x'.repeat(32)
  } as Config,
  db: {} as Db,
  redis: memoryRedis().redis,
  boss: { insert: async () => null },
  blobs: {} as BlobStore,
  embedder: { embed: async () => [] },
  nodes: [...createStdNodes({ fetch }), ...createNemsisNodes(null)],
  announce: async () => undefined,
  clientIp: () => '10.0.0.1',
  sealSecret: null
};

const app = createApp(deps);

describe('api createApp', () => {
  it('mounts public health and auth routes and protects workflow routes', async () => {
    const healthRes = await app.request('/health');
    assert.equal(healthRes.status, 200);
    assert.deepEqual(await healthRes.json(), { status: 'ok' });

    for (const path of [
      '/api/auth/me',
      '/api/agencies',
      `${AGENCY}/access`,
      `${AGENCY}/roles`,
      `${AGENCY}/users`,
      `${AGENCY}/invitations`,
      ...[
        '/graphs',
        '/runs',
        '/tasks/queues',
        '/imports',
        '/fees',
        '/payers',
        '/patients?lastName=doe',
        '/notifications',
        '/billing-profile',
        '/claims',
        '/submissions',
        '/reports/aging',
        '/payer-files'
      ].map((p) => `${AGENCY}${p}`)
    ]) {
      assert.equal((await app.request(path)).status, 401, path);
    }
    for (const path of ['/api/graphs', '/api/claims']) {
      assert.equal((await app.request(path)).status, 404, path);
    }

    const hook = await app.request('/api/imports/sftp/upload', {
      method: 'POST',
      headers: { authorization: `Bearer ${'x'.repeat(32)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'download', username: 'acme', virtual_path: '/a', status: 1 })
    });
    assert.deepEqual(await hook.json(), { ignored: true });
    const forgedHook = await app.request('/api/imports/sftp/upload', {
      method: 'POST',
      headers: { authorization: `Bearer ${'y'.repeat(32)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upload', username: 'acme', virtual_path: '/a', status: 1 })
    });
    assert.equal(forgedHook.status, 401);
  });

  it('refuses form-like and bodyless writes from other origins', async () => {
    const forged = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: '{}'
    });
    assert.equal(forged.status, 403);
    const bodyless = await app.request(`${AGENCY}/tasks/x/claim`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' }
    });
    assert.equal(bodyless.status, 403);
    const upload = await app.request(`${AGENCY}/imports`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: '--x--'
    });
    assert.equal(upload.status, 403);
    const signOut = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { origin: ORIGIN }
    });
    assert.equal(signOut.status, 200);
  });

  it('maps agency routes to the permission each action needs', async () => {
    const { redis } = memoryRedis();
    const permissions: string[] = [];
    const { db } = createRecordingDb((q) =>
      q.sql.includes('is_full')
        ? [
            {
              agency_id: AGENCY_ID,
              agency_name: 'Development',
              organization_id: 'o-1',
              organization_name: 'Development EMS',
              is_full: false,
              permissions
            }
          ]
        : q.sql.includes('from "users"')
          ? [{ id: 'u-1', email: 'dev@example.com' }]
          : []
    );
    const guarded = createApp({ ...deps, db, redis });
    const token = await createSessionStore(redis).create({
      userId: 'u-1',
      email: 'dev@example.com'
    });
    const send = async (held: string[], method: string, path: string, body?: unknown) => {
      permissions.splice(0, permissions.length, ...held);
      const res = await guarded.request(`${AGENCY}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          cookie: `ugula_session=${token}`,
          'content-type': 'application/json'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await res.text();
      return res.status === 403 && text.includes('You do not have permission to do this');
    };
    const fee = { code: 'A0427', amountCents: 1 };
    const facility = { name: 'Mercy', kind: 'hospital', isContract: false };
    const cases: [string[], string, string, unknown, boolean][] = [
      [['runs:create'], 'POST', `/runs/${ID}/cancel`, undefined, false],
      [['runs:update'], 'POST', `/runs/${ID}/cancel`, undefined, true],
      [['runs:update'], 'POST', '/runs', { graphId: ID }, false],
      [['fees:create'], 'PUT', '/fees', fee, true],
      [['fees:update'], 'PUT', '/fees', fee, true],
      [['fees:read'], 'PUT', '/fees', fee, false],
      [['payers:read'], 'GET', '/facilities', undefined, false],
      [['facilities:read'], 'GET', '/facilities', undefined, true],
      [['payers:create'], 'POST', '/facilities', facility, false],
      [['facilities:create'], 'POST', '/facilities', facility, true],
      [['payers:update'], 'PUT', `/facilities/${ID}`, facility, false],
      [['facilities:delete'], 'DELETE', `/facilities/${ID}`, undefined, true]
    ];
    for (const [held, method, path, body, allowed] of cases) {
      assert.equal(!(await send(held, method, path, body)), allowed, `${held} ${method} ${path}`);
    }
  });

  it('caps JSON request bodies', async () => {
    const res = await app.request('/api/auth/sign-in', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com', password: 'x'.repeat(2048) })
    });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'Request body too large' });
  });
});
