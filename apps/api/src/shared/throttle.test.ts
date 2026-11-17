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
  const [email, ip] = ['dev@example.com', '1.2.3.4'];

  it('locks an email and address pair after repeated failures until a success', async () => {
    const { redis, keys } = memoryRedis();
    const throttle = createSignInThrottle(redis);
    for (let i = 0; i < 4; i++) {
      assert.equal(await throttle.begin(email, ip), 0);
      await throttle.failed(email, ip);
    }
    assert.equal(await throttle.begin(email, ip), 0);
    await throttle.failed(email, ip);
    assert.equal(await throttle.begin(email, ip), 30);
    assert.equal(await throttle.begin(email, '5.6.7.8'), 0);
    assert.equal(await throttle.begin('other@example.com', ip), 0);
    assert.ok(keys().every((k) => !k.includes(email)));
    await throttle.succeeded(email, ip);
    assert.equal(await throttle.begin(email, ip), 0);
    for (const [e, i] of [
      [email, ip],
      [email, '5.6.7.8'],
      ['other@example.com', ip]
    ] as const) {
      await throttle.succeeded(e, i);
    }
    assert.deepEqual(keys(), []);
  });

  it('lets one attempt at a time through, so parallel guesses cannot skip the lock', async () => {
    const { redis } = memoryRedis();
    const throttle = createSignInThrottle(redis);
    const waits = await Promise.all(Array.from({ length: 10 }, () => throttle.begin(email, ip)));
    assert.deepEqual(waits.toSorted(), [0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    await throttle.failed(email, ip);
    assert.equal(await throttle.begin(email, ip), 0);
  });
});
