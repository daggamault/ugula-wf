import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createToken, hashToken } from './tokens.ts';

describe('tokens', () => {
  it('creates unguessable tokens and stores only their hash', () => {
    const a = createToken();
    const b = createToken();
    assert.notEqual(a.token, b.token);
    assert.match(a.token, /^[\w-]{43}$/);
    assert.equal(a.hash, hashToken(a.token));
    assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.notEqual(a.hash, a.token);
  });
});
