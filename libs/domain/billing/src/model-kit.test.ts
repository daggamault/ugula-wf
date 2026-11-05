import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADDRESS, f, model, X12 } from './model-kit.ts';

describe('model kit', () => {
  it('builds a billing model with its value type, in the billing category by default', () => {
    const m = model('billing.place', 'place', 'Place', 'a place', [f('name', 'string', 'Name')]);
    assert.deepEqual([m.key, m.category, m.fields.length], ['billing.place', 'Billing', 1]);
    assert.deepEqual(m.type, { object: { name: 'string' } });
    assert.equal(model('x.y', 'y', 'Y', 'y', ADDRESS, X12).category, 'X12 837P');
    assert.deepEqual(
      ADDRESS.map((a) => a.name),
      ['addressLine', 'city', 'state', 'postalCode']
    );
  });
});
