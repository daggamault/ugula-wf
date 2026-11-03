import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isServiceLevel,
  isTransport,
  isTripType,
  NO_TRANSPORT_TRIPS,
  priceLines,
  readLines,
  readPricedLines,
  roundUnits
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

  it('rounds units up to the tenths an 837P carries', () => {
    assert.deepEqual(readLines([{ code: 'A0425', units: 12.34 }]), [
      { code: 'A0425', units: 12.4 }
    ]);
    assert.equal(roundUnits(1.1), 1.1);
    assert.equal(roundUnits(1.1000000000000085), 1.1);
    assert.equal(roundUnits(1.11), 1.2);
    assert.equal(roundUnits(1.0999999999999943), 1.1);
  });

  it('rejects empty claims, bad codes and bad units', () => {
    assert.throws(() => readLines([]), /at least one line/);
    assert.throws(() => readLines(null), /at least one line/);
    assert.throws(() => readLines([{ code: 'a427', units: 1 }]), /Line 1 has no valid HCPCS/);
    assert.throws(() => readLines([{ code: 'A0427', units: 0 }]), /positive number of units/);
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

  it('knows the trip types and which of them transport', () => {
    assert.ok(isTripType('refusal'));
    assert.ok(!isTripType('transfer'));
    assert.deepEqual(NO_TRANSPORT_TRIPS, ['treatNoTransport', 'refusal']);
  });
});

describe('priceLines rounding', () => {
  it('prices the rounded units', () => {
    const { lines } = priceLines(readLines([{ code: 'A0425', units: 12.31 }]), { A0425: 1000 });
    assert.deepEqual(lines, [{ code: 'A0425', units: 12.4, unitCents: 1000, totalCents: 12400 }]);
  });
});

describe('isTransport', () => {
  it('is false only when every line is treatment without transport', () => {
    assert.equal(isTransport([{ code: 'A0998', units: 1 }]), false);
    assert.equal(isTransport([{ code: 'A0429', units: 1 }]), true);
  });
});

describe('readPricedLines', () => {
  it('keeps prices and rejects lines that were never priced', () => {
    const priced = [{ code: 'A0427', units: 1, unitCents: 95000, totalCents: 95000 }];
    assert.deepEqual(readPricedLines(priced), priced);
    assert.throws(
      () => readPricedLines([{ code: 'A0427', units: 1 }]),
      /Line 1 [(]A0427[)] has not been priced/
    );
  });
});

describe('isServiceLevel', () => {
  it('accepts the four ground ambulance levels only', () => {
    assert.ok(['BLS', 'ALS1', 'ALS2', 'SCT'].every(isServiceLevel));
    assert.ok(!isServiceLevel('als1'));
    assert.ok(!isServiceLevel(null));
  });
});
