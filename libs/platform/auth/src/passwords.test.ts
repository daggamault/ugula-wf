import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from './passwords.ts';

const key = (n: number) => scryptSync('pw', 'abcd', 64, { N: n }).toString('hex');

describe('passwords', () => {
  it('hashes with its scrypt cost stored and verifies a valid password', async () => {
    const hash = await hashPassword('P@ssw0rd123');
    assert.match(hash, /^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(await verifyPassword('P@ssw0rd123', hash), true);
    assert.equal(await verifyPassword('wrong-password', hash), false);
    assert.notEqual(await hashPassword('P@ssw0rd123'), hash);
  });

  it('verifies hashes using the cost stored in them, including the legacy format', async () => {
    assert.equal(await verifyPassword('pw', `abcd:${key(2 ** 14)}`), true);
    assert.equal(await verifyPassword('other', `abcd:${key(2 ** 14)}`), false);
    assert.equal(await verifyPassword('pw', `scrypt$1024$8$1$abcd$${key(1024)}`), true);
    assert.equal(await verifyPassword('pw', `scrypt$2048$8$1$abcd$${key(1024)}`), false);
  });

  it('rejects malformed hashes safely', async () => {
    const k = key(1024);
    for (const hash of [
      'invalid',
      'abcd:',
      `abcd:${k}:x`,
      'abcd:short',
      `scrypt$1000$8$1$abcd$${k}`,
      `scrypt$1$8$1$abcd$${k}`,
      `scrypt$2097152$8$1$abcd$${k}`,
      `scrypt$1024$0$1$abcd$${k}`,
      `scrypt$1024$17$1$abcd$${k}`,
      `scrypt$1024$8$1.5$abcd$${k}`,
      `scrypt$1024$8$1$$${k}`,
      `scrypt$1024$8$1$abcd$${k}$x`,
      'scrypt$1024$8$1$abcd$00',
      'scrypt$1024$8$1$abcd'
    ]) {
      assert.equal(await verifyPassword('pw', hash), false, hash);
    }
  });
});
