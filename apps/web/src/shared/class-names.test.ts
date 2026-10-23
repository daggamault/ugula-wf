import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classNamesOf } from './class-names.ts';

describe('classNamesOf', () => {
  it('joins truthy class names and drops the rest', () => {
    assert.equal(classNamesOf('a', false, 'b', null, undefined, ''), 'a b');
    assert.equal(classNamesOf(), '');
  });
});
