import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CodeSet } from '@ugula/billing';
import type { Json } from '@ugula/graph';
import { createElement, useState } from 'react';
import type { Code, CodesClient } from '../codes.ts';
import { render, screen, userEvent, waitFor, within } from '../testing-dom.ts';
import {
  CodeField,
  chosenCodes,
  codeLabel,
  codeOptions,
  labelsOf,
  moveCode
} from './code-field.tsx';

const KNOWN: Code[] = [
  { code: 'R079', description: 'Chest pain, unspecified', is_billable: true },
  { code: 'I10', description: 'Essential hypertension', is_billable: true },
  { code: 'R0789', description: 'Other chest pain', is_billable: true }
];

describe('chosenCodes', () => {
  it('reads the chosen codes from a text list, once each and skipping blanks and non-text', () => {
    assert.deepEqual(chosenCodes(['R079', 3, 'I10', 'R079', '']), ['R079', 'I10']);
  });

  it('reads a single code from a text', () => {
    assert.deepEqual(chosenCodes('R079'), ['R079']);
  });

  it('chooses nothing from a blank or another value', () => {
    assert.deepEqual(chosenCodes(''), []);
    assert.deepEqual(chosenCodes(null), []);
    assert.deepEqual(chosenCodes({ code: 'R079' }), []);
  });
});

describe('labelsOf', () => {
  it('maps each code to its description', () => {
    assert.deepEqual(labelsOf(KNOWN.slice(0, 2)), {
      R079: 'Chest pain, unspecified',
      I10: 'Essential hypertension'
    });
  });
});

describe('codeLabel', () => {
  const labels = labelsOf(KNOWN);

  it('shows a code with its meaning, dotting ICD-10 codes', () => {
    assert.deepEqual(codeLabel('icd10cm', labels, 'R079'), {
      text: 'Chest pain, unspecified',
      code: 'R07.9'
    });
  });

  it('shows the code alone before its meaning is known', () => {
    assert.deepEqual(codeLabel('icd10cm', labels, 'Z999'), { text: 'Z99.9', code: null });
    assert.deepEqual(codeLabel('hcpcs', {}, 'A0427'), { text: 'A0427', code: null });
  });
});

describe('codeOptions', () => {
  it('offers each code once, labelled with its meaning', () => {
    assert.deepEqual(codeOptions('icd10cm', ['R079', 'Z999', 'R079'], labelsOf(KNOWN)), [
      { value: 'R079', label: 'Chest pain, unspecified', code: 'R07.9' },
      { value: 'Z999', label: 'Z99.9', code: null }
    ]);
  });
});

describe('moveCode', () => {
  it('swaps a code with its neighbor up or down the billing order', () => {
    assert.deepEqual(moveCode(['A', 'B', 'C'], 1, -1), ['B', 'A', 'C']);
    assert.deepEqual(moveCode(['A', 'B', 'C'], 1, 1), ['A', 'C', 'B']);
  });

  it('never moves a code past either end', () => {
    assert.deepEqual(moveCode(['A', 'B'], 0, -1), ['A', 'B']);
    assert.deepEqual(moveCode(['A', 'B'], 1, 1), ['A', 'B']);
  });
});

const fakeCodes = () => {
  const searches: [CodeSet, string, string | null][] = [];
  const described: [CodeSet, string[]][] = [];
  const codes: CodesClient = {
    search: async (set, q, list) => {
      searches.push([set, q, list]);
      return KNOWN.filter((c) => (q ? c.description.toLowerCase().includes(q) : true));
    },
    describe: async (set, wanted) => {
      described.push([set, [...wanted]]);
      return KNOWN.filter((c) => wanted.includes(c.code));
    }
  };
  return { codes, searches, described };
};

const show = (
  initial: Json,
  {
    isMultiple = true,
    codeList = null,
    codes = fakeCodes().codes
  }: { isMultiple?: boolean; codeList?: string | null; codes?: CodesClient } = {}
) => {
  const changes: Json[] = [];
  const Host = () => {
    const [value, setValue] = useState<Json>(initial);
    return createElement(CodeField, {
      id: 'field-diagnoses',
      label: 'Diagnoses',
      codeSet: 'icd10cm',
      codeList,
      codes,
      isMultiple,
      value,
      onChange: (next) => {
        changes.push(next);
        setValue(next);
      }
    });
  };
  render(createElement(Host));
  return { changes, user: userEvent.setup() };
};

const trigger = () => screen.getByRole('button', { name: 'Diagnoses' });

const options = () =>
  within(screen.getByRole('listbox', { name: 'Diagnoses' }))
    .queryAllByRole('option')
    .map((o) => o.textContent);

const ordered = () =>
  within(screen.getByRole('list', { name: 'Diagnoses in order' }))
    .getAllByRole('listitem')
    .map((li) => li.firstElementChild?.nextElementSibling?.textContent);

describe('CodeField choosing one code', () => {
  it('shows the chosen code with the meaning it looks up', async () => {
    const { codes, described } = fakeCodes();
    show('R079', { isMultiple: false, codes });
    await waitFor(() => assert.equal(trigger().textContent, 'Chest pain, unspecified R07.9'));
    assert.deepEqual(described[0], ['icd10cm', ['R079']]);
    assert.ok(!screen.queryByRole('list', { name: 'Diagnoses in order' }));
  });

  it('asks to choose a code while none is chosen', () => {
    show(null, { isMultiple: false });
    assert.equal(trigger().textContent, 'Choose…');
  });

  it('searches codes by what is typed and chooses one', async () => {
    const { codes, searches } = fakeCodes();
    const { changes, user } = show(null, { isMultiple: false, codes });
    await user.type(screen.getByRole('combobox', { name: 'Search Diagnoses' }), 'chest');
    await waitFor(() =>
      assert.deepEqual(options(), ['Chest pain, unspecified R07.9', 'Other chest pain R07.89'])
    );
    assert.deepEqual(searches, [['icd10cm', 'chest', null]]);
    await user.click(screen.getByRole('option', { name: 'Other chest pain R07.89' }));
    assert.deepEqual(changes, ['R0789']);
    assert.equal(trigger().textContent, 'Other chest pain R07.89');
  });

  it('prompts for a search and looks nothing up before one', async () => {
    const { codes, searches } = fakeCodes();
    show(null, { isMultiple: false, codes });
    await waitFor(() =>
      assert.equal(
        screen.getByRole('status').textContent,
        'Type a code or words from its description'
      )
    );
    assert.deepEqual(searches, []);
    assert.deepEqual(options(), []);
  });

  it("suggests the code list's codes before a search, after the chosen one", async () => {
    const { codes, searches } = fakeCodes();
    show('I10', { isMultiple: false, codeList: 'impression', codes });
    await waitFor(() =>
      assert.deepEqual(options(), [
        'Essential hypertension I10',
        'Chest pain, unspecified R07.9',
        'Other chest pain R07.89'
      ])
    );
    assert.deepEqual(searches, [['icd10cm', '', 'impression']]);
  });
});

describe('CodeField choosing several codes', () => {
  it('lists the chosen codes in billing order with their meanings', async () => {
    show(['R079', 'I10']);
    await waitFor(() =>
      assert.deepEqual(ordered(), ['Chest pain, unspecified R07.9', 'Essential hypertension I10'])
    );
    assert.equal(trigger().textContent, 'Add a code');
  });

  it('adds a code found by searching to the end of the order', async () => {
    const { changes, user } = show(['R079']);
    await user.type(screen.getByRole('combobox', { name: 'Search Diagnoses' }), 'hyper');
    await user.click(await screen.findByRole('option', { name: 'Essential hypertension I10' }));
    assert.deepEqual(changes, [['R079', 'I10']]);
    assert.deepEqual(ordered(), ['Chest pain, unspecified R07.9', 'Essential hypertension I10']);
  });

  it('moves a code down the order, says so and keeps focus on the moved code', async () => {
    const { changes, user } = show(['R079', 'I10']);
    await user.click(screen.getByRole('button', { name: 'Move R07.9 down' }));
    assert.deepEqual(changes, [['I10', 'R079']]);
    await waitFor(() =>
      assert.deepEqual(ordered(), ['Essential hypertension I10', 'Chest pain, unspecified R07.9'])
    );
    assert.equal(screen.getByText('R07.9 moved to 2').getAttribute('role'), 'status');
    assert.ok(document.activeElement === screen.getByRole('button', { name: 'Move R07.9 down' }));
  });

  it('cannot move the first code up or the last code down', async () => {
    const { changes, user } = show(['R079', 'I10']);
    const up = screen.getByRole('button', { name: 'Move R07.9 up', description: 'Already first.' });
    const down = screen.getByRole('button', {
      name: 'Move I10 down',
      description: 'Already last.'
    });
    await user.click(up);
    await user.click(down);
    assert.deepEqual(changes, []);
  });

  it('removes a code, says so and returns focus to the picker', async () => {
    const { changes, user } = show(['R079', 'I10']);
    await user.click(screen.getByRole('button', { name: 'Remove I10' }));
    assert.deepEqual(changes, [['R079']]);
    assert.equal(screen.getByText('I10 removed').getAttribute('role'), 'status');
    assert.ok(document.activeElement === trigger());
  });

  it('drops the order list once the last code is removed', async () => {
    const { user } = show(['R079']);
    await user.click(screen.getByRole('button', { name: 'Remove R07.9' }));
    assert.ok(!screen.queryByRole('list', { name: 'Diagnoses in order' }));
  });
});
