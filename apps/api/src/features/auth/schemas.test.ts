import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { signInSchema } from './schemas.ts';

describe('signInSchema', () => {
  it('normalizes email and validates password', () => {
    const res = v.parse(signInSchema, {
      email: '  Dev@Example.com ',
      password: 'P@ssw0rd123'
    });
    assert.deepEqual(res, {
      email: 'dev@example.com',
      password: 'P@ssw0rd123'
    });
    assert.equal(v.safeParse(signInSchema, { email: 'invalid', password: 'x' }).success, false);
    assert.equal(
      v.safeParse(signInSchema, { email: 'dev@example.com', password: '' }).success,
      false
    );
    assert.equal(v.safeParse(signInSchema, { email: 'dev@example.com' }).success, false);
    assert.equal(
      v.safeParse(signInSchema, { email: 'dev@example.com', password: 'x'.repeat(1025) }).success,
      false
    );
  });
});
