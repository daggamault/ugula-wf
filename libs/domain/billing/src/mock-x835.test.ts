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

  it('reports zero-pay denials as processed, crossovers, reversals and provider adjustments', () => {
    const denial = (status: string, reason: string) => ({
      claimNumber: `D${status}`,
      status,
      chargeCents: 50_000,
      paidCents: 0,
      adjustments: [{ group: 'CO' as const, reason, cents: 50_000 }]
    });
    const text = build835(
      [
        {
          claims: [
            denial('1', '50'),
            denial('2', '22'),
            denial('3', '16'),
            {
              claimNumber: '201',
              status: '19',
              chargeCents: 10_000,
              paidCents: 6_000,
              adjustments: [
                { group: 'CO', reason: '45', cents: 2_000 },
                { group: 'PR', reason: '2', cents: 2_000 }
              ],
              remarks: ['MA18'],
              crossover: { name: 'Medigap Plan', id: 'GAP01' }
            },
            {
              claimNumber: '202',
              status: '22',
              chargeCents: -10_000,
              paidCents: -6_000,
              payerClaimNumber: 'ICN-1',
              adjustments: [{ group: 'CO', reason: '45', cents: -4_000 }]
            },
            {
              claimNumber: '202',
              status: '1',
              chargeCents: 10_000,
              paidCents: 7_000,
              payerClaimNumber: 'ICN-2'
            }
          ],
          providerAdjustments: [
            { reason: 'WO', reference: 'ICN-9', cents: 1_500 },
            { reason: 'L6', cents: -25 }
          ]
        }
      ],
      at
    );
    assert.ok(text.includes('NM1*TT*2*MEDIGAP PLAN*****PI*GAP01~'));
    assert.ok(text.includes('PLB*1234567893*20261231*WO:ICN-9*15.00*L6*-0.25~'));
    const [r] = read835(text);
    assert.equal(r?.totalCents, 5_525);
    assert.deepEqual(r?.providerAdjustments, [
      { reason: 'WO', reference: 'ICN-9', cents: 1_500 },
      { reason: 'L6', reference: null, cents: -25 }
    ]);
    assert.deepEqual(
      r?.claims.map((c) => [c.claimNumber, c.status, c.paidCents, c.denied, c.reversal]),
      [
        ['D1', '1', 0, false, false],
        ['D2', '2', 0, false, false],
        ['D3', '3', 0, false, false],
        ['201', '19', 6_000, false, false],
        ['202', '22', -6_000, false, true],
        ['202', '1', 7_000, false, false]
      ]
    );
    assert.deepEqual(r?.claims[3]?.remarks, ['MA18']);
    assert.deepEqual(r?.claims[4]?.adjustments, [{ group: 'CO', reason: '45', cents: -4_000 }]);
  });
});
