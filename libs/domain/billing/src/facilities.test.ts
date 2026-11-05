import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FACILITY_KINDS, isFacilityKind, isResponsibleParty } from './facilities.ts';

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
});
