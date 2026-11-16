import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CodeField,
  chosenCodes,
  codeOptions,
  moveCode,
  searchStatus,
  shownCode
} from './code-field.tsx';
import type { CodesClient } from './codes.ts';

const pending = () => new Promise<never>(() => undefined);

const codes: CodesClient = { search: pending, describe: pending };

const render = (value: string[] | string, isMultiple: boolean) =>
  renderToStaticMarkup(
    createElement(CodeField, {
      id: 'field-diagnoses',
      label: 'Diagnoses',
      codeSet: 'icd10cm',
      codeList: 'impression',
      codes,
      isMultiple,
      value,
      onChange: () => undefined
    })
  );

describe('code field', () => {
  it('reads the chosen codes from a text or a text list', () => {
    assert.deepEqual(chosenCodes(['R079', 3, 'I10']), ['R079', 'I10']);
    assert.deepEqual(chosenCodes('R079'), ['R079']);
    assert.deepEqual(chosenCodes(''), []);
    assert.deepEqual(chosenCodes(null), []);
  });

  it('lists the chosen codes first, then matches, each with its meaning', () => {
    const known = [{ code: 'R079', description: 'Chest pain, unspecified', billable: true }];
    const found = [
      { code: 'I10', description: 'Essential (primary) hypertension', billable: true },
      { code: 'R079', description: 'Chest pain, unspecified', billable: true }
    ];
    assert.deepEqual(codeOptions('icd10cm', ['R079', 'Z999'], known, found), [
      { value: 'R079', label: 'Chest pain, unspecified (R07.9)' },
      { value: 'Z999', label: 'Z99.9' },
      { value: 'I10', label: 'Essential (primary) hypertension (I10)' }
    ]);
    assert.equal(shownCode('rxnorm', '1191'), '1191');
  });

  it('moves a code up or down the billing order, never past either end', () => {
    assert.deepEqual(moveCode(['A', 'B', 'C'], 1, -1), ['B', 'A', 'C']);
    assert.deepEqual(moveCode(['A', 'B', 'C'], 1, 1), ['A', 'C', 'B']);
    assert.deepEqual(moveCode(['A', 'B'], 0, -1), ['A', 'B']);
    assert.deepEqual(moveCode(['A', 'B'], 1, 1), ['A', 'B']);
  });

  it('says what the search is doing when it shows no codes', () => {
    assert.equal(searchStatus('', false, undefined), 'Type a code or words from its description');
    assert.equal(searchStatus('chest', true, undefined), 'Searching…');
    assert.equal(searchStatus('zzz', false, undefined), 'No matching codes');
    assert.equal(searchStatus('chest', false, new Error('Offline')), 'Offline');
  });

  it('searches inside one picker and lists several codes in billing order to reorder', () => {
    const one = render(['R079'], true);
    assert.equal(one.match(/role="combobox"/g)?.length, 1);
    assert.ok(one.includes('R07.9') && !one.includes('Diagnoses in order'));
    const two = render(['R079', 'I10'], true);
    assert.ok(two.includes('aria-label="Diagnoses in order"'));
    assert.ok(two.includes('aria-label="Move R07.9 down"'));
    assert.ok(two.includes('aria-label="Move I10 up"'));
    assert.ok(render('R079', false).includes('Choose…'));
  });
});
