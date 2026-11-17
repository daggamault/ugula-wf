import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_FIX_FIELDS,
  CLASSIFICATION_FIELD,
  DOCUMENTATION_FIX_FIELDS,
  FIELDS_OF,
  LOADED_MILES_FIELD,
  option
} from './claim-fix-fields.ts';

describe('claim fix fields', () => {
  it('names every field a claim issue is fixed in after a field the fix form asks', () => {
    const asked = new Set(CLAIM_FIX_FIELDS.map((f) => f.name));
    const unasked = Object.entries(FIELDS_OF).flatMap(([field, names]) =>
      names.filter((n) => !asked.has(n)).map((n) => `${field}: ${n}`)
    );
    assert.deepEqual(unasked, []);
    assert.deepEqual(FIELDS_OF.patientAddress, [
      'patientAddressLine',
      'patientCity',
      'patientState',
      'patientPostalCode'
    ]);
  });

  it('labels every field and offers choices as value and label', () => {
    assert.deepEqual(
      CLAIM_FIX_FIELDS.filter((f) => !f.label).map((f) => f.name),
      []
    );
    assert.deepEqual(
      DOCUMENTATION_FIX_FIELDS.filter((f) => !CLAIM_FIX_FIELDS.includes(f)).map((f) => f.name),
      []
    );
    assert.equal(CLAIM_FIX_FIELDS.find((f) => f.name === 'pickupCity')?.label, 'Pickup city');
    assert.deepEqual([LOADED_MILES_FIELD.min, LOADED_MILES_FIELD.max], [0, 500]);
    assert.deepEqual(option('RH', 'Residence to hospital'), {
      value: 'RH',
      label: 'Residence to hospital'
    });
  });

  it('never offers not billable as a classification a biller picks', () => {
    assert.deepEqual(
      CLASSIFICATION_FIELD.options?.map((o) => o.value),
      ['emergency', 'scheduled', 'treatNoTransport', 'refusal']
    );
  });
});
