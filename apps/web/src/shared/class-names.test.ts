import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classNamesOf } from './class-names.ts';

describe('classNamesOf', () => {
  it('joins the class names with single spaces in the order given', () => {
    assert.equal(
      classNamesOf('button', 'button-primary', 'is-busy'),
      'button button-primary is-busy'
    );
  });

  it('drops false, null, undefined and empty class names', () => {
    assert.equal(classNamesOf('a', false, 'b', null, undefined, ''), 'a b');
  });

  it('gives an empty string when no class name is kept', () => {
    assert.equal(classNamesOf(), '');
    assert.equal(classNamesOf(false, null, undefined, ''), '');
  });
});
