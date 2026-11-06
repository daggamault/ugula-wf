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
    const e = encounterFactsOf(fixtureReport('als2-iv-medications.xml'));
    assert.equal(e.lastName, 'Quintero');
    assert.equal(e.birthDate, '1961-02-19');
    assert.equal(e.loadedMiles, 6.86);
    assert.match(e.serviceDate ?? '', /^\d{4}-\d{2}-\d{2}$/);
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
    assert.deepEqual(
      mismatchesOf(claim, facts()).map((m) => [m.field, m.encounter]),
      [
        ['patient', 'Quintero, Rosalind'],
        ['birthDate', '1961-02-19'],
        ['serviceDate', '2026-09-14'],
        ['loadedMiles', '6.86'],
        ['memberId', '1EG4-TE5-MK72']
      ]
    );
  });

  it('does not flag what either side leaves out', () => {
    const empty = facts({
      lastName: null,
      birthDate: null,
      serviceDate: null,
      loadedMiles: null,
      memberIds: []
    });
    const claim = claimOf({ coverages: [{ member_id: 'X' }] });
    assert.deepEqual(mismatchesOf(claim, empty), []);
    assert.deepEqual(mismatchesOf(claimOf({ last_name: null, birth_date: null }), facts()), []);
  });
});
