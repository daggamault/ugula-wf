import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elementLabel } from './elements.ts';

describe('elementLabel', () => {
  it('names the NEMSIS elements billers read', () => {
    assert.deepEqual(
      ['ePatient.17', 'eScene.13', 'eDisposition.32', 'eDisposition.11', 'ePayment.04'].map(
        elementLabel
      ),
      [
        'Date of birth',
        'Incident facility or location name',
        'Level of care provided',
        'Patients transported in this unit',
        'Reason for physician certification statement'
      ]
    );
  });

  it('names the NEMSIS sections', () => {
    assert.deepEqual(['eArrest', 'ePayment', 'eOutcome'].map(elementLabel), [
      'Cardiac Arrest',
      'Payment',
      'Outcome'
    ]);
  });

  it('gives null for an unlisted element rather than its section name', () => {
    assert.equal(elementLabel('ePatient.99'), null);
    assert.equal(elementLabel('eCustom.99'), null);
  });

  it('gives null for unknown names, including inherited object keys', () => {
    for (const name of ['', 'eCustom', 'toString', '__proto__', 'constructor', 'epatient.17']) {
      assert.equal(elementLabel(name), null, name);
    }
  });
});
