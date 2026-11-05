import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergedAdjustments,
  readPostings,
  remittanceCoverage,
  remittanceLine
} from './remittances.ts';
import type { RemittanceClaim } from './x835.ts';

const paid: RemittanceClaim = {
  claimNumber: '1001',
  status: '1',
  chargeCents: 100_000,
  paidCents: 60_000,
  patientCents: 15_000,
  payerClaimNumber: 'ICN-1',
  adjustments: [
    { group: 'CO', reason: '45', cents: 20_000 },
    { group: 'PR', reason: '1', cents: 10_000 },
    { group: 'PR', reason: '2', cents: 5_000 },
    { group: 'CO', reason: '45', cents: 5_000 }
  ],
  denied: false,
  reversal: false
};

const matched = { claimId: 'c1', coverageId: 'mcr', payerName: 'Medicare' };

describe('remittanceLine', () => {
  it('states what the payer sent with the claim and payer it matched, merging reason codes', () => {
    assert.deepEqual(remittanceLine(3, paid, matched), {
      position: 3,
      reference: '1001',
      ...matched,
      denied: false,
      reversal: false,
      takeback: false,
      paidCents: 60_000,
      adjustments: [
        { group: 'CO', reason: '45', cents: 25_000 },
        { group: 'PR', reason: '1', cents: 10_000 },
        { group: 'PR', reason: '2', cents: 5_000 }
      ]
    });
  });

  it('flags takebacks, reversals and denials as facts for the routing rules', () => {
    assert.equal(remittanceLine(1, { ...paid, paidCents: -100 }, matched).takeback, true);
    const negative = { ...paid, adjustments: [{ group: 'CO' as const, reason: '45', cents: -5 }] };
    assert.equal(remittanceLine(1, negative, matched).takeback, true);
    const reversed = remittanceLine(1, { ...paid, reversal: true, denied: true }, matched);
    assert.deepEqual([reversed.reversal, reversed.denied], [true, true]);
  });
});

describe('mergedAdjustments', () => {
  it('nets a reason code that a later CAS cancels', () => {
    assert.deepEqual(
      mergedAdjustments([
        { group: 'CO', reason: '45', cents: 500 },
        { group: 'CO', reason: '45', cents: -500 },
        { group: 'OA', reason: '23', cents: 1_000 }
      ]),
      [{ group: 'OA', reason: '23', cents: 1_000 }]
    );
  });
});

describe('readPostings', () => {
  it('keeps the routing decisions a graph made, dropping malformed ones', () => {
    assert.deepEqual(
      readPostings([
        { position: 1, route: 'reconcile', message: '', adjustedCents: 2_500, reasons: [] },
        { position: 2, route: 'review', message: 'Reversed' },
        { position: 3, route: 'appeal' },
        { position: 4, route: 'escalate' },
        null
      ]),
      [
        { position: 1, route: 'reconcile', message: '', adjustedCents: 2_500 },
        { position: 2, route: 'review', message: 'Reversed', adjustedCents: 0 },
        { position: 3, route: 'appeal', message: '', adjustedCents: 0 }
      ]
    );
  });

  it('sends a negative or fractional adjustment to a biller instead of posting it', () => {
    assert.deepEqual(
      readPostings([
        { position: 1, route: 'reconcile', adjustedCents: -500 },
        { position: 2, route: 'reconcile', adjustedCents: 1.5 },
        { position: 3, route: 'reconcile', adjustedCents: null }
      ]).map((p) => [p.position, p.route, p.adjustedCents]),
      [
        [1, 'review', 0],
        [2, 'review', 0],
        [3, 'reconcile', 0]
      ]
    );
    assert.match(
      readPostings([{ position: 1, route: 'appeal', adjustedCents: -500 }])[0]?.message ?? '',
      /-500 cents .*post it by hand/
    );
  });
});

describe('remittanceCoverage', () => {
  const coverages = [
    { id: 'mcr', payerId: 'DEMOMCR' },
    { id: 'blue', payerId: 'BCBS1' }
  ];

  it('matches the payer by its clearinghouse ID, else by the order it processed the claim in', () => {
    assert.equal(remittanceCoverage(coverages, 'bcbs1', '1')?.id, 'blue');
    assert.equal(remittanceCoverage(coverages, null, '19')?.id, 'mcr');
    assert.equal(remittanceCoverage(coverages, null, '4'), null);
    assert.equal(remittanceCoverage(coverages, null, '3'), null);
  });

  it('never posts a payer that is not on the claim to another payer', () => {
    assert.equal(remittanceCoverage(coverages, 'OTHER', '2'), null);
    assert.equal(remittanceCoverage(coverages, 'OTHER', '1'), null);
    const unlinked = [{ id: 'x', payerId: null }, ...coverages];
    assert.equal(remittanceCoverage(unlinked, 'OTHER', '1')?.id, 'x');
    assert.equal(remittanceCoverage([{ id: 'x', payerId: null }], null, '1')?.id, 'x');
  });

  it('picks by processing order among the plans one payer ID covers', () => {
    const twice = [...coverages, { id: 'mcr-2', payerId: 'demomcr' }];
    assert.equal(remittanceCoverage(twice, 'DEMOMCR', '21')?.id, 'mcr-2');
    assert.equal(remittanceCoverage(twice, 'DEMOMCR', '20'), null);
    assert.equal(remittanceCoverage(twice, 'DEMOMCR', '22'), null);
  });
});
