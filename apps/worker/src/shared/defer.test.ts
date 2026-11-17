import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deferralOf } from './defer.ts';

const busy = (retryAfterMs: number) =>
  Object.assign(new Error('Every shared slot is busy'), { code: 'LIMIT_BUSY', retryAfterMs });

describe('deferralOf', () => {
  it('reads the delay of a busy-limiter error', () => {
    assert.equal(deferralOf(busy(1_500)), 1_500);
  });

  it('reads the delay through nested causes', () => {
    const wrapped = new Error('outer', { cause: new Error('inner', { cause: busy(250) }) });
    assert.equal(deferralOf(wrapped), 250);
  });

  it('prefers the outermost busy error', () => {
    assert.equal(deferralOf(Object.assign(busy(100), { cause: busy(900) })), 100);
  });

  it('gives null for other errors and non-errors', () => {
    assert.equal(deferralOf(new Error('boom', { cause: new Error('cause') })), null);
    assert.equal(deferralOf(Object.assign(new Error('busy'), { code: 'LIMIT_BUSY' })), null);
    assert.equal(deferralOf('nope'), null);
    assert.equal(deferralOf(undefined), null);
  });
});
