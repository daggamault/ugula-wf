import assert from 'node:assert/strict';
import { createPrivateKey } from 'node:crypto';
import { describe, it } from 'node:test';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { hostKeyFingerprint } from '@ugula/clearinghouse';
import ssh2 from 'ssh2';
import { stableHostKey } from './host-key.ts';

describe('stableHostKey', () => {
  it('returns a SEC1 PEM for a P-256 EC private key', () => {
    const pem = stableHostKey();
    assert.match(pem, /^-----BEGIN EC PRIVATE KEY-----\n[\s\S]+\n-----END EC PRIVATE KEY-----\n$/);
    const key = createPrivateKey(pem);
    assert.deepEqual(
      [key.asymmetricKeyType, key.asymmetricKeyDetails],
      ['ec', { namedCurve: 'prime256v1' }]
    );
  });

  it('derives the same key on every call', () => {
    assert.equal(stableHostKey(), stableHostKey());
  });

  it('serves a key whose SSH fingerprint is MOCK_HOST_KEY', () => {
    const parsed = ssh2.utils.parseKey(stableHostKey());
    assert.ok(!(parsed instanceof Error));
    assert.equal(hostKeyFingerprint(parsed.getPublicSSH()), MOCK_HOST_KEY);
  });
});
