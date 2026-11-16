import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Json, valueTypeSchema } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as v from 'valibot';
import {
  ChoicesField,
  ConfigForm,
  choiceLabel,
  errorsOf,
  optionsJson,
  optionsOf
} from './config-form.tsx';

const schema = v.object({
  method: v.optional(v.picklist(['GET', 'POST']), 'GET'),
  failOnError: v.optional(v.boolean(), true),
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 2),
  unit: v.optional(v.picklist(['days', 'hours'])),
  cases: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.minLength(1)),
  fields: v.array(v.strictObject({ name: v.string(), type: valueTypeSchema })),
  extra: v.optional(v.record(v.string(), v.string()))
});

const render = (config: Json, editable = true) =>
  renderToStaticMarkup(
    createElement(ConfigForm, {
      id: 'n',
      schema,
      config,
      editable,
      onConfig: () => undefined
    })
  );

describe('ConfigForm', () => {
  it('renders a control per setting, showing defaults until they are changed', () => {
    const html = render({ cases: ['paid'], fields: [{ name: 'payer', type: 'string' }] });
    assert.ok(html.includes('>Method</label>') && html.includes('>GET</span>'));
    assert.match(html, /type="checkbox"[^>]*id="n-failOnError"[^>]*checked=""/);
    assert.ok(
      html.includes('id="n-count"') && html.includes('value="2"') && html.includes('step="1"')
    );
    assert.ok(html.includes('>Not Set<'));
    assert.ok(html.includes('id="n-cases-0"') && html.includes('value="paid"'));
    assert.ok(html.includes('Add Case') && html.includes('Add Field'));
    assert.ok(html.includes('id="n-fields-0-name"') && html.includes('value="payer"'));
    assert.ok(html.includes('id="n-fields-0-type"') && html.includes('>Text</span>'));
    assert.ok(html.includes('>Extra</label>') && html.includes('<textarea'));
  });

  it('shows what is wrong next to the setting, and locks everything when read-only', () => {
    const html = render({ cases: [''], fields: [] });
    assert.ok(html.includes('role="alert"'));
    const locked = render({ cases: ['a'], fields: [] }, false);
    assert.ok(locked.includes('<fieldset disabled=""') && !locked.includes('Add Case'));
    assert.deepEqual(errorsOf(schema, { cases: ['a'], fields: [] }), { root: [], nested: {} });
    assert.ok(errorsOf(schema, { cases: [''], fields: [] }).nested['cases.0']);
  });
});

describe('choices', () => {
  it('labels choices and reads and writes them as value and label rows', () => {
    assert.equal(choiceLabel('GET'), 'GET');
    assert.equal(choiceLabel('notOneOf'), 'Not One Of');
    assert.deepEqual(optionsOf(['A', { value: 'b', label: 'Bee' }]), [
      { value: 'A', label: 'A' },
      { value: 'b', label: 'Bee' }
    ]);
    assert.deepEqual(
      optionsJson([
        { value: 'A', label: 'A' },
        { value: 'b', label: 'Bee' },
        { value: 'c', label: '' }
      ]),
      ['A', { value: 'b', label: 'Bee' }, 'c']
    );
    const html = renderToStaticMarkup(
      createElement(ChoicesField, {
        id: 'o',
        label: 'Choices',
        value: [{ value: 'b', label: 'Bee' }],
        editable: true,
        onChange: () => undefined
      })
    );
    assert.ok(html.includes('value="Bee"') && html.includes('Add Choice'));
  });
});
