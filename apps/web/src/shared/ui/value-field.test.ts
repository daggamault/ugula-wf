import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json, ValueType } from '@ugula/graph';
import { createElement, useState } from 'react';
import { ValueKindsContext } from '../graph/pins.ts';
import { render, screen, userEvent, waitFor, within } from '../testing-dom.ts';
import { anyKindOf, JsonField, linesOf, ValueField } from './value-field.tsx';

type Props = Parameters<typeof ValueField>[0];

const showField = (type: ValueType, value: Json, props: Partial<Props> = {}) => {
  const changes: Json[] = [];
  const Host = () => {
    const [current, setCurrent] = useState<Json>(value);
    return createElement(ValueField, {
      id: 'f',
      label: 'Field',
      type,
      ...props,
      value: current,
      onChange: (next: Json) => {
        changes.push(next);
        setCurrent(next);
      }
    });
  };
  render(createElement(Host));
  return { changes, user: userEvent.setup() };
};

const textbox = (name = 'Field') => screen.getByRole<HTMLInputElement>('textbox', { name });
const spinbutton = (name = 'Field') => screen.getByRole<HTMLInputElement>('spinbutton', { name });

describe('ValueField yes or no', () => {
  it('is a checkbox named by a clickable label', () => {
    showField('boolean', true);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Field' });
    assert.equal(box.checked, true);
    assert.ok(box.closest('label')?.classList.contains('cursor-pointer'));
  });

  it('is unchecked for anything but true', () => {
    showField('boolean', 'true');
    assert.equal(screen.getByRole<HTMLInputElement>('checkbox').checked, false);
  });

  it('reports each toggle', async () => {
    const { changes, user } = showField('boolean', null);
    await user.click(screen.getByText('Field'));
    await user.click(screen.getByRole('checkbox', { name: 'Field' }));
    assert.deepEqual(changes, [true, false]);
  });
});

describe('ValueField numbers', () => {
  it('takes whole numbers in steps of one with a numeric keypad', () => {
    showField('integer', 3);
    const input = spinbutton();
    assert.equal(input.value, '3');
    assert.equal(input.getAttribute('step'), '1');
    assert.equal(input.getAttribute('inputmode'), 'numeric');
  });

  it('takes any decimal with a decimal keypad, blank when the value is not a number', () => {
    showField('number', '12');
    const input = spinbutton();
    assert.equal(input.value, '');
    assert.equal(input.getAttribute('step'), 'any');
    assert.equal(input.getAttribute('inputmode'), 'decimal');
  });

  it('is bounded by min and max', () => {
    showField('number', null, { min: 0, max: 500 });
    assert.equal(spinbutton().min, '0');
    assert.equal(spinbutton().max, '500');
  });

  it('reports typed numbers, and null once cleared', async () => {
    const { changes, user } = showField('number', null);
    await user.type(spinbutton(), '4.5');
    await user.clear(spinbutton());
    assert.deepEqual(changes, [4, 4.5, null]);
  });
});

describe('ValueField text', () => {
  it('shows text values without a hint, and blank for anything else', () => {
    showField('string', 3);
    assert.equal(textbox().value, '');
    assert.equal(textbox().getAttribute('aria-describedby'), null);
  });

  it('reports typed text, and null once cleared', async () => {
    const { changes, user } = showField('string', 'a');
    await user.type(textbox(), 'b');
    await user.clear(textbox());
    assert.deepEqual(changes, ['ab', null]);
  });

  it('describes an id or code by its kind', () => {
    showField({ id: 'claim' }, 'c1');
    assert.equal(textbox().value, 'c1');
    screen.getByRole('textbox', { name: 'Field', description: 'Claim ID' });
  });

  it('describes a kind by its registered name', () => {
    render(
      createElement(
        ValueKindsContext,
        { value: { id: {}, code: { icd10: 'Diagnosis Code' } } },
        createElement(ValueField, {
          id: 'f',
          label: 'Field',
          type: { code: 'icd10' },
          value: null,
          onChange: () => undefined
        })
      )
    );
    screen.getByRole('textbox', { name: 'Field', description: 'Diagnosis Code' });
  });

  it('is required on request', () => {
    showField('string', null, { isRequired: true });
    assert.equal(textbox().required, true);
  });

  it('is marked invalid and described by an error', () => {
    showField('string', null, { error: 'Required' });
    assert.equal(textbox().getAttribute('aria-invalid'), 'true');
    screen.getByRole('textbox', { name: 'Field', description: 'Required' });
  });
});

describe('ValueField dates', () => {
  it('offers a date picker for date text', async () => {
    const { changes, user } = showField('string', '2026-01-02', { format: 'date' });
    const input = screen.getByLabelText<HTMLInputElement>('Field');
    assert.equal(input.type, 'date');
    assert.equal(input.value, '2026-01-02');
    await user.clear(input);
    assert.deepEqual(changes, [null]);
  });

  it('shows a date and time to the minute in UTC', () => {
    showField('datetime', '2026-01-02T03:04:05.000Z');
    const input = screen.getByLabelText<HTMLInputElement>('Field');
    assert.equal(input.type, 'datetime-local');
    assert.equal(input.value, '2026-01-02T03:04');
    assert.equal(input.getAttribute('aria-describedby'), 'f-hint');
    assert.equal(document.getElementById('f-hint')?.textContent, 'UTC');
  });

  it('reports a picked date and time as a UTC timestamp, and null once cleared', async () => {
    const { changes, user } = showField('datetime', null);
    const input = screen.getByLabelText<HTMLInputElement>('Field');
    await user.type(input, '2026-01-02T03:04');
    await user.clear(input);
    assert.deepEqual(changes.slice(-2), ['2026-01-02T03:04:00.000Z', null]);
  });
});

describe('ValueField choices', () => {
  const options = [
    { value: 'then', label: 'Then' },
    { value: 'failed', label: 'Failed' }
  ];

  it('offers the options after a blank choice, showing the chosen one', () => {
    showField('string', 'failed', { options });
    assert.equal(screen.getByRole('button', { name: 'Field' }).textContent, 'Failed');
    assert.deepEqual(
      screen.getAllByRole('option', { hidden: true }).map((o) => o.textContent),
      ['Choose…', 'Then', 'Failed']
    );
  });

  it('reports a chosen option, and null for the blank choice', async () => {
    const { changes, user } = showField('string', 'failed', { options });
    await user.click(screen.getByRole('option', { name: 'Then', hidden: true }));
    await user.click(screen.getByRole('option', { name: 'Choose…', hidden: true }));
    assert.deepEqual(changes, ['then', null]);
  });

  it('shows the blank choice for a value that is not text', () => {
    showField('string', 3, { options });
    assert.deepEqual(
      screen.getAllByRole('option', { selected: true, hidden: true }).map((o) => o.textContent),
      ['Choose…']
    );
  });
});

describe('ValueField text lists', () => {
  it('edits text lists one per line', () => {
    showField({ list: 'string' }, ['R07.9', 3, 'I10']);
    const area = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Field',
      description: 'One per line.'
    });
    assert.equal(area.value, 'R07.9\nI10');
  });

  it('treats lists of codes as text lists', () => {
    showField({ list: { code: 'icd10' } }, ['I10']);
    assert.equal(screen.getByRole<HTMLTextAreaElement>('textbox').value, 'I10');
  });

  it('starts blank for a value that is not a list', () => {
    showField({ list: 'string' }, 'I10');
    assert.equal(screen.getByRole<HTMLTextAreaElement>('textbox').value, '');
  });

  it('reports the trimmed, non-blank lines', async () => {
    const { changes, user } = showField({ list: 'string' }, []);
    await user.type(screen.getByRole('textbox'), ' R07.9 {Enter}{Enter}I10');
    assert.deepEqual(changes.at(-1), ['R07.9', 'I10']);
  });

  it('is required on request', () => {
    showField({ list: 'string' }, [], { isRequired: true });
    assert.equal(screen.getByRole<HTMLTextAreaElement>('textbox').required, true);
  });
});

describe('ValueField item lists', () => {
  it('groups one field per item under the label', () => {
    showField({ list: 'number' }, [1, 2]);
    const group = screen.getByRole('group', { name: 'Field' });
    assert.deepEqual(
      within(group)
        .getAllByRole<HTMLInputElement>('spinbutton')
        .map((input) => [input.id, input.value]),
      [
        ['f-0', '1'],
        ['f-1', '2']
      ]
    );
    within(group).getByRole('spinbutton', { name: 'Item 2' });
  });

  it('edits an item in place', async () => {
    const { changes, user } = showField({ list: 'number' }, [1, 2]);
    await user.type(spinbutton('Item 2'), '0');
    assert.deepEqual(changes, [[1, 20]]);
  });

  it('adds a blank item and removes items', async () => {
    const { changes, user } = showField({ list: 'number' }, [1, 2]);
    await user.click(screen.getByRole('button', { name: 'Add Item' }));
    await user.click(screen.getByRole('button', { name: 'Remove Item 1' }));
    assert.deepEqual(changes, [
      [1, 2, null],
      [2, null]
    ]);
  });

  it('starts empty for a value that is not a list', () => {
    showField({ list: 'number' }, 5);
    assert.equal(screen.queryAllByRole('spinbutton').length, 0);
  });

  it('cannot add, move or remove items when not editable', () => {
    showField({ list: { list: 'number' } }, [[1]], { editable: false });
    assert.equal(screen.queryAllByRole('button').length, 0);
    spinbutton('Item 1');
  });
});

describe('ValueField records', () => {
  const type: ValueType = { object: { payerName: 'string', paid: 'boolean' } };

  it('groups one labelled field per member', () => {
    showField(type, { payerName: 'Aetna' });
    const group = screen.getByRole('group', { name: 'Field' });
    const name = within(group).getByRole<HTMLInputElement>('textbox', { name: 'Payer Name' });
    assert.equal(name.id, 'f-payerName');
    assert.equal(name.value, 'Aetna');
    const paid = within(group).getByRole<HTMLInputElement>('checkbox', { name: 'Paid' });
    assert.equal(paid.id, 'f-paid');
    assert.equal(paid.checked, false);
  });

  it('reports the whole record when one member changes', async () => {
    const { changes, user } = showField(type, { payerName: 'Aetna', extra: 1 });
    await user.click(screen.getByRole('checkbox', { name: 'Paid' }));
    assert.deepEqual(changes, [{ payerName: 'Aetna', extra: 1, paid: true }]);
  });

  it('starts from an empty record for a value that is not one', async () => {
    const { changes, user } = showField(type, [1]);
    assert.equal(textbox('Payer Name').value, '');
    await user.click(screen.getByRole('checkbox', { name: 'Paid' }));
    assert.deepEqual(changes, [{ paid: true }]);
  });

  it('removes nested structure controls when not editable', () => {
    showField({ object: { codes: { list: 'number' } } }, { codes: [1] }, { editable: false });
    spinbutton('Item 1');
    assert.equal(screen.queryAllByRole('button').length, 0);
  });

  it('edits an open record as JSON described as a record', () => {
    showField({ object: {} }, { a: 1 });
    const area = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Field',
      description: 'Record'
    });
    assert.equal(area.value, '{\n  "a": 1\n}');
  });
});

describe('ValueField any value', () => {
  const kindTrigger = () => screen.getByRole('button', { name: 'Kind of Value' });

  it('starts on the kind that fits the value', () => {
    showField('any', 3);
    assert.equal(screen.getByRole('group', { name: 'Field' }).tagName, 'FIELDSET');
    assert.equal(kindTrigger().textContent, 'Number');
    assert.equal(spinbutton('Value').value, '3');
  });

  it('labels a yes or no value Yes', () => {
    showField('any', false);
    assert.equal(kindTrigger().textContent, 'Yes or No');
    screen.getByRole('checkbox', { name: 'Yes' });
  });

  it('edits lists and records as JSON', () => {
    showField('any', [1]);
    assert.equal(kindTrigger().textContent, 'JSON');
    assert.equal(textbox('JSON').value, '[\n  1\n]');
  });

  it('clears the value when switching to a kind it does not fit', async () => {
    const { changes, user } = showField('any', 'hello');
    await user.click(screen.getByRole('option', { name: 'Number', hidden: true }));
    assert.equal(spinbutton('Value').value, '');
    await user.click(screen.getByRole('option', { name: 'Yes or No', hidden: true }));
    assert.deepEqual(changes, [null, false]);
  });

  it('keeps the value when switching to JSON or to a kind it fits', async () => {
    const { changes, user } = showField('any', 'hello');
    await user.click(screen.getByRole('option', { name: 'JSON', hidden: true }));
    assert.equal(textbox('JSON').value, '"hello"');
    await user.click(screen.getByRole('option', { name: 'Text', hidden: true }));
    assert.equal(textbox('Value').value, 'hello');
    assert.deepEqual(changes, ['hello', 'hello']);
  });
});

describe('ValueField files', () => {
  const file: ValueType = { object: { bucket: 'string', key: 'string' } };
  const pdf = new File(['%PDF'], 'remit.pdf', { type: 'application/pdf' });

  const showUpload = (upload: (f: File) => Promise<{ file: Json; name: string }>) => {
    const field = showField(file, null, { label: 'Remit', upload });
    return { ...field, picker: screen.getByLabelText<HTMLInputElement>('Remit') };
  };

  it('offers a file picker when the field can upload', () => {
    const { picker } = showUpload(async () => ({ file: null, name: '' }));
    assert.equal(picker.type, 'file');
    assert.equal(picker.disabled, false);
    assert.equal(document.getElementById('f-hint')?.textContent, 'Choose a file to upload.');
  });

  it('edits a file as a plain record when the field cannot upload', () => {
    showField(file, null);
    textbox('Bucket');
    textbox('Key');
    assert.ok(!document.querySelector('input[type="file"]'));
  });

  it('locks the picker while uploading, then reports the stored file', async () => {
    let finish: (value: { file: Json; name: string }) => void = () => undefined;
    const sent: string[] = [];
    const { picker, changes, user } = showUpload((f) => {
      sent.push(f.name);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await user.upload(picker, pdf);
    assert.equal(picker.disabled, true);
    assert.equal(document.getElementById('f-hint')?.textContent, 'Uploading…');
    finish({ file: { bucket: 'b', key: 'k' }, name: 'remit.pdf' });
    await waitFor(() => assert.equal(picker.disabled, false));
    assert.equal(document.getElementById('f-hint')?.textContent, 'Uploaded remit.pdf');
    assert.deepEqual(sent, ['remit.pdf']);
    assert.deepEqual(changes, [{ bucket: 'b', key: 'k' }]);
  });

  it('shows why an upload failed and clears the value', async () => {
    const { picker, changes, user } = showUpload(async () => {
      throw new Error('Too large.');
    });
    await user.upload(picker, pdf);
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Too large.'));
    assert.equal(picker.getAttribute('aria-invalid'), 'true');
    assert.equal(picker.getAttribute('aria-describedby'), 'f-error');
    assert.deepEqual(changes, [null]);
  });

  it('shows a thrown non-error as text', async () => {
    const { picker, user } = showUpload(() => Promise.reject('offline'));
    await user.upload(picker, pdf);
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'offline'));
  });

  it('clears a failure on the next upload', async () => {
    let attempt = 0;
    const { picker, user } = showUpload(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Too large.');
      return { file: { bucket: 'b', key: 'k' }, name: 'small.pdf' };
    });
    await user.upload(picker, pdf);
    await waitFor(() => screen.getByRole('alert'));
    await user.upload(picker, new File(['%PDF'], 'small.pdf', { type: 'application/pdf' }));
    await waitFor(() =>
      assert.equal(document.getElementById('f-hint')?.textContent, 'Uploaded small.pdf')
    );
    assert.ok(!screen.queryByRole('alert'));
  });

  it('shows the field error on the picker', () => {
    const { picker } = showUpload(async () => ({ file: null, name: '' }));
    assert.equal(picker.getAttribute('aria-invalid'), null);
    render(
      createElement(ValueField, {
        id: 'g',
        label: 'Proof',
        type: file,
        value: null,
        error: 'Required',
        upload: async () => ({ file: null, name: '' }),
        onChange: () => undefined
      })
    );
    assert.equal(screen.getByLabelText('Proof').getAttribute('aria-invalid'), 'true');
    assert.equal(screen.getByRole('alert').textContent, 'Required');
  });
});

describe('JsonField', () => {
  const showJson = (value: Json, props: Partial<Parameters<typeof JsonField>[0]> = {}) => {
    const changes: Json[] = [];
    const view = render(
      createElement(JsonField, {
        id: 'j',
        label: 'Settings',
        value,
        onChange: (next) => changes.push(next),
        ...props
      })
    );
    const area = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Settings' });
    return { ...view, area, changes, user: userEvent.setup() };
  };

  it('shows formatted JSON in monospace', () => {
    const { area } = showJson({ expression: '1' });
    assert.equal(area.value, '{\n  "expression": "1"\n}');
    assert.ok(area.classList.contains('font-mono'));
  });

  it('starts blank for null', () => {
    assert.equal(showJson(null).area.value, '');
  });

  it('is locked when disabled', () => {
    assert.equal(showJson({}, { disabled: true }).area.disabled, true);
  });

  it('is described by its hint', () => {
    showJson({}, { hint: 'Record' });
    screen.getByRole('textbox', { name: 'Settings', description: 'Record' });
  });

  it('reports valid JSON as it is typed', async () => {
    const { area, changes, user } = showJson(null);
    await user.click(area);
    await user.paste('[1, 2]');
    assert.deepEqual(changes, [[1, 2]]);
  });

  it('reports null once cleared', async () => {
    const { area, changes, user } = showJson({ a: 1 });
    await user.clear(area);
    assert.deepEqual(changes, [null]);
  });

  it('flags invalid JSON without reporting it, keeping what was typed', async () => {
    const { area, changes, user } = showJson(null, { error: 'Required' });
    await user.click(area);
    await user.paste('[1,');
    assert.deepEqual(changes, []);
    assert.equal(area.value, '[1,');
    assert.equal(area.getAttribute('aria-invalid'), 'true');
    assert.equal(screen.getByRole('alert').textContent, 'This is not valid JSON yet.');
  });

  it('shows the field error while the JSON is valid', () => {
    showJson(null, { error: 'Required' });
    assert.equal(screen.getByRole('alert').textContent, 'Required');
  });

  it('keeps the typed layout while it matches the value', async () => {
    const { area, rerender, user } = showJson(null);
    await user.click(area);
    await user.paste('[1,2]');
    rerender(
      createElement(JsonField, {
        id: 'j',
        label: 'Settings',
        value: [1, 2],
        onChange: () => undefined
      })
    );
    assert.equal(area.value, '[1,2]');
  });

  it('shows a new value given from outside', () => {
    const { area, rerender } = showJson({ a: 1 });
    rerender(
      createElement(JsonField, {
        id: 'j',
        label: 'Settings',
        value: { a: 2 },
        onChange: () => undefined
      })
    );
    assert.equal(area.value, '{\n  "a": 2\n}');
  });
});

describe('anyKindOf', () => {
  it('treats null and text as text, and lists and records as JSON', () => {
    assert.deepEqual(
      [null, 'a', 2, false, {}, []].map((v) => anyKindOf(v)),
      ['string', 'string', 'number', 'boolean', 'json', 'json']
    );
  });
});

describe('linesOf', () => {
  it('reads one trimmed value per line, dropping blank lines', () => {
    assert.deepEqual(linesOf(' R07.9 \n\n  \nI10\n'), ['R07.9', 'I10']);
  });

  it('reads nothing from blank text', () => {
    assert.deepEqual(linesOf(''), []);
  });
});
