import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { feeYearOf, isRurality, type MedicareFee, medicareAllowed } from './medicare-fees.ts';

const fees: MedicareFee[] = [
  {
    code: 'A0425',
    urbanCents: 933,
    ruralCents: 942,
    superRuralCents: null,
    ruralShortTripCents: 1413
  },
  {
    code: 'A0427',
    urbanCents: 70_975,
    ruralCents: 71_671,
    superRuralCents: 87_869,
    ruralShortTripCents: null
  }
];

const lines = [
  { code: 'A0427', units: 1, chargeCents: null },
  { code: 'A0425', units: 20.5, chargeCents: null },
  { code: 'A0888', units: 3, chargeCents: null },
  { code: 'A0888', units: 1, chargeCents: null }
];

describe('medicareAllowed', () => {
  it('prices urban trips at the urban rate and lists codes Medicare has no fee for once', () => {
    assert.deepEqual(medicareAllowed(lines, fees, 'urban'), {
      lines: [
        { code: 'A0427', units: 1, allowedCents: 70_975 },
        { code: 'A0425', units: 20.5, allowedCents: 19_127 }
      ],
      totalCents: 90_102,
      missing: ['A0888']
    });
  });

  it('pays the first 17 rural miles at the short trip rate and the rest at the rural rate', () => {
    const { lines: allowed } = medicareAllowed(lines, fees, 'rural');
    assert.deepEqual(
      allowed.map((l) => l.allowedCents),
      [71_671, 17 * 1413 + Math.round(3.5 * 942)]
    );
    assert.equal(
      medicareAllowed([{ code: 'A0425', units: 4.2, chargeCents: null }], fees, 'rural').totalCents,
      Math.round(4.2 * 1413)
    );
  });

  it('adds the super-rural bonus to base rates and pays super-rural miles as rural', () => {
    const { lines: allowed } = medicareAllowed(lines, fees, 'superRural');
    assert.deepEqual(
      allowed.map((l) => l.allowedCents),
      [87_869, 17 * 1413 + Math.round(3.5 * 942)]
    );
  });

  it('allows the lesser of the charge and the fee schedule', () => {
    const charged = [
      { code: 'A0427', units: 1, chargeCents: 95_000 },
      { code: 'A0425', units: 10, chargeCents: 8_000 }
    ];
    assert.deepEqual(
      medicareAllowed(charged, fees, 'urban').lines.map((l) => l.allowedCents),
      [70_975, 8_000]
    );
  });

  it('knows the three CMS rurality classes', () => {
    assert.ok(['urban', 'rural', 'superRural'].every(isRurality));
    assert.ok(!isRurality('super-rural'));
  });
});

describe('feeYearOf', () => {
  it('takes the fee schedule year from a date of service', () => {
    assert.equal(feeYearOf('2026-11-02'), 2026);
    assert.equal(feeYearOf('2026-11'), null);
    assert.equal(feeYearOf(null), null);
  });
});
