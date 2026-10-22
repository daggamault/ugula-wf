import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHealthRoutes } from './routes.ts';

describe('health routes', () => {
  it('returns status ok on GET /', async () => {
    const routes = createHealthRoutes();
    const res = await routes.request('/');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});
