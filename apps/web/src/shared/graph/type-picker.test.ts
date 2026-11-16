import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ValueType } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ValueKindsContext } from './pins.ts';
import {
  freeFieldName,
  kindOptions,
  shapeOf,
  shapeOptions,
  TypePicker,
  typeFor
} from './type-picker.tsx';

const kinds = { id: { claim: 'Claim ID' }, code: { hcpcs: 'HCPCS Code' } };

const render = (value: ValueType, isFieldType = false) =>
  renderToStaticMarkup(
    createElement(
      ValueKindsContext.Provider,
      { value: kinds },
      createElement(TypePicker, {
        id: 't',
        label: 'Type',
        value,
        isFieldType,
        onChange: () => undefined
      })
    )
  );

describe('TypePicker', () => {
  it('picks a type from plain words, never typed text', () => {
    const html = render('integer');
    assert.ok(html.includes('>Whole Number</span>') && html.includes('data-value="list"'));
    assert.ok(html.includes('>Any Value</span>') && !html.includes('<input id="t"'));
    assert.ok(!render('string', true).includes('data-value="any"'));
  });

  it('asks which kind of ID or code, what each item is, and the fields of a record', () => {
    assert.ok(render({ id: 'claim' }).includes('>ID Of</label>'));
    assert.ok(render({ code: 'hcpcs' }).includes('>HCPCS Code</span>'));
    const list = render({ list: { code: 'hcpcs' } });
    assert.ok(list.includes('>Each Item Is</label>') && list.includes('id="t-item-code"'));
    const record = render({ object: { payer: 'string' } });
    assert.ok(record.includes('value="payer"') && record.includes('Add Field'));
  });

  it('builds a type for each choice and offers ID and code only when kinds exist', () => {
    assert.deepEqual(typeFor('id', kinds), { id: 'claim' });
    assert.deepEqual(typeFor('list', kinds), { list: 'string' });
    assert.deepEqual(typeFor('object', kinds), { object: {} });
    assert.equal(typeFor('boolean', kinds), 'boolean');
    assert.equal(shapeOf({ code: 'x' }), 'code');
    assert.ok(!shapeOptions({ id: {}, code: {} }, false).some((o) => o.value === 'id'));
    assert.deepEqual(kindOptions({ a: 'Alpha' }, 'b'), [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'b' }
    ]);
    assert.equal(freeFieldName(['field2']), 'field3');
  });
});
