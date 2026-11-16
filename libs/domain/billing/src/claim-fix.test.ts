import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chargeChanges, editedValues, readClaimPatch } from './claim-fix.ts';
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

  it('patches no coverage when only the coverage is named', () => {
    assert.equal(readClaimPatch({ coverageId: 'cov-Blue', memberId: ' ' }, check).coverage, null);
  });

  it('builds the origin and destination modifier from either half', () => {
    const none = { ...check, details: { ...check.details, originDestination: null } };
    assert.equal(
      readClaimPatch({ originCode: 'S', destinationCode: 'H' }, none).originDestination,
      'SH'
    );
    assert.equal(readClaimPatch({ originCode: 'S' }, none).originDestination, null);
    assert.equal(readClaimPatch({ destinationCode: 'N' }, check).originDestination, 'RN');
    assert.equal(
      readClaimPatch({ originCode: 'R', destinationCode: 'H' }, check).originDestination,
      null
    );
  });

  it('reads a transport reason in any case and only when it changes', () => {
    assert.deepEqual(readClaimPatch({ transportReason: ' d ' }, check).documentation, {
      transportReason: 'D'
    });
    assert.equal(readClaimPatch({ transportReason: 'a' }, check).documentation, null);
    assert.equal(readClaimPatch({ transportReason: 'Z' }, check).documentation, null);
  });

  it('ignores values of the wrong type', () => {
    const patch = readClaimPatch(
      {
        emergency: 'yes',
        deceased: 'true',
        level: 'als1',
        classification: 'transfer',
        loadedMiles: 501,
        nonCoveredMiles: -1,
        pcsOnFile: 'true',
        patientCount: 1.5,
        roundTrips: -1,
        pcsSignedOn: '12/30/2025'
      },
      check
    );
    assert.deepEqual(
      [
        patch.emergency,
        patch.deceased,
        patch.level,
        patch.classification,
        patch.loadedMiles,
        patch.nonCoveredMiles,
        patch.documentation
      ],
      [null, null, null, null, null, null, null]
    );
    assert.equal(readClaimPatch({ emergency: false, loadedMiles: 500 }, check).emergency, false);
    assert.equal(readClaimPatch({ loadedMiles: 500 }, check).loadedMiles, 500);
  });

  it("changes the patient's address only when the claim has a patient", () => {
    assert.deepEqual(readClaimPatch({ patientCity: 'Chicago' }, check).patientAddress, {
      addressLine: '9 Oak Ave',
      city: 'Chicago',
      state: 'IL',
      postalCode: '62702'
    });
    assert.equal(
      readClaimPatch({ patientCity: 'Chicago' }, { ...check, patient: null }).patientAddress,
      null
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

describe('editedValues', () => {
  it('leaves out what a biller kept as the task showed it, so a change made meanwhile stands', () => {
    assert.deepEqual(
      editedValues(
        { pcsOnFile: false, transportReason: 'D', diagnoses: ['R07.9'], signature: null },
        { pcsOnFile: false, transportReason: 'A', diagnoses: ['R07.9'] }
      ),
      { pcsOnFile: null, transportReason: 'D', diagnoses: null, signature: null }
    );
  });

  it('always keeps the payer a member ID is entered for', () => {
    assert.deepEqual(
      editedValues({ coverageId: 'c1', memberId: 'M1' }, { coverageId: 'c1', memberId: null }),
      {
        coverageId: 'c1',
        memberId: 'M1'
      }
    );
  });

  it('keeps every value when the task showed nothing', () => {
    assert.deepEqual(editedValues({ level: 'BLS' }, null), { level: 'BLS' });
  });
});
