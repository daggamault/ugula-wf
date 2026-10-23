import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BlobStore } from '@ugula/blobs';
import type { Db } from '@ugula/db';
import { createStdNodes } from '@ugula/graph';
import { createNemsisNodes } from '@ugula/nemsis';
import type { RedisLike } from '@ugula/sessions';
import type { Config } from './config.ts';
import { createApp } from './main.ts';

describe('api createApp', () => {
  it('mounts public health and auth routes and protects workflow routes', async () => {
    const app = createApp({
      config: {
        NODE_ENV: 'test',
        HTTP_CORS_ORIGINS: 'http://localhost:3000',
        SSE_URL: 'http://localhost:3002',
        SFTP_HOOK_SECRET: 'x'.repeat(32)
      } as Config,
      db: {} as Db,
      redis: {
        set: async () => undefined,
        get: async () => null,
        del: async () => undefined
      } as RedisLike,
      boss: { insert: async () => null },
      blobs: {} as BlobStore,
      nodes: [...createStdNodes({ fetch }), ...createNemsisNodes(null)],
      announce: async () => undefined
    });

    const healthRes = await app.request('/health');
    assert.equal(healthRes.status, 200);
    assert.deepEqual(await healthRes.json(), { status: 'ok' });

    for (const path of [
      '/api/auth/me',
      '/api/graphs',
      '/api/runs',
      '/api/tasks/queues',
      '/api/imports'
    ]) {
      assert.equal((await app.request(path)).status, 401, path);
    }

    const hook = await app.request('/api/imports/sftp/upload', {
      method: 'POST',
      headers: { authorization: `Bearer ${'x'.repeat(32)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'download', username: 'acme', virtual_path: '/a', status: 1 })
    });
    assert.deepEqual(await hook.json(), { ignored: true });
  });
});
