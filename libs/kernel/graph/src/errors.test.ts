import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, messageOf } from './errors.ts';

describe('errors', () => {
  it('throws and describes failures', () => {
    assert.throws(() => fail('boom'), /boom/);
    assert.equal(messageOf(new Error('x')), 'x');
    assert.equal(messageOf('plain'), 'plain');
  });
});
