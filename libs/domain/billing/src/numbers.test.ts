import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dailyNumberOf } from './numbers.ts';

describe('daily numbers', () => {
  it('reads numbers with or without a # or dash', () => {
    assert.deepEqual(
      [' 20261105-0001 ', '#20261105-0042', '202611050007', '20261105-12345'].map(dailyNumberOf),
      ['20261105-0001', '20261105-0042', '20261105-0007', '20261105-12345']
    );
  });

  it('rejects anything else', () => {
    assert.deepEqual(
      ['', '1001', '2026-11-05', '20261105-01', 'PCR-1', '20261105 0001'].map(dailyNumberOf),
      [null, null, null, null, null, null]
    );
  });
});
