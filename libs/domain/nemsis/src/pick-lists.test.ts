import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPickList } from './pick-lists.ts';

describe('pick lists', () => {
  it('names the NEMSIS defined and suggested lists', () => {
    assert.ok(isPickList('impression'));
    assert.ok(isPickList('procedure'));
    assert.ok(!isPickList('toString'));
  });
});
