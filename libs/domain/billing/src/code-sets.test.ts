import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CODE_PATTERN,
  CODE_SET_NAMES,
  CODE_SETS,
  claimCodeRefs,
  describeCode,
  formatIcd10,
  isCodeSet,
  normalizeCode
} from './code-sets.ts';

describe('code sets', () => {
  it('knows its code sets', () => {
    assert.ok(isCodeSet('icd10cm'));
    assert.ok(isCodeSet('snomed'));
    assert.ok(!isCodeSet('cpt'));
    assert.deepEqual(Object.keys(CODE_SET_NAMES), [...CODE_SETS]);
  });

  it('normalizes a typed code to how its set stores it', () => {
    assert.equal(normalizeCode('icd10cm', ' r07.9 '), 'R079');
    assert.equal(normalizeCode('hcpcs', 'a0427'), 'A0427');
    assert.equal(normalizeCode('snomed', '232674004'), '232674004');
    assert.match(normalizeCode('snomed', '1234567890123456'), new RegExp(CODE_PATTERN));
    assert.doesNotMatch('R07.9', new RegExp(CODE_PATTERN));
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
