import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build277 } from './mock-x277.ts';
import { readX12 } from './x12.ts';
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

  it('names the parties from the envelope and each claim by its patient and service date', () => {
    const text = build277(
      {
        claims: [
          {
            claimNumber: '101',
            chargeCents: 1_250,
            rejection: null,
            patient: { lastName: 'Doe', firstName: 'Jane' },
            serviceDate: '2026-10-01'
          },
          { claimNumber: '102', rejection: null }
        ]
      },
      { ...at, sender: 'CH', receiver: 'ME' }
    );
    assert.deepEqual(
      readX12(text).segments.filter((s) => ['NM1', 'STC', 'DTP'].includes(s[0] ?? '')),
      [
        ['NM1', 'AY', '2', 'DEMO CLEARINGHOUSE', '', '', '', '', '46', 'CH'],
        ['NM1', '41', '2', 'DEVELOPMENT EMS', '', '', '', '', '46', 'ME'],
        ['NM1', '85', '2', 'DEVELOPMENT EMS', '', '', '', '', 'XX', '1234567893'],
        ['NM1', 'QC', '1', 'DOE', 'JANE'],
        ['STC', 'A2:20', '20261103', 'WQ', '12.5'],
        ['DTP', '472', 'D8', '20261001'],
        ['NM1', 'QC', '1', 'PATIENT'],
        ['STC', 'A2:20', '20261103', 'WQ', '0']
      ]
    );
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
