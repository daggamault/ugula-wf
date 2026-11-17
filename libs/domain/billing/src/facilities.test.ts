import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Hospital, isFacilityKind, isResponsibleParty, pickHospital } from './facilities.ts';

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
    assert.deepEqual(
      ['hospital', 'snf', 'dialysis', 'other', 'clinic', 'toString', 1].map(isFacilityKind),
      [true, true, true, true, false, false, false]
    );
    assert.deepEqual(['payer', 'facility', 'patient', null].map(isResponsibleParty), [
      true,
      true,
      false,
      false
    ]);
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

  it('counts a hospital as tied when its name scores within a tenth of the best', () => {
    const near = [hospital('1', '36301', 0.79), hospital('2', '36360', 0.7)];
    assert.equal(pickHospital(near, null), null);
    assert.equal(pickHospital(near, '36301')?.ccn, '1');
    const far = [hospital('1', '36301', 0.81), hospital('2', '36360', 0.7)];
    assert.equal(pickHospital(far, '36360')?.ccn, '1');
  });

  it('picks the one tied hospital in the ZIP code, ignoring a closer name outside the tie', () => {
    const three = [
      hospital('1', '36301', 0.9),
      hospital('2', '36360', 0.85),
      hospital('3', '36360', 0.5)
    ];
    assert.equal(pickHospital(three, '36360')?.ccn, '2');
  });
});
