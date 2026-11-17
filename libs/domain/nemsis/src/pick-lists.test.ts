import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPickList, PICK_LISTS } from './pick-lists.ts';

describe('pick lists', () => {
  it('names the NEMSIS defined and suggested lists', () => {
    for (const list of PICK_LISTS) assert.equal(isPickList(list), true, list);
    assert.equal(isPickList('toString'), false);
    assert.equal(isPickList('Impression'), false);
    assert.equal(isPickList(null), false);
  });
});
