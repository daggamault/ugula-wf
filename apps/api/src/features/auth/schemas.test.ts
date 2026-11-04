import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { acceptInvitationSchema, setPasswordSchema, signInSchema, tokenQuery } from './schemas.ts';

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

describe('token schemas', () => {
  it('requires a bounded token and a 12 character password to set one', () => {
    assert.equal(
      v.safeParse(setPasswordSchema, { token: 't', password: 'x'.repeat(12) }).success,
      true
    );
    assert.equal(
      v.safeParse(setPasswordSchema, { token: 't', password: 'x'.repeat(11) }).success,
      false
    );
    assert.equal(
      v.safeParse(setPasswordSchema, { token: '', password: 'x'.repeat(12) }).success,
      false
    );
    assert.equal(v.safeParse(tokenQuery, { token: 'x'.repeat(201) }).success, false);
    assert.equal(
      v.safeParse(acceptInvitationSchema, { token: 't', password: 'short' }).success,
      true
    );
    assert.equal(v.safeParse(acceptInvitationSchema, { token: 't', password: '' }).success, false);
  });
});
