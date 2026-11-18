import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COVERAGE_STATUS_LABELS,
  COVERAGE_STATUSES,
  currentPayerIndex,
  isAdjudicated,
  isBillable,
  isWaiting
} from './payer-cycle.ts';

describe('payer cycle', () => {
  it('labels every payer status', () => {
    assert.ok(COVERAGE_STATUSES.every((s) => COVERAGE_STATUS_LABELS[s]));
  });

  it('sorts the statuses into billable, waiting and adjudicated', () => {
    assert.deepEqual(COVERAGE_STATUSES.filter(isBillable), ['pending', 'rejected']);
    assert.deepEqual(COVERAGE_STATUSES.filter(isWaiting), ['sent', 'accepted', 'forwarded']);
    assert.deepEqual(COVERAGE_STATUSES.filter(isAdjudicated), ['paid', 'denied']);
  });

  it('finds the first payer not finished with the claim', () => {
    const of = (...statuses: (typeof COVERAGE_STATUSES)[number][]) =>
      currentPayerIndex(statuses.map((status) => ({ status })));
    assert.equal(of('pending', 'pending'), 0);
    assert.equal(of('paid', 'pending'), 1);
    assert.equal(of('denied', 'skipped', 'forwarded'), 2);
    assert.equal(of('paid', 'paid'), -1);
    assert.equal(of(), -1);
  });
});
