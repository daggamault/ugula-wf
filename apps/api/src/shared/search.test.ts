import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { containsPattern, escapeLike, searchText } from './search.ts';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  });

  it('leaves other text alone', () => {
    assert.equal(escapeLike('Blue Cross'), 'Blue Cross');
  });
});

describe('containsPattern', () => {
  it('matches trimmed, lower-cased text literally anywhere in a value', () => {
    assert.equal(containsPattern('  MediCare '), '%medicare%');
    assert.equal(containsPattern('A_1%'), '%a\\_1\\%%');
  });
});

describe('searchText', () => {
  it('is optional and trims', () => {
    assert.equal(v.parse(searchText, undefined), undefined);
    assert.equal(v.parse(searchText, '  aetna '), 'aetna');
  });

  it('takes up to 80 characters', () => {
    assert.equal(v.parse(searchText, 'x'.repeat(80)), 'x'.repeat(80));
    assert.deepEqual(
      v.safeParse(searchText, 'x'.repeat(81)).issues?.map((i) => i.message),
      ['Invalid length: Expected <=80 but received 81']
    );
  });
});
