import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CodesClient } from '../codes.ts';
import {
  CodeField,
  chosenCodes,
  codeLabel,
  codeOptions,
  labelsOf,
  moveCode
} from './code-field.tsx';

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
  it('reads the chosen codes from a text or a text list, once each', () => {
    assert.deepEqual(chosenCodes(['R079', 3, 'I10', 'R079', '']), ['R079', 'I10']);
    assert.deepEqual(chosenCodes('R079'), ['R079']);
    assert.deepEqual(chosenCodes(''), []);
    assert.deepEqual(chosenCodes(null), []);
  });

  it('shows each code with its meaning, or the code alone before it is known', () => {
    const labels = labelsOf([
      { code: 'R079', description: 'Chest pain, unspecified', is_billable: true }
    ]);
    assert.equal(codeLabel('icd10cm', labels, 'R079'), 'Chest pain, unspecified (R07.9)');
    assert.equal(codeLabel('icd10cm', labels, 'Z999'), 'Z99.9');
    assert.deepEqual(codeOptions('icd10cm', ['R079', 'Z999', 'R079'], labels), [
      { value: 'R079', label: 'Chest pain, unspecified (R07.9)' },
      { value: 'Z999', label: 'Z99.9' }
    ]);
  });

  it('moves a code up or down the billing order, never past either end', () => {
    assert.deepEqual(moveCode(['A', 'B', 'C'], 1, -1), ['B', 'A', 'C']);
    assert.deepEqual(moveCode(['A', 'B', 'C'], 1, 1), ['A', 'C', 'B']);
    assert.deepEqual(moveCode(['A', 'B'], 0, -1), ['A', 'B']);
    assert.deepEqual(moveCode(['A', 'B'], 1, 1), ['A', 'B']);
  });

  it('searches inside one picker and lists the chosen codes in billing order to reorder or remove', () => {
    const one = render(['R079'], true);
    assert.equal(one.match(/role="combobox"/g)?.length, 1);
    assert.ok(one.includes('aria-label="Diagnoses in order"'));
    assert.ok(one.includes('>Add a code<'));
    assert.ok(one.includes('aria-label="Remove R07.9"'));
    const two = render(['R079', 'I10'], true);
    assert.ok(two.includes('id="field-diagnoses-R079-down"'));
    assert.ok(two.includes('aria-label="Move I10 up"'));
    assert.ok(two.includes('role="status"'));
    const single = render('R079', false);
    assert.ok(single.includes('R07.9') && !single.includes('in order'));
  });
});
