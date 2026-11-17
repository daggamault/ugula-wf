import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from './passwords.ts';

const key = (n: number, password = 'pw', salt = 'abcd') =>
  scryptSync(password, salt, 64, { N: n }).toString('hex');

describe('hashPassword', () => {
  it('stores the scrypt cost, a 16-byte salt and a 64-byte key', async () => {
    const hash = await hashPassword('P@ssw0rd123');
    assert.match(hash, /^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    const [, , , , salt, stored] = hash.split('$');
    assert.equal(
      stored,
      scryptSync('P@ssw0rd123', salt ?? '', 64, {
        N: 2 ** 17,
        r: 8,
        p: 1,
        maxmem: 256 * 2 ** 17 * 8
      }).toString('hex')
    );
  });

  it('salts every hash differently', async () => {
    assert.notEqual(await hashPassword('P@ssw0rd123'), await hashPassword('P@ssw0rd123'));
  });
});

describe('verifyPassword', () => {
  it('accepts the password a fresh hash was made from and nothing else', async () => {
    const hash = await hashPassword('P@ssw0rd123');
    assert.equal(await verifyPassword('P@ssw0rd123', hash), true);
    assert.equal(await verifyPassword('wrong-password', hash), false);
  });

  it('verifies with the cost stored in the hash', async () => {
    assert.equal(await verifyPassword('pw', `scrypt$1024$8$1$abcd$${key(1024)}`), true);
    assert.equal(await verifyPassword('pw', `scrypt$2048$8$1$abcd$${key(1024)}`), false);
  });

  it('verifies legacy salt:key hashes at the old cost', async () => {
    assert.equal(await verifyPassword('pw', `abcd:${key(2 ** 14)}`), true);
    assert.equal(await verifyPassword('other', `abcd:${key(2 ** 14)}`), false);
    assert.equal(await verifyPassword('pw', `abcd:${key(1024)}`), false);
  });

  it('rejects malformed legacy hashes', async () => {
    const k = key(2 ** 14);
    for (const hash of ['invalid', 'abcd:', `:${k}`, `abcd:${k}:x`, 'abcd:short']) {
      assert.equal(await verifyPassword('pw', hash), false, hash);
    }
  });

  it('rejects costs that are not powers of two in 2..2^20 or r and p outside 1..16', async () => {
    const k = key(1024);
    for (const hash of [
      `scrypt$1000$8$1$abcd$${k}`,
      `scrypt$1$8$1$abcd$${k}`,
      `scrypt$2097152$8$1$abcd$${k}`,
      `scrypt$x$8$1$abcd$${k}`,
      `scrypt$1024$0$1$abcd$${k}`,
      `scrypt$1024$17$1$abcd$${k}`,
      `scrypt$1024$8$0$abcd$${k}`,
      `scrypt$1024$8$1.5$abcd$${k}`
    ]) {
      assert.equal(await verifyPassword('pw', hash), false, hash);
    }
  });

  it('rejects hashes with a missing salt, a short key or extra parts', async () => {
    const k = key(1024);
    for (const hash of [
      `scrypt$1024$8$1$$${k}`,
      `scrypt$1024$8$1$abcd$${k}$x`,
      'scrypt$1024$8$1$abcd$00',
      'scrypt$1024$8$1$abcd'
    ]) {
      assert.equal(await verifyPassword('pw', hash), false, hash);
    }
  });
});
