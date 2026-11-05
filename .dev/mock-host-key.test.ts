import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stableHostKey } from './mock-host-key.ts';

describe('stableHostKey', () => {
  it('derives the same EC key every time, pinned by MOCK_HOST_KEY', () => {
    const pem = stableHostKey();
    assert.match(pem, /^-----BEGIN EC PRIVATE KEY-----/);
    assert.equal(stableHostKey(), pem);
  });
});
