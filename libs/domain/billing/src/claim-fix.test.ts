import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chargeChanges, readClaimPatch } from './claim-fix.ts';
import { completeCheck } from './testing.ts';

const check = completeCheck();

describe('readClaimPatch', () => {
  it('keeps what the biller left empty and merges partial addresses', () => {
    assert.ok(Object.values(readClaimPatch({}, check)).every((v) => v === null));
    const patch = readClaimPatch(
      {
        serviceDate: '2025-12-29',
        diagnoses: ['r07.9', 'bad'],
        destinationPostalCode: '62704',
        originCode: 'S',
        loadedMiles: 9.2,
        classification: 'notBillable',
        coverageId: 'cov-Blue',
        memberId: ' B2 ',
        relationship: '19'
      },
      check
    );
    assert.equal(patch.serviceDate, '2025-12-29');
    assert.deepEqual(patch.diagnoses, ['R079']);
    assert.deepEqual(patch.destination, { ...check.details.destination, postalCode: '62704' });
    assert.equal(patch.pickup, null);
    assert.equal(patch.originDestination, 'SH');
    assert.equal(patch.classification, null);
    assert.deepEqual(patch.coverage, {
      coverageId: 'cov-Blue',
      payerId: null,
      memberId: 'B2',
      relationship: '19',
      insuredFirstName: null,
      insuredLastName: null,
      remove: false
    });
    assert.ok(Object.values(chargeChanges(patch)).some(Boolean));
    assert.deepEqual(chargeChanges({ ...patch, loadedMiles: null, coverage: null }), {
      classification: false,
      level: false,
      emergency: false,
      loadedMiles: false,
      deceased: false,
      nonCoveredMiles: false,
      payers: false
    });
  });

  it('patches documentation a biller changed, and the QL and A0888 service, for repricing', () => {
    const patch = readClaimPatch(
      {
        deceased: true,
        nonCoveredMiles: 3.5,
        patientCount: 2,
        abnOnFile: true,
        abnSignedOn: '2025-12-30',
        mspAccident: 'workersComp',
        mspEsrd: false,
        pcsType: 'weekly',
        roundTrips: 4,
        signature: 'signed',
        priorAuthorization: ' UTN-9 ',
        facilityStay: 'snf'
      },
      check
    );
    assert.deepEqual([patch.deceased, patch.nonCoveredMiles], [true, 3.5]);
    assert.deepEqual(chargeChanges(patch), {
      classification: false,
      level: false,
      emergency: false,
      loadedMiles: false,
      deceased: true,
      nonCoveredMiles: true,
      payers: false
    });
    assert.equal(patch.documentation?.signature, undefined);
    assert.ok(!Object.hasOwn(patch.documentation ?? {}, 'pcsOnFile'));
    assert.deepEqual(
      [
        patch.documentation?.patientCount,
        patch.documentation?.abnOnFile,
        patch.documentation?.abnSignedOn,
        patch.documentation?.mspAccident,
        patch.documentation?.mspEsrd,
        patch.documentation?.pcsType,
        patch.documentation?.roundTrips,
        patch.documentation?.priorAuthorization,
        patch.documentation?.facilityStay
      ],
      [2, true, '2025-12-30', 'workersComp', false, undefined, 4, 'UTN-9', 'snf']
    );
    assert.equal(readClaimPatch({ deceased: false, nonCoveredMiles: 0 }, check).deceased, null);
    assert.equal(readClaimPatch({ nonCoveredMiles: 0 }, check).nonCoveredMiles, null);
  });

  it('ignores coverages that are not on the claim and invalid modifiers', () => {
    const patch = readClaimPatch({ coverageId: 'cov-Gone', memberId: 'X', originCode: 'X' }, check);
    assert.equal(patch.coverage, null);
    assert.equal(patch.originDestination, null);
    assert.equal(
      readClaimPatch({ coverageId: 'cov-Blue', removeCoverage: true }, check).coverage?.remove,
      true
    );
  });

  it('adds the payer a biller confirms for a claim without any', () => {
    const added = readClaimPatch(
      { payerId: 'p-Medicare', memberId: 'M9' },
      { ...check, payers: [] }
    );
    assert.deepEqual(added.newCoverage, {
      payerId: 'p-Medicare',
      memberId: 'M9',
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    });
    assert.equal(chargeChanges(added).payers, true);
    assert.equal(readClaimPatch({ payerId: 'p-Medicare' }, check).newCoverage, null);
  });
});
