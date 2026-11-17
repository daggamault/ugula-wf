import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingModels, CLAIM, CLAIM_TYPE } from './models.ts';

describe('billingModels', () => {
  it('declares unique, labelled models for claims', () => {
    assert.equal(new Set(billingModels.map((m) => m.key)).size, billingModels.length);
    assert.deepEqual(
      billingModels.flatMap((m) =>
        m.fields.filter((f) => !f.label || !/^[a-z]\w*$/i.test(f.name)).map((f) => f.name)
      ),
      []
    );
    assert.deepEqual(
      Object.keys((CLAIM_TYPE as { object: object }).object),
      CLAIM.fields.map((f) => f.name)
    );
  });
});
