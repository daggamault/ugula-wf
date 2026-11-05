import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { credentialsMatch, isBasicAuthorized } from './mock-auth.ts';

const expected = { username: 'ugula', password: 'pa:ss' };

const basic = (text: string) => `Basic ${Buffer.from(text).toString('base64')}`;

describe('credentialsMatch', () => {
  it('accepts only the exact username and password', () => {
    assert.equal(credentialsMatch(expected, { username: 'ugula', password: 'pa:ss' }), true);
    assert.equal(credentialsMatch(expected, { username: 'ugula', password: 'pa:s' }), false);
    assert.equal(credentialsMatch(expected, { username: 'other', password: 'pa:ss' }), false);
  });
});

describe('isBasicAuthorized', () => {
  it('reads Basic credentials whose password may hold colons', () => {
    assert.equal(isBasicAuthorized(expected, basic('ugula:pa:ss')), true);
    assert.equal(isBasicAuthorized(expected, basic('ugula:wrong')), false);
  });

  it('refuses a missing or non-Basic header', () => {
    assert.equal(isBasicAuthorized(expected, null), false);
    assert.equal(isBasicAuthorized(expected, 'Basic'), false);
    assert.equal(
      isBasicAuthorized(expected, basic('ugula:pa:ss').replace('Basic', 'Bearer')),
      false
    );
  });
});
