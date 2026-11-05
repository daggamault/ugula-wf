import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json, ValueType } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { linesOf, ValueField } from './value-field.tsx';

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
    const json = render({ list: 'number' }, [1]);
    assert.ok(json.includes('<textarea') && json.includes('font-mono'));
    assert.ok(json.includes('list&lt;number&gt;') && json.includes('[\n  1\n]</textarea>'));
    assert.ok(render({ list: 'number' }, null).includes('></textarea>'));
    const list = render({ list: 'string' }, ['R07.9', 'I10']);
    assert.ok(list.includes('R07.9\nI10</textarea>') && list.includes('One per line.'));
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
