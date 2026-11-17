import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isUuid } from './ids.ts';

describe('isUuid', () => {
  it('accepts canonical UUIDs in either case', () => {
    assert.equal(isUuid('0195f2a4-0000-7000-8000-000000000001'), true);
    assert.equal(isUuid('0195F2A4-0000-7000-8000-00000000000A'), true);
  });

  it('rejects anything a uuid cast would fail on', () => {
    for (const id of [
      '',
      'new',
      '0195f2a4-0000-7000-8000-000000000001x',
      ' 0195f2a4-0000-7000-8000-000000000001',
      '0195f2a400007000800000000000000001',
      '{0195f2a4-0000-7000-8000-000000000001}',
      '0195f2a4-0000-7000-8000-00000000000g'
    ]) {
      assert.equal(isUuid(id), false, id);
    }
  });
});
