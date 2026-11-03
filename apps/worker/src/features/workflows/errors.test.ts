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
    assert.equal(isTransient(coded('EPIPE')), true);
  });

  it('retries network, upstream and Redis failures raised inside nodes', () => {
    const cause = coded('UND_ERR_SOCKET');
    assert.equal(isTransient(new TypeError('fetch failed', { cause })), true);
    assert.equal(isTransient(new Error('wrapped', { cause: coded('ECONNREFUSED') })), true);
    assert.equal(isTransient(new Error('http://llm/v1 answered 503: busy')), true);
    assert.equal(isTransient(new Error('http://llm/v1 answered 429: slow down')), true);
    assert.equal(isTransient(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), true);
    assert.equal(isTransient(new Error('Connection is closed.')), true);
    assert.equal(isTransient(new Error('http://llm/v1 answered 400: bad prompt')), false);
  });

  it('treats data, constraint and program errors as permanent', () => {
    assert.equal(isTransient(coded('22P02', 'invalid input syntax for type uuid')), false);
    assert.equal(isTransient(coded('23505')), false);
    assert.equal(isTransient(new TypeError('x is not a function')), false);
    assert.equal(isTransient('nope'), false);
  });
});
