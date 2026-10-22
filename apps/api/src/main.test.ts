import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '@ugula/db';
import type { Config } from './config.ts';
import { createApp } from './main.ts';
import type { RedisLike } from './shared/session.ts';

describe('api createApp', () => {
  it('mounts /health and /api/auth routes', async () => {
    const app = createApp({
      config: {
        NODE_ENV: 'test',
        HTTP_CORS_ORIGINS: 'http://localhost:3000',
        SSE_URL: 'http://localhost:3002'
      } as Config,
      db: {} as Db,
      redis: {
        set: async () => undefined,
        get: async () => null,
        del: async () => undefined
      } as RedisLike
    });

    const healthRes = await app.request('/health');
    assert.equal(healthRes.status, 200);
    assert.deepEqual(await healthRes.json(), { status: 'ok' });

    const meRes = await app.request('/api/auth/me');
    assert.equal(meRes.status, 401);
  });
});
