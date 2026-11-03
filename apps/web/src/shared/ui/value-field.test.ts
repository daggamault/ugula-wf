import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json, ValueType } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isFileType, linesOf, ValueField } from './value-field.tsx';

const render = (type: ValueType, value: Json) =>
  renderToStaticMarkup(
    createElement(ValueField, { id: 'f', label: 'Field', type, value, onChange: () => undefined })
  );

describe('ValueField', () => {
  it('picks a control that fits the value type', () => {
    assert.ok(render('boolean', true).includes('type="checkbox"'));
    assert.ok(render('integer', 3).includes('step="1"'));
    assert.ok(render('number', null).includes('type="number"'));
    assert.ok(render('string', 'abc').includes('value="abc"'));
    assert.ok(render('datetime', '2026-01-02T03:04:00.000Z').includes('value="2026-01-02T03:04"'));
    const json = render({ list: 'number' }, [1]);
    assert.ok(json.includes('<textarea'));
    assert.ok(json.includes('list&lt;number&gt;'));
    const list = render({ list: 'string' }, ['R07.9', 'I10']);
    assert.ok(list.includes('R07.9\nI10</textarea>') && list.includes('One per line.'));
    const choice = renderToStaticMarkup(
      createElement(ValueField, {
        id: 'pin',
        label: 'Continue from',
        type: 'string',
        value: 'failed',
        options: [
          { value: 'then', label: 'Then' },
          { value: 'failed', label: 'Failed' }
        ],
        onChange: () => undefined
      })
    );
    assert.ok(choice.includes('<option value="failed" selected="">Failed</option>'));
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

  it('recognizes stored file references', () => {
    assert.equal(isFileType(file), true);
    assert.equal(isFileType({ object: { key: 'string' } }), false);
    assert.equal(isFileType('string'), false);
  });

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
