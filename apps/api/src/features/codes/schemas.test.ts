import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CODE_SETS } from '@ugula/billing';
import { PICK_LISTS } from '@ugula/nemsis';
import * as v from 'valibot';
import { CODE_LIMIT, searchCodesQuery } from './schemas.ts';

const issues = (input: unknown) =>
  v.safeParse(searchCodesQuery, input).issues?.map((i) => i.message);

const choices = (values: readonly string[]) => values.map((s) => `"${s}"`).join(' | ');

describe('searchCodesQuery', () => {
  it('takes a code set with trimmed search text', () => {
    assert.deepEqual(v.parse(searchCodesQuery, { set: 'icd10cm', q: ' chest pain ' }), {
      set: 'icd10cm',
      q: 'chest pain'
    });
  });

  it('takes a NEMSIS pick list', () => {
    assert.deepEqual(v.parse(searchCodesQuery, { set: 'snomed', list: 'procedure' }), {
      set: 'snomed',
      list: 'procedure'
    });
  });

  it('splits a list of codes, dropping blanks and repeats', () => {
    assert.deepEqual(v.parse(searchCodesQuery, { set: 'icd10cm', codes: 'R079, I10,,R079' }), {
      set: 'icd10cm',
      codes: ['R079', 'I10']
    });
    assert.deepEqual(v.parse(searchCodesQuery, { set: 'icd10cm', codes: ' , ' }), {
      set: 'icd10cm',
      codes: []
    });
  });

  it('requires a known code set', () => {
    assert.deepEqual(issues({}), ['Invalid key: Expected "set" but received undefined']);
    assert.deepEqual(issues({ set: 'cpt', q: 'x' }), [
      `Invalid type: Expected (${choices(CODE_SETS)}) but received "cpt"`
    ]);
  });

  it('rejects unknown lists, long search text and too many codes', () => {
    assert.deepEqual(issues({ set: 'icd10cm', list: 'vitals' }), [
      `Invalid type: Expected (${choices(PICK_LISTS)}) but received "vitals"`
    ]);
    assert.deepEqual(issues({ set: 'icd10cm', q: 'x'.repeat(81) }), [
      'Invalid length: Expected <=80 but received 81'
    ]);
    const many = Array.from({ length: CODE_LIMIT + 1 }, (_, i) => `A${i}`).join(',');
    assert.deepEqual(issues({ set: 'icd10cm', codes: many }), [
      'Invalid length: Expected <=50 but received 51'
    ]);
  });
});
