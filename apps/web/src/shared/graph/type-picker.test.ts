import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Model, ValueKinds, ValueType } from '@ugula/graph';
import { createElement, useState } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { ValueKindsContext } from './pins.ts';
import {
  freeFieldName,
  kindOptions,
  optionValue,
  TypePicker,
  typeOfOption,
  typeOptions
} from './type-picker.tsx';

const CLAIM: Model = {
  key: 'claim',
  name: 'claim',
  title: 'Claim',
  category: 'Claim',
  description: 'a claim',
  fields: [
    { name: 'total', type: 'number', label: 'Total', description: 'The total.' },
    { name: 'payerId', type: { id: 'payer' }, label: 'Payer', description: 'Who pays.' }
  ]
};

const CLAIM_TYPE: ValueType = {
  object: { total: 'number', payerId: { id: 'payer' } },
  model: 'claim'
};

const kinds: ValueKinds = {
  id: { claim: 'Claim ID' },
  code: { hcpcs: 'HCPCS Code' },
  models: { claim: CLAIM }
};

describe('optionValue and typeOfOption', () => {
  it('round-trip every kind of type the picker offers', () => {
    for (const type of [
      'integer',
      { id: 'claim' },
      { code: 'hcpcs' },
      CLAIM_TYPE,
      { object: {} }
    ] as ValueType[]) {
      assert.deepEqual(typeOfOption(optionValue(type), kinds), type);
    }
  });

  it('knows no type for an unknown model or option', () => {
    assert.equal(typeOfOption('model:quote', kinds), null);
    assert.equal(typeOfOption('nope', kinds), null);
  });
});

describe('typeOptions', () => {
  it('groups basics, records, IDs and codes, with a custom record last', () => {
    assert.deepEqual(
      typeOptions(kinds, false, 'string').map((o) => [o.group, o.label]),
      [
        ['Basics', 'Any Value'],
        ['Basics', 'Text'],
        ['Basics', 'Number'],
        ['Basics', 'Whole Number'],
        ['Basics', 'Yes or No'],
        ['Basics', 'Date and Time'],
        ['Records', 'Claim'],
        ['IDs', 'Claim ID'],
        ['Codes', 'HCPCS Code'],
        ['Advanced', 'Custom Record']
      ]
    );
  });

  it('never offers any value for the type of a field', () => {
    assert.ok(!typeOptions(kinds, true, 'string').some((o) => o.value === 'any'));
  });

  it('keeps an unknown current type so it still shows', () => {
    assert.deepEqual(typeOptions(kinds, false, { code: 'snomed' }).at(-1), {
      value: 'code:snomed',
      label: 'Snomed Code',
      group: 'Advanced'
    });
  });
});

describe('kindOptions', () => {
  it('sorts the kinds by label and keeps an unknown current kind', () => {
    assert.deepEqual(kindOptions({ b: 'Beta', a: 'Alpha' }, 'zed'), [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
      { value: 'zed', label: 'zed' }
    ]);
  });
});

describe('freeFieldName', () => {
  it('numbers a new field after the existing ones, skipping taken names', () => {
    assert.equal(freeFieldName([]), 'field1');
    assert.equal(freeFieldName(['payer']), 'field2');
    assert.equal(freeFieldName(['field2']), 'field3');
  });
});

const show = (initial: ValueType, { isFieldType = false, editable = true } = {}) => {
  const changes: ValueType[] = [];
  const Host = () => {
    const [value, setValue] = useState(initial);
    return createElement(ValueKindsContext.Provider, {
      value: kinds,
      children: createElement(TypePicker, {
        id: 't',
        label: 'Type',
        value,
        editable,
        isFieldType,
        onChange: (next) => {
          changes.push(next);
          setValue(next);
        }
      })
    });
  };
  render(createElement(Host));
  return { changes, user: userEvent.setup() };
};

const shown = (name: string) => screen.getAllByRole('button', { name }).map((b) => b.textContent);

const pick = async (user: ReturnType<typeof userEvent.setup>, option: string) => {
  const [listbox] = screen.getAllByRole('listbox', { name: 'Type' });
  assert.ok(listbox);
  await user.click(within(listbox).getByRole('option', { name: option }));
};

const listBox = () => screen.getAllByRole('checkbox', { name: 'List' })[0] as HTMLInputElement;

describe('TypePicker', () => {
  it('shows the type in plain words', () => {
    show('integer');
    assert.deepEqual(shown('Type'), ['Whole Number']);
    assert.equal(listBox().checked, false);
  });

  it('picks a record by its name, with no fields to fill in', async () => {
    const { changes, user } = show('integer');
    await pick(user, 'Claim');
    assert.deepEqual(changes, [CLAIM_TYPE]);
    assert.deepEqual(shown('Type'), ['Claim']);
    assert.ok(!screen.queryByRole('textbox', { name: 'Field Name' }));
  });

  it('picks an ID or a code set in one step', async () => {
    const { changes, user } = show('string');
    await pick(user, 'Claim ID');
    await pick(user, 'HCPCS Code');
    assert.deepEqual(changes, [{ id: 'claim' }, { code: 'hcpcs' }]);
  });

  it('makes any type a list and back with one tick', async () => {
    const { changes, user } = show(CLAIM_TYPE);
    await user.click(listBox());
    assert.deepEqual(changes[0], { list: CLAIM_TYPE });
    assert.deepEqual(shown('Type'), ['Claim']);
    await pick(user, 'Text');
    assert.deepEqual(changes[1], { list: 'string' });
    await user.click(listBox());
    assert.deepEqual(changes[2], 'string');
  });

  it('builds a custom record field by field', async () => {
    const { changes, user } = show('string');
    await pick(user, 'Custom Record');
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    assert.deepEqual(changes, [{ object: {} }, { object: { field1: 'string' } }]);
    assert.deepEqual(shown('Type'), ['Custom Record', 'Text']);
  });

  it('changes nothing when read-only', () => {
    show({ object: { payer: 'string' } }, { editable: false });
    assert.equal(listBox().disabled, true);
    assert.ok(!screen.queryByRole('button', { name: 'Add Field' }));
  });
});
