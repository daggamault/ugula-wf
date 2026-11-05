import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLongEnoughPassword, MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT } from './passwords.ts';

describe('passwords', () => {
  it('asks for at least twelve characters and says so', () => {
    assert.equal(MIN_PASSWORD_LENGTH, 12);
    assert.equal(PASSWORD_TOO_SHORT, 'Use at least 12 characters');
    assert.equal(isLongEnoughPassword('x'.repeat(11)), false);
    assert.equal(isLongEnoughPassword('x'.repeat(12)), true);
  });
});
