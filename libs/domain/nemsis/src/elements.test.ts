import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elementLabel } from './elements.ts';

describe('elementLabel', () => {
  it('names the NEMSIS sections and elements billers read', () => {
    assert.equal(elementLabel('ePatient.17'), 'Date of birth');
    assert.equal(elementLabel('eDisposition.32'), 'Level of care provided');
    assert.equal(elementLabel('eDisposition.11'), 'Patients transported in this unit');
    assert.equal(elementLabel('eArrest'), 'Cardiac Arrest');
    assert.equal(elementLabel('ePayment'), 'Payment');
    assert.equal(elementLabel('eCustom.99'), null);
    assert.equal(elementLabel('toString'), null);
  });
});
