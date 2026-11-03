import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { focusRingClasses, interactiveClasses } from './interactive.ts';

describe('interactive classes', () => {
  it('gives every control the same primary focus ring and color transition', () => {
    assert.ok(focusRingClasses.includes('focus-visible:outline-primary'));
    assert.ok(focusRingClasses.includes('outline-2') && focusRingClasses.includes('duration-150'));
    assert.ok(!focusRingClasses.includes('cursor-'));
  });

  it('adds pointer and disabled cursors for clickable elements', () => {
    assert.ok(interactiveClasses.startsWith(focusRingClasses));
    assert.ok(interactiveClasses.includes('cursor-pointer'));
    assert.ok(interactiveClasses.includes('disabled:cursor-not-allowed'));
    assert.ok(interactiveClasses.includes('aria-disabled:cursor-not-allowed'));
  });
});
