import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claimCodeRefs, describeCode, formatIcd10, isCodeSet } from './code-sets.ts';

describe('code sets', () => {
  it('knows its code sets', () => {
    assert.ok(isCodeSet('icd10cm'));
    assert.ok(!isCodeSet('snomed'));
  });

  it('dots ICD-10 codes after the category', () => {
    assert.equal(formatIcd10('I214'), 'I21.4');
    assert.equal(formatIcd10('R51'), 'R51');
    assert.equal(formatIcd10('I21.4'), 'I21.4');
  });

  it('describes a code from the lookup, else an origin and destination pair', () => {
    const d = { hcpcs: { A0427: 'ALS1 emergency' }, modifier: { QL: 'Patient pronounced dead' } };
    assert.equal(describeCode(d, 'hcpcs', 'A0427'), 'ALS1 emergency');
    assert.equal(describeCode(d, 'modifier', 'QL'), 'Patient pronounced dead');
    assert.equal(describeCode(d, 'modifier', 'RH'), 'Residence to hospital');
    assert.equal(describeCode(d, 'modifier', 'ZZ'), null);
    assert.equal(describeCode(d, 'icd10cm', 'I214'), null);
  });

  it('lists the codes a claim bills', () => {
    assert.deepEqual(claimCodeRefs({ lines: [{ code: 'A0427' }], diagnoses: ['I214'] }), [
      { set: 'hcpcs', code: 'A0427' },
      { set: 'icd10cm', code: 'I214' }
    ]);
  });
});
