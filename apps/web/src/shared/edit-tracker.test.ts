import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEditTracker } from './edit-tracker.ts';

describe('createEditTracker', () => {
  it('tells whether anything was edited since a save was sent', () => {
    const tracker = createEditTracker();
    const quiet = tracker.mark();
    assert.equal(quiet(), true);
    const busy = tracker.mark();
    tracker.edit();
    assert.equal(busy(), false);
    assert.equal(tracker.mark()(), true);
  });
});
