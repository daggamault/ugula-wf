import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isClassification,
  isServiceLevel,
  NO_TRANSPORT_TRIPS,
  priceLines,
  readLines,
  readPricedLines
} from './charges.ts';

describe('readLines', () => {
  it('accepts HCPCS lines with positive units', () => {
    assert.deepEqual(
      readLines([
        { code: 'A0427', units: 1 },
        { code: 'A0425', units: 12.4 }
      ]),
      [
        { code: 'A0427', units: 1 },
        { code: 'A0425', units: 12.4 }
      ]
    );
  });

  it('keeps the units it is given without rounding them', () => {
    assert.deepEqual(readLines([{ code: 'A0425', units: 12.34 }]), [
      { code: 'A0425', units: 12.34 }
    ]);
  });

  it('rejects empty claims, bad codes and bad units', () => {
    assert.throws(() => readLines([]), /at least one line/);
    assert.throws(() => readLines(null), /at least one line/);
    assert.throws(() => readLines([{ code: 'a427', units: 1 }]), /Line 1 has no valid HCPCS/);
    assert.throws(() => readLines([{ code: 'A0427', units: 0 }]), /positive number of units/);
  });

  it('rejects lines that are not objects and units that are not finite positive numbers', () => {
    assert.throws(() => readLines([null]), /^Error: Line 1 has no valid HCPCS code$/);
    assert.throws(() => readLines(['A0427']), /^Error: Line 1 has no valid HCPCS code$/);
    for (const units of [Number.NaN, Number.POSITIVE_INFINITY, -1, '2', null]) {
      assert.throws(
        () =>
          readLines([
            { code: 'A0427', units: 1 },
            { code: 'A0425', units }
          ]),
        /^Error: Line 2 \(A0425\) needs a positive number of units$/
      );
    }
  });
});

describe('priceLines', () => {
  it('prices each line from the schedule and totals the claim in cents', () => {
    assert.deepEqual(
      priceLines(
        readLines([
          { code: 'A0427', units: 1 },
          { code: 'A0425', units: 12.4 }
        ]),
        {
          A0427: 95000,
          A0425: 1550
        }
      ),
      {
        lines: [
          { code: 'A0427', units: 1, unitCents: 95000, totalCents: 95000 },
          { code: 'A0425', units: 12.4, unitCents: 1550, totalCents: 19220 }
        ],
        totalCents: 114220,
        missing: []
      }
    );
  });

  it('names every code missing from the schedule and prices the rest', () => {
    assert.deepEqual(
      priceLines(
        [
          { code: 'A0433', units: 1 },
          { code: 'A0425', units: 3 },
          { code: 'A0433', units: 1 }
        ],
        { A0425: 1550 }
      ),
      {
        lines: [{ code: 'A0425', units: 3, unitCents: 1550, totalCents: 4650 }],
        totalCents: 4650,
        missing: ['A0433']
      }
    );
  });
});

describe('isClassification', () => {
  it('knows the classifications and which of them transport', () => {
    assert.deepEqual(
      ['emergency', 'refusal', 'notBillable', 'transfer', null].map(isClassification),
      [true, true, true, false, false]
    );
    assert.deepEqual(NO_TRANSPORT_TRIPS, ['treatNoTransport', 'refusal']);
  });
});

describe('priceLines rounding', () => {
  it('prices the units it is given without rounding them first', () => {
    const { lines } = priceLines(readLines([{ code: 'A0425', units: 12.31 }]), { A0425: 1000 });
    assert.deepEqual(lines, [{ code: 'A0425', units: 12.31, unitCents: 1000, totalCents: 12310 }]);
  });

  it('rounds half cents up', () => {
    assert.deepEqual(
      priceLines(
        [
          { code: 'A0425', units: 0.5 },
          { code: 'A0425', units: 0.1 }
        ],
        { A0425: 1005 }
      ).lines.map((l) => l.totalCents),
      [503, 101]
    );
    assert.equal(priceLines([{ code: 'A0425', units: 0.1 }], { A0425: 15 }).totalCents, 2);
  });

  it('prices nothing from an empty schedule', () => {
    assert.deepEqual(priceLines([{ code: 'A0427', units: 1 }], {}), {
      lines: [],
      totalCents: 0,
      missing: ['A0427']
    });
  });
});

describe('readPricedLines', () => {
  it('keeps prices and rejects lines that were never priced', () => {
    const priced = [{ code: 'A0427', units: 1, unitCents: 95000, totalCents: 95000 }];
    assert.deepEqual(readPricedLines(priced), priced);
    assert.deepEqual(
      readPricedLines([{ code: 'A0998', units: 1, unitCents: 0, totalCents: 0, note: 'x' }]),
      [{ code: 'A0998', units: 1, unitCents: 0, totalCents: 0 }]
    );
    assert.throws(
      () => readPricedLines([{ code: 'A0427', units: 1 }]),
      /Line 1 [(]A0427[)] has not been priced/
    );
  });

  it('needs both whole, non-negative cents on every line', () => {
    for (const cents of [
      { unitCents: 95000 },
      { totalCents: 95000 },
      { unitCents: 950.5, totalCents: 950.5 },
      { unitCents: -1, totalCents: -1 }
    ]) {
      assert.throws(
        () => readPricedLines([{ code: 'A0427', units: 1, ...cents }]),
        /^Error: Line 1 \(A0427\) has not been priced$/
      );
    }
  });
});

describe('isServiceLevel', () => {
  it('accepts the four ground ambulance levels only', () => {
    assert.deepEqual(['BLS', 'ALS1', 'ALS2', 'SCT', 'als1', null].map(isServiceLevel), [
      true,
      true,
      true,
      true,
      false,
      false
    ]);
  });
});
