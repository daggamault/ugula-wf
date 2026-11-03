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

  it('posts a denial with its reason codes but keeps the balance for a biller to reconcile', () => {
    assert.deepEqual(
      remittancePosting({
        ...paid,
        status: '4',
        denied: true,
        paidCents: 0,
        adjustments: [{ group: 'CO', reason: '16', cents: 100_000 }]
      }),
      {
        post: true,
        paidCents: 0,
        adjustedCents: 0,
        adjustments: [{ group: 'CO', reason: '16', cents: 100_000 }],
        payerClaimNumber: 'ICN-1'
      }
    );
  });

  it('leaves reversals and takebacks to a biller', () => {
    assert.equal(remittancePosting({ ...paid, reversal: true }).post, false);
    assert.equal(
      remittancePosting({ ...paid, adjustments: [{ group: 'CO', reason: '45', cents: -500 }] })
        .post,
      false
    );
    assert.deepEqual(remittancePosting({ ...paid, paidCents: -100, adjustments: [] }), {
      post: false,
      reason: 'The remittance takes money back on this claim; post the correction by hand'
    });
  });

  it('nets a reason code that a later CAS cancels, and posts other adjustment groups', () => {
    const posting = remittancePosting({
      ...paid,
      adjustments: [
        { group: 'CO', reason: '45', cents: 500 },
        { group: 'CO', reason: '45', cents: -500 },
        { group: 'OA', reason: '23', cents: 1_000 },
        { group: 'PI', reason: '96', cents: 200 },
        { group: 'PR', reason: '3', cents: 2_500 }
      ]
    });
    assert.deepEqual(posting, {
      post: true,
      paidCents: 60_000,
      adjustedCents: 1_200,
      adjustments: [
        { group: 'OA', reason: '23', cents: 1_000 },
        { group: 'PI', reason: '96', cents: 200 },
        { group: 'PR', reason: '3', cents: 2_500 }
      ],
      payerClaimNumber: 'ICN-1'
    });
  });

  it('leaves remittances with more reason codes than a payment holds to a biller', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      group: 'CO' as const,
      reason: String(i + 1),
      cents: 1
    }));
    assert.deepEqual(remittancePosting({ ...paid, adjustments: many }), {
      post: false,
      reason: 'The remittance has more reason codes than a payment can hold'
    });
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

  it('falls back to the processing order when one payer ID covers several plans', () => {
    const twice = [...coverages, { id: 'mcr-2', payerId: 'demomcr' }];
    assert.equal(remittanceCoverage(twice, 'DEMOMCR', '20')?.id, 'blue');
    assert.equal(remittanceCoverage(twice, 'DEMOMCR', '22'), null);
    assert.equal(remittanceCoverage([{ id: 'x', payerId: null }], null, '1')?.id, 'x');
  });
});
