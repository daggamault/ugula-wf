import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build277Status } from './mock-x277-status.ts';
import { readClaimStatus } from './x277-status.ts';

describe('build277Status', () => {
  it('answers each claim status request with its trace, status and amounts', () => {
    const text = build277Status(
      [
        {
          trace: 'T-1',
          claimNumber: 'c-1',
          category: 'F1',
          code: '65',
          chargeCents: 10_000,
          paidCents: 8_000,
          payerClaimNumber: 'P-1'
        },
        { trace: 'T-2', claimNumber: 'c-2', category: 'A3', code: '21', message: 'Bad ID' }
      ],
      { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7, receiver: 'ME' }
    );
    assert.deepEqual(
      readClaimStatus(text).map((s) => [
        s.trace,
        s.claimNumber,
        s.category,
        s.code,
        s.chargeCents,
        s.paidCents,
        s.payerClaimNumber
      ]),
      [
        ['T-1', 'c-1', 'F1', '65', 10_000, 8_000, 'P-1'],
        ['T-2', 'c-2', 'A3', '21', 0, 0, null]
      ]
    );
    assert.equal(readClaimStatus(text)[1]?.message, 'Returned as unprocessable: Bad ID');
  });
});
