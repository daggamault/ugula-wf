import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { type Failure, fail, ok, type Result, respond } from './result.ts';

const reply = async (result: Result<unknown>, status?: 201) => {
  const res = await new Hono().get('/', (c) => respond(c, result, status)).request('/');
  return [res.status, await res.json()];
};

describe('respond', () => {
  it('sends a value as JSON with 200 by default', async () => {
    assert.deepEqual(await reply(ok({ id: 1 })), [200, { id: 1 }]);
  });

  it('sends a value with the status given', async () => {
    assert.deepEqual(await reply(ok({ id: 1 }), 201), [201, { id: 1 }]);
  });

  it('sends a failure message with the status of its code, ignoring the success status', async () => {
    const statuses: [Failure['code'], number][] = [
      ['invalid', 422],
      ['unauthorized', 401],
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
      ['rate_limited', 429]
    ];
    for (const [code, status] of statuses) {
      assert.deepEqual(await reply(fail(code, 'Nope'), 201), [status, { error: 'Nope' }], code);
    }
  });

  it('spreads failure details next to the message', async () => {
    assert.deepEqual(await reply(fail('invalid', 'Bad', { issues: ['x'] })), [
      422,
      { error: 'Bad', issues: ['x'] }
    ]);
  });
});
