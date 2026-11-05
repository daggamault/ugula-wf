import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read837 } from './mock-x837.ts';
import { build999 } from './mock-x999.ts';
import {
  sampleDependentX837,
  sampleEnvelope,
  sampleRejectedX837,
  sampleSubmitter,
  sampleX837
} from './testing.ts';
import { build837 } from './x837.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

const file837 = build837(
  sampleSubmitter,
  [sampleX837, sampleRejectedX837, sampleDependentX837],
  sampleEnvelope
);

describe('read837', () => {
  it('reads the envelope and each claim of our own 837P', () => {
    const r = read837(file837);
    assert.equal(r.interchangeControlNumber, '000000042');
    assert.equal(r.groupControlNumber, '42');
    assert.equal(r.transactionControlNumber, '0001');
    assert.equal(r.sender, 'SUB01');
    assert.equal(r.receiver, 'RCV01');
    assert.deepEqual(r.provider, { name: 'METRO EMS', id: '1234567893' });
    assert.deepEqual(
      r.claims.map((c) => [c.claimNumber, c.chargeCents, c.memberId, c.serviceDate, c.payer?.id]),
      [
        ['c-1', 94_250, '1EG4TE5MK73', '2026-10-01', 'DEMOMCR'],
        ['c-2', 94_250, 'REJECT123', '2026-10-01', 'DEMOMCR'],
        ['c-3', 85_000, 'SPOUSE1', '2026-10-02', 'AETNA']
      ]
    );
    assert.equal(r.claims[2]?.claimFiling, 'CI');
    assert.equal(r.claims[2]?.patient.lastName, "O'BRIEN");
  });

  it('refuses what is not an 837P', () => {
    assert.throws(() => read837('hello'), /Not an X12 file/);
    assert.throws(() => read837(build999({ groupControlNumber: '1', transactions: [] }, at)));
  });
});
