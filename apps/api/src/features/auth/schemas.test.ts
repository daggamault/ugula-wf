import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { acceptInvitationSchema, setPasswordSchema, signInSchema, tokenSchema } from './schemas.ts';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

const EMAIL = 'dev@example.com';

describe('signInSchema', () => {
  it('trims and lowercases the email and keeps the password as typed', () => {
    assert.deepEqual(v.parse(signInSchema, { email: '  Dev@Example.com ', password: ' P@ss ' }), {
      email: EMAIL,
      password: ' P@ss '
    });
  });

  it('refuses an invalid email', () => {
    assert.deepEqual(issues(signInSchema, { email: 'invalid', password: 'x' }), [
      'Invalid email: Received "invalid"'
    ]);
  });

  it('refuses a missing, empty or overlong password', () => {
    assert.deepEqual(issues(signInSchema, { email: EMAIL }), [
      'Invalid key: Expected "password" but received undefined'
    ]);
    assert.deepEqual(issues(signInSchema, { email: EMAIL, password: '' }), [
      'Invalid length: Expected !0 but received 0'
    ]);
    assert.deepEqual(issues(signInSchema, { email: EMAIL, password: 'x'.repeat(1025) }), [
      'Invalid length: Expected <=1024 but received 1025'
    ]);
  });
});

describe('token schemas', () => {
  it('sets a password of at least 12 and at most 1024 characters', () => {
    assert.deepEqual(v.parse(setPasswordSchema, { token: 't', password: 'x'.repeat(12) }), {
      token: 't',
      password: 'x'.repeat(12)
    });
    assert.deepEqual(issues(setPasswordSchema, { token: 't', password: 'x'.repeat(11) }), [
      'Use at least 12 characters'
    ]);
    assert.deepEqual(issues(setPasswordSchema, { token: 't', password: 'x'.repeat(1025) }), [
      'Invalid length: Expected <=1024 but received 1025'
    ]);
  });

  it('requires a token of at most 200 characters', () => {
    assert.deepEqual(issues(setPasswordSchema, { token: '', password: 'x'.repeat(12) }), [
      'Invalid length: Expected !0 but received 0'
    ]);
    assert.deepEqual(issues(tokenSchema, {}), [
      'Invalid key: Expected "token" but received undefined'
    ]);
    assert.deepEqual(issues(tokenSchema, { token: 'x'.repeat(201) }), [
      'Invalid length: Expected <=200 but received 201'
    ]);
    assert.deepEqual(v.parse(tokenSchema, { token: 'x'.repeat(200) }), { token: 'x'.repeat(200) });
  });

  it('accepts an invitation with any non-empty password', () => {
    assert.deepEqual(v.parse(acceptInvitationSchema, { token: 't', password: 'short' }), {
      token: 't',
      password: 'short'
    });
    assert.deepEqual(issues(acceptInvitationSchema, { token: 't', password: '' }), [
      'Invalid length: Expected !0 but received 0'
    ]);
  });
});
