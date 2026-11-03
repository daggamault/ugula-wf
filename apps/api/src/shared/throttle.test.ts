import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { memoryRedis } from './testing.ts';
import { createSignInThrottle, lockSeconds } from './throttle.ts';

describe('lockSeconds', () => {
  it('allows a few failures, then backs off exponentially up to a cap', () => {
    assert.deepEqual([1, 4, 5, 6, 7, 20].map(lockSeconds), [0, 0, 30, 60, 120, 900]);
  });
});

describe('createSignInThrottle', () => {
  it('locks an email and address pair after repeated failures until a success', async () => {
    const { redis, keys } = memoryRedis();
    const throttle = createSignInThrottle(redis);
    for (let i = 0; i < 4; i++) await throttle.failed('dev@example.com', '1.2.3.4');
    assert.equal(await throttle.retryAfter('dev@example.com', '1.2.3.4'), 0);
    await throttle.failed('dev@example.com', '1.2.3.4');
    assert.equal(await throttle.retryAfter('dev@example.com', '1.2.3.4'), 30);
    assert.equal(await throttle.retryAfter('dev@example.com', '5.6.7.8'), 0);
    assert.equal(await throttle.retryAfter('other@example.com', '1.2.3.4'), 0);
    assert.ok(keys().every((k) => !k.includes('dev@example.com')));
    await throttle.succeeded('dev@example.com', '1.2.3.4');
    assert.equal(await throttle.retryAfter('dev@example.com', '1.2.3.4'), 0);
    assert.deepEqual(keys(), []);
  });
});
