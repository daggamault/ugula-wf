import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, messageOf } from './errors.ts';

describe('errors', () => {
  it('throws an Error with the message given', () => {
    assert.throws(() => fail('boom'), { name: 'Error', message: 'boom' });
  });

  it('describes anything thrown as text', () => {
    assert.equal(messageOf(new TypeError('x')), 'x');
    assert.equal(messageOf('plain'), 'plain');
    assert.equal(messageOf(42), '42');
    assert.equal(messageOf(null), 'null');
  });
});
