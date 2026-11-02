import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingModels, CLAIM, X837_CLAIM } from './models.ts';

describe('billingModels', () => {
  it('declares unique, labelled models for claims and 837P claims', () => {
    assert.equal(new Set(billingModels.map((m) => m.key)).size, billingModels.length);
    assert.ok(
      billingModels.every((m) => m.fields.every((f) => f.label && /^[a-z]\w*$/i.test(f.name)))
    );
    assert.deepEqual(
      Object.keys((CLAIM.type as { object: object }).object),
      CLAIM.fields.map((f) => f.name)
    );
    assert.equal(X837_CLAIM.category, 'X12 837P');
    assert.ok(!('type' in (billingModels[0] ?? {})));
  });
});
