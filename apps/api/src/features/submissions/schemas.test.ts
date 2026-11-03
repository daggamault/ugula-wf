import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { claimSchema } from './schemas.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('submission schemas', () => {
  it('needs the one claim an eligibility request is for', () => {
    assert.deepEqual(v.parse(claimSchema, { claimId: ID }), { claimId: ID });
    assert.throws(() => v.parse(claimSchema, {}));
    assert.throws(() => v.parse(claimSchema, { claimId: 'nope' }));
  });
});
