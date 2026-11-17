import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTransient } from './errors.ts';

const coded = (code: string, message = 'boom') => Object.assign(new Error(message), { code });
const named = (name: string) => Object.assign(new Error('boom'), { name });

describe('isTransient', () => {
  it('retries connection, contention, capacity, shutdown and system SQL error classes', () => {
    for (const code of ['08006', '40P01', '40001', '53300', '57P01', '58030']) {
      assert.equal(isTransient(coded(code)), true, code);
    }
  });

  it('treats data, constraint and schema SQL errors as permanent, whatever the message says', () => {
    for (const code of ['22P02', '23505', '42P01', 'XX000']) {
      assert.equal(isTransient(coded(code, 'connection terminated')), false, code);
    }
  });

  it('retries network errors by code', () => {
    for (const code of [
      'ECONNRESET',
      'ECONNREFUSED',
      'ECONNABORTED',
      'ETIMEDOUT',
      'EPIPE',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT'
    ]) {
      assert.equal(isTransient(coded(code)), true, code);
    }
  });

  it('retries aborts, timeouts and exhausted Redis retries by error name', () => {
    for (const name of ['AbortError', 'TimeoutError', 'MaxRetriesPerRequestError']) {
      assert.equal(isTransient(named(name)), true, name);
    }
  });

  it('retries dropped connections, timeouts, fetch failures and 5xx or 429 answers by message', () => {
    for (const message of [
      'Connection terminated unexpectedly',
      'connection ended',
      'Connection is closed.',
      'Query read timeout',
      'The request timed out',
      'fetch failed',
      'http://llm/v1 answered 503: busy',
      'http://llm/v1 answered 429: slow down'
    ]) {
      assert.equal(isTransient(new Error(message)), true, message);
    }
  });

  it('treats other HTTP answers and program errors as permanent', () => {
    for (const err of [
      new Error('http://llm/v1 answered 400: bad prompt'),
      new Error('http://llm/v1 answered 4290: odd'),
      new TypeError('x is not a function'),
      coded('ERR_INVALID_ARG_TYPE')
    ]) {
      assert.equal(isTransient(err), false, err.message);
    }
  });

  it('follows causes to a transient error', () => {
    assert.equal(isTransient(new TypeError('fetch', { cause: coded('UND_ERR_SOCKET') })), true);
    assert.equal(
      isTransient(new Error('outer', { cause: new Error('inner', { cause: coded('EPIPE') }) })),
      true
    );
  });

  it('treats a permanent or non-error cause under a permanent error as permanent', () => {
    assert.equal(isTransient(new Error('wrapped', { cause: coded('23505') })), false);
    assert.equal(isTransient(new Error('wrapped', { cause: 'ECONNRESET' })), false);
  });

  it('treats non-errors as permanent', () => {
    for (const value of ['ECONNRESET', null, undefined, { code: 'ECONNRESET' }]) {
      assert.equal(isTransient(value), false, String(value));
    }
  });
});
