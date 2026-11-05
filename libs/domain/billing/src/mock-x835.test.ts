import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build835 } from './mock-x835.ts';
import { read835 } from './x835.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

describe('build835', () => {
  it('builds an 835 with one transaction per payer', () => {
    const text = build835(
      [
        {
          payer: { name: 'Medicare', id: 'MCR' },
          claims: [
            { claimNumber: '101', chargeCents: 10_000, paidCents: 8_000, payerClaimNumber: 'P-1' },
            { claimNumber: '102', chargeCents: 5_000, paidCents: 4_000 }
          ]
        },
        {
          payer: { name: 'Aetna', id: 'AET' },
          checkNumber: 'CHK-9',
          claims: [{ claimNumber: '103', chargeCents: 2_000, paidCents: 0 }]
        }
      ],
      at
    );
    const [mcr, aet] = read835(text);
    assert.equal(mcr?.payerId, 'MCR');
    assert.equal(mcr?.totalCents, 12_000);
    assert.equal(mcr?.paidOn, '2026-11-03');
    assert.deepEqual(
      mcr?.claims.map((c) => [c.claimNumber, c.chargeCents, c.paidCents, c.payerClaimNumber]),
      [
        ['101', 10_000, 8_000, 'P-1'],
        ['102', 5_000, 4_000, null]
      ]
    );
    assert.deepEqual(mcr?.claims[0]?.adjustments, [{ group: 'CO', reason: '45', cents: 2_000 }]);
    assert.equal(aet?.payerId, 'AET');
    assert.equal(aet?.checkNumber, 'CHK-9');
    assert.equal(aet?.claims[0]?.denied, true);
  });
});
