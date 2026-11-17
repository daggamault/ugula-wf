import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ValueKinds, ValueType } from '@ugula/graph';
import { createElement, useState } from 'react';
import { render, screen, userEvent, within } from '../testing-dom.ts';
import { ValueKindsContext } from './pins.ts';
import {
  freeFieldName,
  kindOptions,
  shapeOf,
  shapeOptions,
  TypePicker,
  typeFor
} from './type-picker.tsx';

const kinds: ValueKinds = { id: { claim: 'Claim ID' }, code: { hcpcs: 'HCPCS Code' } };
const none: ValueKinds = { id: {}, code: {} };

describe('shapeOf', () => {
  it('names the shape of each kind of type', () => {
    assert.deepEqual(
      [
        shapeOf('integer'),
        shapeOf({ id: 'claim' }),
        shapeOf({ code: 'x' }),
        shapeOf({ list: 'string' }),
        shapeOf({ object: {} })
      ],
      ['integer', 'id', 'code', 'list', 'object']
    );
  });
});

describe('shapeOptions', () => {
  it('offers every value type in plain words, with IDs and codes when there are kinds of them', () => {
    assert.deepEqual(shapeOptions(kinds, false), [
      { value: 'any', label: 'Any Value' },
      { value: 'string', label: 'Text' },
      { value: 'number', label: 'Number' },
      { value: 'integer', label: 'Whole Number' },
      { value: 'boolean', label: 'Yes or No' },
      { value: 'datetime', label: 'Date and Time' },
      { value: 'id', label: 'ID' },
      { value: 'code', label: 'Code' },
      { value: 'list', label: 'List' },
      { value: 'object', label: 'Record' }
    ]);
  });

  it('leaves out IDs and codes without kinds of them', () => {
    assert.deepEqual(
      shapeOptions(none, false).map((o) => o.value),
      ['any', 'string', 'number', 'integer', 'boolean', 'datetime', 'list', 'object']
    );
  });

  it('never offers any value for the type of a field', () => {
    assert.equal(
      shapeOptions(kinds, true).some((o) => o.value === 'any'),
      false
    );
  });
});

describe('typeFor', () => {
  it('builds the type for each shape, starting from the first kind', () => {
    assert.deepEqual(typeFor('id', kinds), { id: 'claim' });
    assert.deepEqual(typeFor('code', kinds), { code: 'hcpcs' });
    assert.deepEqual(typeFor('list', kinds), { list: 'string' });
    assert.deepEqual(typeFor('object', kinds), { object: {} });
    assert.equal(typeFor('boolean', kinds), 'boolean');
  });

  it('falls back to any value for an unknown shape', () => {
    assert.equal(typeFor('nope', kinds), 'any');
  });
});

describe('kindOptions', () => {
  it('sorts the kinds by label and keeps an unknown current kind', () => {
    assert.deepEqual(kindOptions({ z: 'Zulu', a: 'Alpha' }, 'b'), [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'b' },
      { value: 'z', label: 'Zulu' }
    ]);
  });

  it('lists a known current kind once', () => {
    assert.deepEqual(kindOptions({ a: 'Alpha' }, 'a'), [{ value: 'a', label: 'Alpha' }]);
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

const pick = async (user: ReturnType<typeof userEvent.setup>, list: string, option: string) => {
  const [listbox] = screen.getAllByRole('listbox', { name: list });
  assert.ok(listbox);
  await user.click(within(listbox).getByRole('option', { name: option }));
};

describe('TypePicker', () => {
  it('shows the type in plain words', () => {
    show('integer');
    assert.deepEqual(shown('Type'), ['Whole Number']);
    assert.ok(!screen.queryByRole('textbox'));
  });

  it('changes to the type picked', async () => {
    const { changes, user } = show('integer');
    await pick(user, 'Type', 'Yes or No');
    assert.deepEqual(changes, ['boolean']);
    assert.deepEqual(shown('Type'), ['Yes or No']);
  });

  it('never offers any value for the type of a field', () => {
    show('string', { isFieldType: true });
    assert.ok(!screen.queryByRole('option', { name: 'Any Value' }));
  });

  it('asks which kind of ID', async () => {
    const { changes, user } = show('string');
    await pick(user, 'Type', 'ID');
    assert.deepEqual(changes, [{ id: 'claim' }]);
    assert.deepEqual(shown('ID Of'), ['Claim ID']);
  });

  it('asks which code set, keeping an unknown one', async () => {
    const { changes, user } = show({ code: 'snomed' });
    assert.deepEqual(shown('Code Set'), ['snomed']);
    await pick(user, 'Code Set', 'HCPCS Code');
    assert.deepEqual(changes, [{ code: 'hcpcs' }]);
  });

  it('asks what each item of a list is', async () => {
    const { changes, user } = show({ list: 'string' });
    assert.deepEqual(shown('Each Item Is'), ['Text']);
    await pick(user, 'Each Item Is', 'Code');
    assert.deepEqual(changes, [{ list: { code: 'hcpcs' } }]);
    assert.deepEqual(shown('Code Set'), ['HCPCS Code']);
  });

  it('lists the fields of a record by name and type', () => {
    show({ object: { payer: 'string', miles: 'number' } });
    assert.deepEqual(
      screen
        .getAllByRole('textbox', { name: 'Field Name' })
        .map((f) => (f as HTMLInputElement).value),
      ['payer', 'miles']
    );
    assert.deepEqual(shown('Type'), ['Record', 'Text', 'Number']);
  });

  it('adds a text field with a free name', async () => {
    const { changes, user } = show({ object: { payer: 'string' } });
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    assert.deepEqual(changes, [{ object: { payer: 'string', field2: 'string' } }]);
  });

  it('renames a field', async () => {
    const { changes, user } = show({ object: { payer: 'string' } });
    await user.type(screen.getByRole('textbox', { name: 'Field Name' }), 's');
    assert.deepEqual(changes, [{ object: { payers: 'string' } }]);
  });

  it('removes and reorders fields', async () => {
    const { changes, user } = show({ object: { payer: 'string', miles: 'number' } });
    await user.click(screen.getByRole('button', { name: 'Move miles up' }));
    await user.click(screen.getByRole('button', { name: 'Remove payer' }));
    assert.deepEqual(changes, [
      { object: { miles: 'number', payer: 'string' } },
      { object: { miles: 'number' } }
    ]);
  });

  it('offers no field changes when read-only', () => {
    show({ object: { payer: 'string' } }, { editable: false });
    assert.ok(!screen.queryByRole('button', { name: 'Add Field' }));
    assert.ok(!screen.queryByRole('button', { name: 'Remove payer' }));
  });
});
