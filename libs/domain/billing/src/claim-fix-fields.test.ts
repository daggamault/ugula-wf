import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_FIX_FIELDS,
  DOCUMENTATION_FIX_FIELDS,
  FIELDS_OF,
  LOADED_MILES_FIELD,
  option
} from './claim-fix-fields.ts';

describe('claim fix fields', () => {
  it('names every field a claim issue is fixed in after a field the fix form asks', () => {
    const asked = new Set(CLAIM_FIX_FIELDS.map((f) => f.name));
    for (const [field, names] of Object.entries(FIELDS_OF)) {
      for (const name of names) assert.ok(asked.has(name), `${field}: ${name}`);
    }
    assert.deepEqual(FIELDS_OF.patientAddress, [
      'patientAddressLine',
      'patientCity',
      'patientState',
      'patientPostalCode'
    ]);
  });

  it('labels every field and offers choices as value and label', () => {
    assert.ok(CLAIM_FIX_FIELDS.every((f) => f.label));
    assert.ok(DOCUMENTATION_FIX_FIELDS.every((f) => CLAIM_FIX_FIELDS.includes(f)));
    assert.equal(CLAIM_FIX_FIELDS.find((f) => f.name === 'pickupCity')?.label, 'Pickup city');
    assert.equal(LOADED_MILES_FIELD.type, 'number');
    assert.deepEqual(option('RH', 'Residence to hospital'), {
      value: 'RH',
      label: 'Residence to hospital'
    });
  });
});
