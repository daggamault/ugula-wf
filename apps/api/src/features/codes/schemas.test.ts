import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { CODE_LIMIT, searchCodesQuery } from './schemas.ts';

describe('searchCodesQuery', () => {
  it('takes a code set with search text, a NEMSIS pick list or a list of codes', () => {
    assert.deepEqual(v.parse(searchCodesQuery, { set: 'icd10cm', q: ' chest pain ' }), {
      set: 'icd10cm',
      q: 'chest pain'
    });
    assert.deepEqual(v.parse(searchCodesQuery, { set: 'snomed', list: 'procedure' }), {
      set: 'snomed',
      list: 'procedure'
    });
    assert.deepEqual(v.parse(searchCodesQuery, { set: 'icd10cm', codes: 'R079, I10,,R079' }), {
      set: 'icd10cm',
      codes: ['R079', 'I10']
    });
  });

  it('rejects unknown sets and lists, and too many codes', () => {
    const ok = (input: unknown) => v.safeParse(searchCodesQuery, input).success;
    assert.equal(ok({ set: 'cpt', q: 'x' }), false);
    assert.equal(ok({ set: 'icd10cm', list: 'vitals' }), false);
    const many = Array.from({ length: CODE_LIMIT + 1 }, (_, i) => `A${i}`).join(',');
    assert.equal(ok({ set: 'icd10cm', codes: many }), false);
  });
});
