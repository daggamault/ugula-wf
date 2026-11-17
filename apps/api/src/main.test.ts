import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS, type Permission } from '@ugula/access';
import { createSessionStore } from '@ugula/auth';
import type { Db } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import { createStdNodes, STD_KINDS } from '@ugula/graph';
import type { BlobStore } from '@ugula/storage';
import type { Config } from './config.ts';
import { createApp } from './main.ts';
import { memoryRedis } from './shared/testing.ts';

const ORIGIN = 'http://localhost:3000';

const EVIL = 'https://evil.example';

const AGENCY_ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const AGENCY = `/api/agencies/${AGENCY_ID}`;

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f966';

const UNAUTHORIZED = { error: 'Unauthorized' };

const FORBIDDEN = 'You do not have permission to do this';

const deps: Parameters<typeof createApp>[0] = {
  config: {
    NODE_ENV: 'test',
    API_CORS_ORIGINS: `${ORIGIN}, http://localhost:3100`,
    API_MAX_BODY_BYTES: 1024,
    SSE_URL: 'http://localhost:3002',
    WEB_URL: ORIGIN,
    SFTP_HOOK_SECRET: 'x'.repeat(32)
  } as Config,
  db: {} as Db,
  redis: memoryRedis().redis,
  boss: { insert: async () => null },
  blobs: {} as BlobStore,
  embedder: { embed: async () => [] },
  nodes: createStdNodes({ fetch }),
  kinds: STD_KINDS,
  events: [],
  publish: async () => undefined,
  clientIp: () => '10.0.0.1',
  sealSecret: null
};

const app = createApp(deps);

const signedIn = async () => {
  const { redis } = memoryRedis();
  const held: string[] = [];
  const { db } = createRecordingDb((q) => {
    if (q.sql.includes('is_full')) {
      return q.parameters.includes(AGENCY_ID)
        ? [
            {
              agency_id: AGENCY_ID,
              agency_name: 'Development',
              organization_id: 'o-1',
              organization_name: 'Development EMS',
              is_full: false,
              permissions: held
            }
          ]
        : [];
    }
    return q.sql.includes('from "users"') ? [{ id: 'u-1', email: 'dev@example.com' }] : [];
  });
  const token = await createSessionStore(redis).create({
    userId: 'u-1',
    email: 'dev@example.com'
  });
  const guarded = createApp({ ...deps, db, redis });
  return async (
    permissions: readonly string[],
    method: string,
    path: string,
    body?: unknown,
    base = AGENCY
  ) => {
    held.splice(0, held.length, ...permissions);
    const res = await guarded.request(`${base}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        cookie: `ugula_session=${token}`,
        'content-type': 'application/json'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: res.status, text: await res.text() };
  };
};

const isForbidden = (res: { status: number; text: string }) =>
  res.status === 403 && res.text.includes(FORBIDDEN);

describe('api createApp', () => {
  it('serves health without a session', async () => {
    const res = await app.request('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('requires a session for the account and every agency route', async () => {
    for (const path of [
      '/api/auth/me',
      '/api/agencies',
      `${AGENCY}/access`,
      `${AGENCY}/roles`,
      `${AGENCY}/users`,
      `${AGENCY}/invitations`,
      ...[
        '/graphs',
        '/tables',
        '/runs',
        '/tasks/queues',
        '/imports',
        '/fees',
        '/payers',
        '/patients?lastName=doe',
        '/notifications',
        '/codes?set=icd10cm&q=chest',
        '/facilities/hospitals?q=mercy',
        '/billing-profile',
        '/clearinghouse-connection',
        '/claims',
        '/submissions',
        '/reports/aging',
        '/payer-files'
      ].map((p) => `${AGENCY}${p}`)
    ]) {
      const res = await app.request(path);
      assert.deepEqual([res.status, await res.json()], [401, UNAUTHORIZED], path);
    }
  });

  it('mounts agency features only under an agency', async () => {
    for (const path of ['/api/graphs', '/api/claims']) {
      assert.equal((await app.request(path)).status, 404, path);
    }
  });

  it('lets the SFTP hook in with the shared secret only', async () => {
    const hook = (secret: string, action: string) =>
      app.request('/api/imports/sftp/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action, username: 'acme', virtual_path: '/a', status: 1 })
      });
    const allowed = await hook('x'.repeat(32), 'download');
    assert.deepEqual([allowed.status, await allowed.json()], [200, { ignored: true }]);
    assert.equal((await hook('y'.repeat(32), 'upload')).status, 401);
  });

  it('refuses form-like and bodyless writes from other origins', async () => {
    const forged = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { origin: EVIL, 'content-type': 'text/plain' },
      body: '{}'
    });
    assert.equal(forged.status, 403);
    const bodyless = await app.request(`${AGENCY}/tasks/x/claim`, {
      method: 'POST',
      headers: { origin: EVIL }
    });
    assert.equal(bodyless.status, 403);
    const upload = await app.request(`${AGENCY}/imports`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: '--x--'
    });
    assert.equal(upload.status, 403);
    for (const origin of [ORIGIN, 'http://localhost:3100']) {
      const signOut = await app.request('/api/auth/sign-out', {
        method: 'POST',
        headers: { origin }
      });
      assert.equal(signOut.status, 200, origin);
    }
  });

  it('allows credentialed cross-origin calls from the configured origins only', async () => {
    const preflight = (origin: string) =>
      app.request('/api/auth/me', {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST' }
      });
    const allowed = await preflight('http://localhost:3100');
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3100');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    const refused = await preflight(EVIL);
    assert.equal(refused.headers.get('access-control-allow-origin'), null);
  });

  it('caps JSON request bodies but leaves uploads to their own limits', async () => {
    const big = await app.request('/api/auth/sign-in', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com', password: 'x'.repeat(2048) })
    });
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'Request body too large' });
    const upload = await app.request(`${AGENCY}/imports`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'multipart/form-data; boundary=x' },
      body: `--x\r\n${'x'.repeat(2048)}\r\n--x--`
    });
    assert.deepEqual([upload.status, await upload.json()], [401, UNAUTHORIZED]);
  });

  it('hides agencies the user does not belong to', async () => {
    const send = await signedIn();
    const other = '/api/agencies/01a16617-7704-7ba6-b9b5-9c79fa44f960';
    for (const base of [other, '/api/agencies/nope']) {
      assert.deepEqual(
        await send(PERMISSIONS, 'GET', '/graphs', undefined, base),
        { status: 404, text: JSON.stringify({ error: 'Agency not found' }) },
        base
      );
    }
  });

  it('maps agency routes to the permission each action needs', async () => {
    const send = await signedIn();
    const fee = { code: 'A0427', amountCents: 1 };
    const facility = { name: 'Mercy', kind: 'hospital', isContract: false };
    const cases: [Permission[], string, string, unknown?][] = [
      [['workflows:read'], 'GET', '/graphs'],
      [['workflows:update'], 'POST', '/graphs', {}],
      [['workflows:update'], 'DELETE', `/graphs/${ID}`],
      [['workflows:read'], 'GET', '/tables'],
      [['workflows:update'], 'POST', '/tables', {}],
      [['workflows:update'], 'PUT', `/tables/${ID}/draft`, { definition: {} }],
      [['workflows:update'], 'DELETE', `/tables/${ID}`],
      [['runs:read'], 'GET', '/runs'],
      [['runs:create'], 'POST', '/runs', { graphId: ID }],
      [['runs:update'], 'POST', `/runs/${ID}/cancel`],
      [['tasks:read'], 'GET', '/tasks/queues'],
      [['tasks:update'], 'POST', `/tasks/${ID}/claim`],
      [['fees:read'], 'GET', '/fees'],
      [['fees:create', 'fees:update'], 'PUT', '/fees', fee],
      [['fees:delete'], 'DELETE', `/fees/${ID}`],
      [['payers:read'], 'GET', '/payers'],
      [['payers:create', 'payers:update'], 'PUT', '/payers', {}],
      [['payers:delete'], 'DELETE', `/payers/${ID}`],
      [['facilities:read'], 'GET', '/facilities'],
      [['facilities:read'], 'GET', '/facilities/hospitals?q=mercy'],
      [['facilities:create'], 'POST', '/facilities', facility],
      [['facilities:update'], 'PUT', `/facilities/${ID}`, facility],
      [['facilities:delete'], 'DELETE', `/facilities/${ID}`],
      [['patients:read'], 'GET', '/patients'],
      [['settings:read'], 'GET', '/billing-profile'],
      [['settings:update'], 'PUT', '/billing-profile', {}],
      [['settings:read'], 'GET', '/clearinghouse-connection'],
      [['settings:update'], 'PUT', '/clearinghouse-connection', {}],
      [['settings:update'], 'DELETE', '/clearinghouse-connection'],
      [['claims:read'], 'GET', '/claims'],
      [['imports:read'], 'GET', '/imports'],
      [['imports:create'], 'POST', '/imports/auth', {}]
    ];
    for (const [needed, method, path, body] of cases) {
      const label = `${needed} ${method} ${path}`;
      const others = PERMISSIONS.filter((p) => !needed.includes(p));
      assert.equal(isForbidden(await send(others, method, path, body)), true, label);
      for (const one of needed) {
        assert.equal(isForbidden(await send([one], method, path, body)), false, `${one} ${label}`);
      }
    }
  });

  it('opens codes and notifications to every member', async () => {
    const send = await signedIn();
    for (const [method, path, body] of [
      ['GET', '/codes?set=icd10cm&q=chest'],
      ['GET', '/notifications'],
      ['POST', '/notifications/read', {}]
    ] as const) {
      assert.equal(isForbidden(await send([], method, path, body)), false, `${method} ${path}`);
    }
  });

  it('refuses methods an agency route does not map, whatever the permissions', async () => {
    const send = await signedIn();
    for (const [method, path] of [
      ['POST', '/codes'],
      ['DELETE', `/patients/${ID}`],
      ['PUT', `/claims/${ID}`],
      ['DELETE', `/claims/${ID}`],
      ['PUT', '/runs']
    ] as const) {
      assert.equal(
        isForbidden(await send(PERMISSIONS, method, path, {})),
        true,
        `${method} ${path}`
      );
    }
  });

  it('checks HEAD requests against the read permission', async () => {
    const send = await signedIn();
    const head = async (permissions: Permission[]) =>
      (await send(permissions, 'HEAD', '/patients')).status;
    assert.equal(await head(['claims:read']), 403);
    assert.notEqual(await head(['patients:read']), 403);
  });
});
