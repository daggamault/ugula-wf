import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type EncounterFacts, encounterFactsOf, mismatchesOf } from './encounter-check.ts';
import { fixtureReport } from './testing.ts';

type ClaimFacts = Parameters<typeof mismatchesOf>[0];

const claimOf = (patch: Partial<ClaimFacts> = {}): ClaimFacts => ({
  first_name: 'Rosalind',
  last_name: 'Quintero',
  birth_date: '1961-02-19',
  service_date: null,
  loaded_miles: null,
  coverages: [],
  ...patch
});

const facts = (patch: Partial<EncounterFacts> = {}): EncounterFacts => ({
  firstName: 'Rosalind',
  lastName: 'Quintero',
  birthDate: '1961-02-19',
  serviceDate: '2026-09-14',
  loadedMiles: 6.86,
  memberIds: ['1EG4-TE5-MK72'],
  ...patch
});

describe('encounterFactsOf', () => {
  it('reads the facts a claim copies from a patient care report', () => {
    assert.deepEqual(encounterFactsOf(fixtureReport('als2-iv-medications')), {
      firstName: 'Rosalind',
      lastName: 'Quintero',
      birthDate: '1961-02-19',
      serviceDate: '2026-09-06',
      loadedMiles: 6.86,
      memberIds: ['XGB110093422']
    });
  });

  it('reads nothing from an empty report', () => {
    assert.deepEqual(encounterFactsOf({}), {
      firstName: null,
      lastName: null,
      birthDate: null,
      serviceDate: null,
      loadedMiles: null,
      memberIds: []
    });
  });

  it('dates the service by the call, then the scene arrival, then leaving the scene', () => {
    const times = {
      'eTimes.01': '2026-09-13T23:50:00-04:00',
      'eTimes.06': '2026-09-14T00:10:00-04:00',
      'eTimes.09': '2026-09-15T00:30:00-04:00'
    };
    assert.equal(encounterFactsOf(times).serviceDate, '2026-09-13');
    assert.equal(encounterFactsOf({ ...times, 'eTimes.01': 'unknown' }).serviceDate, '2026-09-14');
    assert.equal(encounterFactsOf({ 'eTimes.09': '2026-09-15' }).serviceDate, '2026-09-15');
  });

  it('measures loaded miles between the odometers only when both are read', () => {
    assert.equal(
      encounterFactsOf({ 'eResponse.20': '10.04', 'eResponse.21': '16.9' }).loadedMiles,
      6.86
    );
    assert.equal(encounterFactsOf({ 'eResponse.20': '10' }).loadedMiles, null);
    assert.equal(encounterFactsOf({ 'eResponse.21': '16.9' }).loadedMiles, null);
  });

  it('trims names and member ids and skips blank ones', () => {
    const e = encounterFactsOf({
      'ePatient.02': '  ',
      'ePatient.03': ' Ann ',
      'ePayment.InsuranceGroup': [{ 'ePayment.18': ' A1 ' }, { 'ePayment.18': '  ' }, {}]
    });
    assert.equal(e.lastName, null);
    assert.equal(e.firstName, 'Ann');
    assert.deepEqual(e.memberIds, ['A1']);
  });
});

describe('mismatchesOf', () => {
  it('finds nothing when the claim agrees with the encounter', () => {
    const claim = claimOf({
      first_name: 'ROSALIND',
      last_name: 'QUINTERO',
      service_date: '2026-09-14',
      loaded_miles: '6.9',
      coverages: [{ member_id: '1eg4te5mk72' }]
    });
    assert.deepEqual(mismatchesOf(claim, facts()), []);
  });

  it('names each value the claim changed from the encounter', () => {
    const claim = claimOf({
      first_name: 'Rosa',
      birth_date: '1961-02-20',
      service_date: '2026-09-15',
      loaded_miles: '12',
      coverages: [{ member_id: '9ZZ9' }]
    });
    assert.deepEqual(mismatchesOf(claim, facts({ memberIds: ['1EG4', 'TE5'] })), [
      { field: 'patient', label: 'Patient', encounter: 'Quintero, Rosalind' },
      { field: 'birthDate', label: 'Birth Date', encounter: '1961-02-19' },
      { field: 'serviceDate', label: 'Date of Service', encounter: '2026-09-14' },
      { field: 'loadedMiles', label: 'Loaded Miles', encounter: '6.86' },
      { field: 'memberId', label: 'Member ID', encounter: '1EG4, TE5' }
    ]);
  });

  it('flags loaded miles a tenth of a mile or more apart', () => {
    const at = (loaded_miles: string) =>
      mismatchesOf(claimOf({ loaded_miles }), facts({ loadedMiles: 6 })).map((m) => m.field);
    assert.deepEqual(at('6.09'), []);
    assert.deepEqual(at('5.91'), []);
    assert.deepEqual(at('6.11'), ['loadedMiles']);
    assert.deepEqual(at('5.89'), ['loadedMiles']);
    assert.deepEqual(at('6.1'), ['loadedMiles']);
    assert.deepEqual(at('5.9'), ['loadedMiles']);
  });

  it('flags a member id once any coverage is not on the encounter', () => {
    const claim = claimOf({
      coverages: [{ member_id: '1EG4TE5MK72' }, { member_id: null }, { member_id: 'X' }]
    });
    assert.deepEqual(
      mismatchesOf(claim, facts()).map((m) => m.field),
      ['memberId']
    );
    assert.deepEqual(mismatchesOf(claimOf({ coverages: [{ member_id: null }] }), facts()), []);
  });

  it('does not flag what the encounter leaves out', () => {
    const empty = facts({
      lastName: null,
      birthDate: null,
      serviceDate: null,
      loadedMiles: null,
      memberIds: []
    });
    const claim = claimOf({
      service_date: '2026-09-15',
      loaded_miles: '12',
      coverages: [{ member_id: 'X' }]
    });
    assert.deepEqual(mismatchesOf(claim, empty), []);
  });

  it('does not flag what the claim leaves out', () => {
    assert.deepEqual(
      mismatchesOf(claimOf({ last_name: null, birth_date: null, coverages: [] }), facts()),
      []
    );
  });
});
