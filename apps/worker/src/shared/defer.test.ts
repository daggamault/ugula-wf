import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deferralOf } from './defer.ts';

describe('deferralOf', () => {
  it('reads the delay of busy-limiter errors, through causes', () => {
    const busy = Object.assign(new Error('Every shared slot is busy'), {
      code: 'LIMIT_BUSY',
      retryAfterMs: 1_500
    });
    assert.equal(deferralOf(busy), 1_500);
    assert.equal(deferralOf(new Error('wrapped', { cause: busy })), 1_500);
    assert.equal(deferralOf(new Error('boom')), null);
    assert.equal(deferralOf('nope'), null);
  });
});
