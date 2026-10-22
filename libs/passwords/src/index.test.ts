import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from './index.ts';

describe('passwords', () => {
  it('hashes and verifies a valid password', async () => {
    const hash = await hashPassword('P@ssw0rd123');
    assert.equal(await verifyPassword('P@ssw0rd123', hash), true);
    assert.equal(await verifyPassword('wrong-password', hash), false);
  });

  it('rejects malformed hashes safely', async () => {
    assert.equal(await verifyPassword('P@ssw0rd123', 'invalid'), false);
    assert.equal(await verifyPassword('P@ssw0rd123', 'salt:short'), false);
  });
});
