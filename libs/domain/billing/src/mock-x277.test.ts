import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build277 } from './mock-x277.ts';
import { read277 } from './x277.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

describe('build277', () => {
  it('builds a 277CA with one status per claim', () => {
    const text = build277(
      {
        claims: [
          { claimNumber: '101', chargeCents: 1000, rejection: null, payerClaimNumber: 'P-1' },
          { claimNumber: '102', rejection: 'Invalid member ID' }
        ]
      },
      at
    );
    assert.deepEqual(read277(text), [
      {
        claimNumber: '101',
        status: 'accepted',
        categories: ['A2'],
        payerClaimNumber: 'P-1',
        message: 'Accepted into adjudication'
      },
      {
        claimNumber: '102',
        status: 'rejected',
        categories: ['A7'],
        payerClaimNumber: null,
        message: 'Invalid member ID'
      }
    ]);
  });

  it('rejects every claim under a billing provider the payer rejects', () => {
    const text = build277(
      {
        providerRejection: 'Billing provider not enrolled',
        claims: [
          { claimNumber: '101', rejection: null, payerClaimNumber: 'P-1' },
          { claimNumber: '102', rejection: 'Invalid member ID' }
        ]
      },
      at
    );
    assert.deepEqual(
      read277(text).map((a) => [a.claimNumber, a.status, a.categories, a.message]),
      [
        ['101', 'rejected', ['A3', 'A2'], 'Billing provider not enrolled'],
        ['102', 'rejected', ['A3', 'A7'], 'Billing provider not enrolled; Invalid member ID']
      ]
    );
  });
});
