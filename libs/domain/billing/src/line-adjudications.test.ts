import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LineAdjudication } from './adjudications.ts';
import { claimLevelAdjustments } from './line-adjudications.ts';

const adjudication = (line: number, paidCents: number, cents: number): LineAdjudication => ({
  line,
  code: 'A0427',
  modifiers: [],
  paidCents,
  units: 1,
  adjustments: [{ group: 'CO', reason: '45', cents }]
});

describe('claimLevelAdjustments', () => {
  it('keeps the adjustments no line carries', () => {
    assert.deepEqual(
      claimLevelAdjustments(
        [
          { group: 'CO', reason: '45', cents: 400 },
          { group: 'OA', reason: '23', cents: 100 }
        ],
        [adjudication(1, 600, 400)]
      ),
      [{ group: 'OA', reason: '23', cents: 100 }]
    );
  });

  it('nets out what the lines carry, keeping a remainder at claim level', () => {
    assert.deepEqual(
      claimLevelAdjustments(
        [{ group: 'CO', reason: '45', cents: 500 }],
        [adjudication(1, 600, 300), adjudication(2, 0, 50)]
      ),
      [{ group: 'CO', reason: '45', cents: 150 }]
    );
    assert.deepEqual(claimLevelAdjustments([], [adjudication(1, 600, 300)]), [
      { group: 'CO', reason: '45', cents: -300 }
    ]);
    assert.deepEqual(claimLevelAdjustments([], []), []);
  });
});
