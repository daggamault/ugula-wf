import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createToken, hashToken } from './tokens.ts';

describe('tokens', () => {
  it('hashes a token with SHA-256 as hex', () => {
    assert.equal(
      hashToken('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('creates unguessable tokens and stores only their hash', () => {
    const a = createToken();
    const b = createToken();
    assert.notEqual(a.token, b.token);
    assert.match(a.token, /^[\w-]{43}$/);
    assert.equal(a.hash, hashToken(a.token));
  });
});
