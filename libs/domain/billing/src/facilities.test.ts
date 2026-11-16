import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FACILITY_KINDS,
  type Hospital,
  isFacilityKind,
  isResponsibleParty,
  pickHospital
} from './facilities.ts';

const hospital = (ccn: string, postalCode: string, similarity: number): Hospital => ({
  ccn,
  name: `HOSPITAL ${ccn}`,
  addressLine: '1 MAIN ST',
  city: 'DOTHAN',
  state: 'AL',
  postalCode,
  phone: null,
  hospitalType: 'Acute Care Hospitals',
  emergencyServices: true,
  similarity
});

describe('facilities', () => {
  it('names each kind of facility and who a claim is billed to', () => {
    assert.equal(FACILITY_KINDS.snf, 'Skilled nursing facility');
    assert.deepEqual(['hospital', 'snf', 'clinic', 1].map(isFacilityKind), [
      true,
      true,
      false,
      false
    ]);
    assert.deepEqual(['payer', 'facility', 'patient'].map(isResponsibleParty), [true, true, false]);
  });

  it('picks a hospital only when its name stands out, or the ZIP code singles it out', () => {
    const clear = [hospital('1', '36301', 1), hospital('2', '35653', 0.46)];
    assert.equal(pickHospital(clear, null)?.ccn, '1');
    const tied = [hospital('1', '35042', 0.75), hospital('2', '36360', 0.75)];
    assert.equal(pickHospital(tied, null), null);
    assert.equal(pickHospital(tied, '36360')?.ccn, '2');
    const sameZip = [hospital('1', '36360', 0.75), hospital('2', '36360', 0.7)];
    assert.equal(pickHospital(sameZip, '36360'), null);
    assert.equal(pickHospital([], '36360'), null);
  });
});
