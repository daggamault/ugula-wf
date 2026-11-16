import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { feeYearOf, isRurality, type MedicareFee, medicareAllowed } from './medicare-fees.ts';

const mileage: MedicareFee = {
  code: 'A0425',
  urbanCents: 933,
  ruralCents: 942,
  superRuralCents: null,
  ruralShortTripCents: 1413
};

const als: MedicareFee = {
  code: 'A0427',
  urbanCents: 70_975,
  ruralCents: 71_671,
  superRuralCents: 87_869,
  ruralShortTripCents: null
};

const fees = [mileage, als];

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

  // 42 CFR 414.610(c)(5)(i): rural ground miles 1-17 are paid at 150% of the rural
  // mileage rate (1.5 x 942 = 1413 cents) and miles 18 and up at the rural rate. The
  // super-rural bonus (414.610(c)(5)(ii)) raises only the base rate.
  it('pays exactly 17 rural miles at the short trip rate and the 18th at the rural rate', () => {
    const at = (units: number) =>
      medicareAllowed([{ code: 'A0425', units, chargeCents: null }], fees, 'rural').totalCents;
    assert.equal(at(17), 24_021);
    assert.equal(at(17.1), 24_115);
    assert.equal(at(18), 24_963);
    assert.equal(at(20.5), 27_318);
  });

  it('pays super-rural miles like rural miles and its base at the super-rural rate', () => {
    assert.deepEqual(
      medicareAllowed(
        [
          { code: 'A0427', units: 1, chargeCents: null },
          { code: 'A0425', units: 18, chargeCents: null }
        ],
        fees,
        'superRural'
      ),
      {
        lines: [
          { code: 'A0427', units: 1, allowedCents: 87_869 },
          { code: 'A0425', units: 18, allowedCents: 24_963 }
        ],
        totalCents: 112_832,
        missing: []
      }
    );
  });

  it('falls back to the rural base rate when a code has no super-rural rate', () => {
    const noBonus: MedicareFee[] = [{ ...als, superRuralCents: null }];
    assert.equal(
      medicareAllowed([{ code: 'A0427', units: 1, chargeCents: null }], noBonus, 'superRural')
        .totalCents,
      71_671
    );
  });

  it('pays every rural mile at the rural rate when there is no short trip rate', () => {
    const flat: MedicareFee[] = [{ ...mileage, ruralShortTripCents: null }];
    assert.equal(
      medicareAllowed([{ code: 'A0425', units: 10, chargeCents: null }], flat, 'rural').totalCents,
      9_420
    );
  });

  it('rounds half cents up', () => {
    const half = [{ code: 'A0425', units: 0.5, chargeCents: null }];
    assert.equal(medicareAllowed(half, fees, 'urban').totalCents, 467);
    assert.equal(medicareAllowed(half, fees, 'rural').totalCents, 707);
  });

  it('allows a rural charge below the fee schedule', () => {
    assert.deepEqual(
      medicareAllowed([{ code: 'A0425', units: 18, chargeCents: 20_000 }], fees, 'rural').lines,
      [{ code: 'A0425', units: 18, allowedCents: 20_000 }]
    );
  });

  it('allows nothing when no line has a Medicare fee', () => {
    assert.deepEqual(medicareAllowed([], fees, 'rural'), { lines: [], totalCents: 0, missing: [] });
    assert.deepEqual(
      medicareAllowed([{ code: 'A0427', units: 1, chargeCents: null }], [], 'urban'),
      {
        lines: [],
        totalCents: 0,
        missing: ['A0427']
      }
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
