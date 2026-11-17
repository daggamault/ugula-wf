import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADDRESS, f, model, X12 } from './model-kit.ts';

describe('model kit', () => {
  it('builds a billing model with its value type, in the billing category by default', () => {
    assert.deepEqual(
      model('billing.place', 'place', 'Place', 'a place', [f('name', 'string', 'Name')]),
      {
        key: 'billing.place',
        name: 'place',
        title: 'Place',
        category: 'Billing',
        description: 'a place',
        fields: [{ name: 'name', type: 'string', label: 'Name' }],
        type: { object: { name: 'string' } }
      }
    );
    const address = model('x.y', 'y', 'Y', 'y', ADDRESS, X12);
    assert.deepEqual(
      [address.category, address.type],
      [
        'X12 837P',
        { object: { addressLine: 'string', city: 'string', state: 'string', postalCode: 'string' } }
      ]
    );
  });
});
