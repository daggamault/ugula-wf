import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { remittanceCoverage, remittancePosting } from './remittances.ts';
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

describe('remittancePosting', () => {
  it('posts the payment, adjusts off all but patient responsibility, and keeps every reason code', () => {
    assert.deepEqual(remittancePosting(paid), {
      post: true,
      paidCents: 60_000,
      adjustedCents: 25_000,
      adjustments: [
        { group: 'CO', reason: '45', cents: 25_000 },
        { group: 'PR', reason: '1', cents: 10_000 },
        { group: 'PR', reason: '2', cents: 5_000 }
      ],
      payerClaimNumber: 'ICN-1'
    });
  });

  it('posts a denial with no payment and leaves reversals and takebacks to a biller', () => {
    const denied = remittancePosting({
      ...paid,
      status: '4',
      denied: true,
      paidCents: 0,
      adjustments: [{ group: 'CO', reason: '16', cents: 100_000 }]
    });
    assert.equal(denied.post && denied.adjustedCents, 100_000);
    assert.equal(remittancePosting({ ...paid, reversal: true }).post, false);
    assert.equal(
      remittancePosting({ ...paid, adjustments: [{ group: 'CO', reason: '45', cents: -500 }] })
        .post,
      false
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
    assert.equal(remittanceCoverage(coverages, 'OTHER', '2')?.id, 'blue');
    assert.equal(remittanceCoverage(coverages, null, '19')?.id, 'mcr');
    assert.equal(remittanceCoverage(coverages, null, '4'), null);
    assert.equal(remittanceCoverage(coverages, null, '3'), null);
  });
});
