import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chargeChanges, editedValues, readClaimPatch } from './claim-fix.ts';
import { completeCheck } from './testing.ts';

const check = completeCheck();

const unchanged = {
  serviceDate: null,
  classification: null,
  level: null,
  emergency: null,
  loadedMiles: null,
  deceased: null,
  nonCoveredMiles: null,
  diagnoses: null,
  pickup: null,
  destination: null,
  originDestination: null,
  documentation: null,
  patientAddress: null,
  coverage: null,
  newCoverage: null,
  lines: null,
  note: null
};

describe('readClaimPatch', () => {
  it('keeps what the biller left empty and merges partial addresses', () => {
    assert.deepEqual(readClaimPatch({}, check), unchanged);
    assert.deepEqual(readClaimPatch('nonsense', check), unchanged);
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
    assert.deepEqual(chargeChanges(patch), {
      classification: false,
      level: false,
      emergency: false,
      loadedMiles: true,
      deceased: false,
      nonCoveredMiles: false,
      payers: true
    });
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
        pcsOnFile: null,
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
    assert.deepEqual(patch.documentation, {
      patientCount: 2,
      abnOnFile: true,
      abnSignedOn: '2025-12-30',
      mspEsrd: false,
      mspAccident: 'workersComp',
      priorAuthorization: 'UTN-9',
      roundTrips: 4,
      facilityStay: 'snf'
    });
  });

  it('patches the death and non-covered miles only when they differ from the claim', () => {
    assert.equal(readClaimPatch({ deceased: false }, check).deceased, null);
    assert.equal(readClaimPatch({ deceased: false }, { ...check, deceased: true }).deceased, false);
    assert.equal(readClaimPatch({ nonCoveredMiles: 0 }, check).nonCoveredMiles, null);
    const some = { ...check, nonCoveredMiles: 2 };
    assert.equal(readClaimPatch({ nonCoveredMiles: 2 }, some).nonCoveredMiles, null);
    assert.equal(readClaimPatch({ nonCoveredMiles: 0 }, some).nonCoveredMiles, 0);
  });

  it('patches the charge inputs a biller sets, but never classifies a claim as not billable', () => {
    const patch = readClaimPatch(
      { classification: 'scheduled', level: 'BLS', emergency: false, note: ' why ' },
      check
    );
    assert.deepEqual(
      [patch.classification, patch.level, patch.emergency, patch.note],
      ['scheduled', 'BLS', false, 'why']
    );
    assert.deepEqual(chargeChanges(patch), {
      classification: true,
      level: true,
      emergency: true,
      loadedMiles: false,
      deceased: false,
      nonCoveredMiles: false,
      payers: false
    });
  });

  it('keeps the pickup name when the pickup address changes', () => {
    assert.deepEqual(readClaimPatch({ pickupAddressLine: '1 Main St' }, check).pickup, {
      ...check.details.pickup,
      addressLine: '1 Main St'
    });
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
    assert.equal(readClaimPatch({}, none).originDestination, null);
    assert.equal(readClaimPatch({ destinationCode: 'H' }, none).originDestination, null);
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
    assert.equal(
      readClaimPatch({ payerId: 'p-Medicare', coverageId: 'c1' }, { ...check, payers: [] })
        .newCoverage,
      null
    );
    assert.deepEqual(
      readClaimPatch(
        { payerId: 'p-Blue', relationship: '01', insuredFirstName: 'Pat', insuredLastName: 'Doe' },
        { ...check, payers: [] }
      ).newCoverage,
      {
        payerId: 'p-Blue',
        memberId: null,
        relationship: '01',
        insuredFirstName: 'Pat',
        insuredLastName: 'Doe'
      }
    );
  });

  it('renames the destination without losing the new name to the old one', () => {
    const { destination } = readClaimPatch({ destinationName: 'St. Luke' }, check);
    assert.deepEqual(destination, { ...check.details.destination, name: 'St. Luke' });
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
