import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { containsPattern, escapeLike, searchText } from './search.ts';

describe('search', () => {
  it('matches user text literally anywhere in a value', () => {
    assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
    assert.equal(containsPattern('  MediCare '), '%medicare%');
    assert.equal(v.parse(searchText, '  aetna '), 'aetna');
    assert.equal(v.safeParse(searchText, 'x'.repeat(81)).success, false);
  });
});
