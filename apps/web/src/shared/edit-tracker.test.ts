import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEditTracker } from './edit-tracker.ts';

describe('createEditTracker', () => {
  it('reports no edits since a mark when nothing was edited', () => {
    const tracker = createEditTracker();
    const unchanged = tracker.mark();
    assert.equal(unchanged(), true);
  });

  it('reports an edit made after a mark', () => {
    const tracker = createEditTracker();
    const unchanged = tracker.mark();
    tracker.edit();
    assert.equal(unchanged(), false);
  });

  it('ignores edits made before a mark', () => {
    const tracker = createEditTracker();
    tracker.edit();
    tracker.edit();
    assert.equal(tracker.mark()(), true);
  });

  it('keeps each mark independent of later marks', () => {
    const tracker = createEditTracker();
    const first = tracker.mark();
    tracker.edit();
    const second = tracker.mark();
    assert.deepEqual([first(), second()], [false, true]);
    tracker.edit();
    assert.deepEqual([first(), second()], [false, false]);
  });
});
