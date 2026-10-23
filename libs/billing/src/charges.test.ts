import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isServiceLevel, priceLines, readLines, readPricedLines } from './charges.ts';

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
        totalCents: 114220
      }
    );
  });

  it('names every code missing from the schedule', () => {
    assert.throws(
      () =>
        priceLines(
          [
            { code: 'A0433', units: 1 },
            { code: 'A0425', units: 3 },
            { code: 'A0433', units: 1 }
          ],
          { A0425: 1550 }
        ),
      /No fee scheduled for A0433$/
    );
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
