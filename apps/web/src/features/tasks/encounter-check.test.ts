import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskClaim } from './client.ts';
import { type EncounterFacts, encounterFactsOf, mismatchesOf } from './encounter-check.ts';
import { fixtureReport } from './testing.ts';

const claimOf = (patch: Partial<TaskClaim> = {}): TaskClaim => ({
  id: 'c1',
  number: '20261101-0012',
  status: 'draft',
  patient: 'Quintero, Rosalind',
  birthDate: '1961-02-19',
  serviceDate: null,
  classification: null,
  level: null,
  emergency: null,
  loadedMiles: null,
  totalCents: null,
  balanceCents: null,
  payers: [],
  lines: [],
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
      patient: 'QUINTERO, ROSALIND',
      serviceDate: '2026-09-14',
      loadedMiles: '6.9',
      payers: [{ payer: 'Medicare', memberId: '1eg4te5mk72', eligibility: null }]
    });
    assert.deepEqual(mismatchesOf(claim, facts()), []);
  });

  it('names each value the claim changed from the encounter', () => {
    const claim = claimOf({
      patient: 'Quintero, Rosa',
      birthDate: '1961-02-20',
      serviceDate: '2026-09-15',
      loadedMiles: 12,
      payers: [{ payer: 'Medicare', memberId: '9ZZ9', eligibility: null }]
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
    const claim = claimOf({ payers: [{ payer: 'Medicare', memberId: 'X', eligibility: null }] });
    assert.deepEqual(mismatchesOf(claim, empty), []);
    assert.deepEqual(mismatchesOf(claimOf({ patient: null, birthDate: null }), facts()), []);
  });
});
