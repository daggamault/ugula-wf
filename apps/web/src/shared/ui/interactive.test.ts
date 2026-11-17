import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { focusRingClasses, interactiveClasses } from './interactive.ts';

describe('focusRingClasses', () => {
  it('rings keyboard focus in primary and fades colors over 150ms, without touching the cursor', () => {
    assert.deepEqual(focusRingClasses.split(' '), [
      'focus-visible:outline-primary',
      'outline-2',
      'outline-offset-2',
      'outline-transparent',
      'transition',
      'duration-150',
      'ease-out'
    ]);
  });
});

describe('interactiveClasses', () => {
  it('adds a pointer cursor, and a not-allowed cursor when disabled natively or by aria', () => {
    assert.deepEqual(interactiveClasses.split(' '), [
      ...focusRingClasses.split(' '),
      'cursor-pointer',
      'disabled:cursor-not-allowed',
      'aria-disabled:cursor-not-allowed'
    ]);
  });
});
