import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json, ValueType } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { anyKindOf, JsonField, linesOf, ValueField } from './value-field.tsx';

const render = (type: ValueType, value: Json) =>
  renderToStaticMarkup(
    createElement(ValueField, { id: 'f', label: 'Field', type, value, onChange: () => undefined })
  );

describe('ValueField', () => {
  it('picks a control that fits the value type', () => {
    const toggle = render('boolean', true);
    assert.ok(toggle.includes('type="checkbox"') && toggle.includes('checked=""'));
    assert.match(
      toggle,
      /<label for="f" class="[^"]*cursor-pointer[^"]*"><input type="checkbox"[^>]*id="f"/
    );
    assert.ok(!render('boolean', null).includes('checked=""'));
    const integer = render('integer', 3);
    assert.ok(integer.includes('step="1"') && integer.includes('inputMode="numeric"'));
    const number = render('number', null);
    assert.ok(number.includes('type="number"') && number.includes('step="any"'));
    assert.ok(number.includes('inputMode="decimal"') && number.includes('value=""'));
    assert.ok(render('string', 'abc').includes('value="abc"'));
    assert.ok(render('string', 3).includes('value=""'));
    const when = render('datetime', '2026-01-02T03:04:00.000Z');
    assert.ok(when.includes('value="2026-01-02T03:04"') && when.includes('>UTC</p>'));
    const list = render({ list: 'string' }, ['R07.9', 'I10']);
    assert.ok(list.includes('R07.9\nI10</textarea>') && list.includes('One per line.'));
    const claim = render({ id: 'claim' }, 'c1');
    assert.ok(claim.includes('value="c1"') && claim.includes('>Claim ID</p>'));
    assert.ok(render({ list: { code: 'icd10' } }, ['I10']).includes('I10</textarea>'));
    const choice = renderToStaticMarkup(
      createElement(ValueField, {
        id: 'pin',
        label: 'Continue From',
        type: 'string',
        value: 'failed',
        options: [
          { value: 'then', label: 'Then' },
          { value: 'failed', label: 'Failed' }
        ],
        onChange: () => undefined
      })
    );
    assert.match(
      choice,
      /role="option"[^>]*aria-selected="true" data-value="failed"[^>]*><span[^>]*>Failed<\/span>/
    );
    assert.match(choice, /^<div[^>]*><label for="pin"[^>]*>Continue From<\/label>/);
    assert.match(
      choice,
      /role="option"[^>]*aria-selected="false" data-value=""[^>]*><span[^>]*>Choose…<\/span>/
    );
  });
});

describe('structured values', () => {
  it('edits lists item by item and records field by field', () => {
    const list = render({ list: 'number' }, [1, 2]);
    assert.ok(list.includes('>Field</legend>'));
    assert.ok(list.includes('id="f-1"') && list.includes('value="2"') && list.includes('Item 2'));
    assert.ok(list.includes('Add Item') && list.includes('Remove Item 1'));
    assert.ok(!list.includes('<textarea'));
    const locked = renderToStaticMarkup(
      createElement(ValueField, {
        id: 'f',
        label: 'Field',
        type: { list: 'number' },
        value: [1],
        editable: false,
        onChange: () => undefined
      })
    );
    assert.ok(!locked.includes('Add Item') && !locked.includes('Remove Item 1'));
    const record = render(
      { object: { payerName: 'string', paid: 'boolean' } },
      { payerName: 'Aetna' }
    );
    assert.ok(record.includes('>Payer Name</label>') && record.includes('value="Aetna"'));
    assert.ok(record.includes('id="f-paid"') && !record.includes('<textarea'));
  });

  it('keeps JSON for open records and behind an explicit choice for any value', () => {
    const open = render({ object: {} }, { a: 1 });
    assert.ok(open.includes('<textarea') && open.includes('>Record</p>'));
    assert.ok(open.includes('&quot;a&quot;: 1'));
    const text = render('any', 'hello');
    assert.ok(text.includes('Kind of Value') && text.includes('value="hello"'));
    assert.ok(!text.includes('<textarea'));
    assert.ok(render('any', 3).includes('type="number"'));
    assert.ok(render('any', [1]).includes(`${JSON.stringify([1], null, 2)}</textarea>`));
    assert.deepEqual(
      [anyKindOf(null), anyKindOf('a'), anyKindOf(2), anyKindOf(false), anyKindOf({})],
      ['string', 'string', 'number', 'boolean', 'json']
    );
  });
});

describe('JsonField', () => {
  it('shows formatted JSON, locked when disabled', () => {
    const html = renderToStaticMarkup(
      createElement(JsonField, {
        id: 'j',
        label: 'Settings as JSON',
        value: { expression: '1' },
        disabled: true,
        onChange: () => undefined
      })
    );
    assert.ok(html.includes('disabled=""') && html.includes('font-mono'));
    assert.ok(html.includes('&quot;expression&quot;: &quot;1&quot;'));
  });
});

describe('field specs', () => {
  it('reads one value per line, dropping blank lines', () => {
    assert.deepEqual(linesOf(' R07.9 \n\nI10\n'), ['R07.9', 'I10']);
  });

  it('marks required fields, offers dates and bounds numbers', () => {
    const field = (patch: object) =>
      renderToStaticMarkup(
        createElement(ValueField, {
          id: 'f',
          label: 'Field',
          type: 'string',
          value: null,
          onChange: () => undefined,
          ...patch
        })
      );
    assert.ok(field({ isRequired: true }).includes('required=""'));
    assert.ok(field({ format: 'date', value: '2026-01-02' }).includes('type="date"'));
    const price = field({ type: 'number', min: 0, max: 500 });
    assert.ok(price.includes('min="0"') && price.includes('max="500"'));
  });
});

describe('file inputs', () => {
  const file: ValueType = { object: { bucket: 'string', key: 'string' } };

  it('offers a file picker when the field can upload, and JSON otherwise', () => {
    const picker = renderToStaticMarkup(
      createElement(ValueField, {
        id: 'file',
        label: 'File',
        type: file,
        value: null,
        onChange: () => undefined,
        upload: async () => ({ file: null, name: '' })
      })
    );
    assert.ok(picker.includes('type="file"') && picker.includes('Choose a file to upload.'));
    assert.ok(picker.includes('file:rounded-lg'));
    assert.ok(!render(file, null).includes('type="file"'));
  });
});
