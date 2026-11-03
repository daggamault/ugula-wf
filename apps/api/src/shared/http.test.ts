import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import * as v from 'valibot';
import {
  describeIssue,
  idParam,
  invalidRequest,
  isForeignKeyViolation,
  isUniqueViolation
} from './http.ts';

describe('http helpers', () => {
  it('validates ids', () => {
    assert.equal(
      v.safeParse(idParam, { id: '01a16617-7704-7ba6-b9b5-9c79fa44f965' }).success,
      true
    );
    assert.equal(v.safeParse(idParam, { id: 'nope' }).success, false);
  });

  it('recognizes unique violations', () => {
    assert.equal(isUniqueViolation({ code: '23505' }), true);
    assert.equal(isForeignKeyViolation({ code: '23001' }), true);
    assert.equal(isForeignKeyViolation({ code: '23503' }), true);
    assert.equal(isForeignKeyViolation({ code: '23505' }), false);
    assert.equal(isUniqueViolation(new Error('x')), false);
  });

  it('answers invalid requests with a readable first issue', async () => {
    const app = new Hono().post(
      '/',
      sValidator(
        'json',
        v.object({ npi: v.pipe(v.string(), v.length(10, 'An NPI has 10 digits')) }),
        invalidRequest
      ),
      (c) => c.json({ ok: true })
    );
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ npi: '1' })
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'npi: An NPI has 10 digits',
      issues: ['npi: An NPI has 10 digits']
    });
    assert.equal(describeIssue({ message: 'Bad' }), 'Bad');
    assert.equal(describeIssue({ message: 'Bad', path: [{ key: 'a' }, 0] }), 'a.0: Bad');
  });
});
