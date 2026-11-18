import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hostKeyFingerprint } from './host-key.ts';

describe('hostKeyFingerprint', () => {
  it('formats the SHA-256 of a key as OpenSSH does, without padding', () => {
    assert.equal(
      hostKeyFingerprint(Buffer.from('abc')),
      'SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0'
    );
  });
});
