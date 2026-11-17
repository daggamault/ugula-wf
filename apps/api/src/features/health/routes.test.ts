import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHealthRoutes } from './routes.ts';

describe('health routes', () => {
  it('reports ok as JSON on GET /', async () => {
    const res = await createHealthRoutes().request('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('answers nothing else', async () => {
    const routes = createHealthRoutes();
    assert.equal((await routes.request('/', { method: 'POST' })).status, 404);
    assert.equal((await routes.request('/deep')).status, 404);
  });
});
