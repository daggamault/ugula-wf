import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claimProblems, readNewClaim } from './claim-validation.ts';

const claim = {
  pcrNumber: ' PCR-1 ',
  patientId: 'p1',
  serviceDate: '2026-10-01T08:15:00Z',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
  lines: [{ code: 'A0427', units: 1, unitCents: 100_000, totalCents: 100_000 }],
  totalCents: 100_000,
  coverages: [{ payer: 'Medicare', priority: '2611003' }],
  report: { bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' }
};

describe('claimProblems', () => {
  it('passes a complete claim', () => {
    assert.deepEqual(claimProblems(claim), []);
  });

  it('lists every missing or inconsistent part', () => {
    assert.deepEqual(claimProblems({ ...claim, totalCents: 5 }), [
      'The claim total does not add up to its lines'
    ]);
    const problems = claimProblems(null);
    assert.equal(problems[0], 'A claim needs a patient');
    assert.match(problems[1] ?? '', /level of service/);
    assert.ok(problems.includes('A claim needs a priced total'));
    assert.equal(problems.at(-1), 'A claim needs a date of service');
  });
});

describe('readNewClaim', () => {
  it('normalizes a valid claim and faults with every problem otherwise', () => {
    const read = readNewClaim(claim);
    assert.equal(read.pcrNumber, 'PCR-1');
    assert.equal(read.reportKey, 'imports/t/f.xml.reports/00000.json');
    assert.equal(read.details.serviceDate, '2026-10-01');
    assert.equal(read.coverages[0]?.payer, 'Medicare');
    assert.throws(() => readNewClaim({ ...claim, level: 'X', patientId: '' }), /patient\..*level/);
  });
});
