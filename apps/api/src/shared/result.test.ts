import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { fail, ok, respond } from './result.ts';

describe('result', () => {
  it('maps values and failures to HTTP responses', async () => {
    const app = new Hono()
      .get('/ok', (c) => respond(c, ok({ id: 1 }), 201))
      .get('/missing', (c) => respond(c, fail('not_found', 'Nope')))
      .get('/invalid', (c) => respond(c, fail('invalid', 'Bad', { issues: ['x'] })))
      .get('/busy', (c) => respond(c, fail('rate_limited', 'Slow down')));
    const created = await app.request('/ok');
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: 1 });
    const missing = await app.request('/missing');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Nope' });
    const invalid = await app.request('/invalid');
    assert.equal(invalid.status, 422);
    assert.deepEqual(await invalid.json(), { error: 'Bad', issues: ['x'] });
    assert.equal((await app.request('/busy')).status, 429);
  });
});
