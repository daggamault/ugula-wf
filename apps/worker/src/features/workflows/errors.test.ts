import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTransient } from './errors.ts';

const coded = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

describe('isTransient', () => {
  it('retries connection, contention and capacity failures', () => {
    assert.equal(isTransient(coded('40P01')), true);
    assert.equal(isTransient(coded('40001')), true);
    assert.equal(isTransient(coded('08006')), true);
    assert.equal(isTransient(coded('53300')), true);
    assert.equal(isTransient(coded('ECONNRESET')), true);
    assert.equal(isTransient(new Error('Connection terminated unexpectedly')), true);
  });

  it('treats data, constraint and program errors as permanent', () => {
    assert.equal(isTransient(coded('22P02', 'invalid input syntax for type uuid')), false);
    assert.equal(isTransient(coded('23505')), false);
    assert.equal(isTransient(new TypeError('x is not a function')), false);
    assert.equal(isTransient('nope'), false);
  });
});
