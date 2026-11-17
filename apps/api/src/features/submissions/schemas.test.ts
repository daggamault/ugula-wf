import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { claimSchema } from './schemas.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const issues = (input: unknown) => v.safeParse(claimSchema, input).issues?.map((i) => i.message);

describe('submission schemas', () => {
  it('takes the one claim an eligibility request is for', () => {
    assert.deepEqual(v.parse(claimSchema, { claimId: ID }), { claimId: ID });
  });

  it('needs a claim id', () => {
    assert.deepEqual(issues({}), ['Invalid key: Expected "claimId" but received undefined']);
  });

  it('rejects a claim id that is not a UUID', () => {
    assert.deepEqual(issues({ claimId: 'nope' }), ['Invalid UUID: Received "nope"']);
  });
});
