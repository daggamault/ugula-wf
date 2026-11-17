import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Json, valueTypeSchema } from '@ugula/graph';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as v from 'valibot';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import {
  ChoicesField,
  ConfigForm,
  choiceLabel,
  errorsOf,
  optionsJson,
  optionsOf
} from './config-form.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const schema = v.object({
  method: v.optional(v.picklist(['GET', 'POST']), 'GET'),
  failOnError: v.optional(v.boolean(), true),
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 2),
  unit: v.optional(v.picklist(['days', 'hours'])),
  cases: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.minLength(1)),
  fields: v.array(v.strictObject({ name: v.string(), type: valueTypeSchema })),
  extra: v.optional(v.record(v.string(), v.string()))
});

const markup = (config: Json, editable = true) =>
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
    const html = markup({ cases: ['paid'], fields: [{ name: 'payer', type: 'string' }] });
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
    const html = markup({ cases: [''], fields: [] });
    assert.ok(html.includes('role="alert"'));
    const locked = markup({ cases: ['a'], fields: [] }, false);
    assert.ok(locked.includes('<fieldset disabled=""') && !locked.includes('Add Case'));
    assert.deepEqual(errorsOf(schema, { cases: ['a'], fields: [] }), { root: [], nested: {} });
    assert.ok(errorsOf(schema, { cases: [''], fields: [] }).nested['cases.0']);
  });
});

const edit = (initial: Json | undefined) => {
  const sent: (Json | undefined)[] = [];
  const Harness = () => {
    const [config, setConfig] = useState(initial);
    return createElement(ConfigForm, {
      id: 'n',
      schema,
      config,
      editable: true,
      onConfig: (next) => {
        sent.push(next);
        setConfig(next);
      }
    });
  };
  render(createElement(Harness));
  return { sent, user: userEvent.setup() };
};

const valid = { cases: ['paid'], fields: [] };

describe('editing a ConfigForm', () => {
  it('writes a changed number and drops it again when cleared or set back to its default', async () => {
    const { sent, user } = edit(valid);
    const count = screen.getByLabelText(/^Count/);
    await user.type(count, '5', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    assert.deepEqual(sent.at(-1), { ...valid, count: 5 });
    await user.clear(count);
    assert.deepEqual(sent.at(-1), valid);
    await user.type(count, '7', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    await user.type(count, '2', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    assert.deepEqual(sent.at(-1), valid);
  });

  it('writes an unticked flag and drops it when ticked back to its default', async () => {
    const { sent, user } = edit(valid);
    const flag = screen.getByRole('checkbox', { name: 'Fail on Error' });
    await user.click(flag);
    assert.deepEqual(sent.at(-1), { ...valid, failOnError: false });
    await user.click(flag);
    assert.deepEqual(sent.at(-1), valid);
  });

  it('writes a chosen option, and Not Set or the default removes it', async () => {
    const { sent, user } = edit(valid);
    const unit = screen.getByRole('listbox', { name: 'Unit', hidden: true });
    await user.click(within(unit).getByRole('option', { name: 'Hours', hidden: true }));
    assert.deepEqual(sent.at(-1), { ...valid, unit: 'hours' });
    await user.click(within(unit).getByRole('option', { name: 'Not Set', hidden: true }));
    assert.deepEqual(sent.at(-1), valid);
    const method = screen.getByRole('listbox', { name: 'Method', hidden: true });
    await user.click(within(method).getByRole('option', { name: 'POST', hidden: true }));
    assert.deepEqual(sent.at(-1), { ...valid, method: 'POST' });
    await user.click(within(method).getByRole('option', { name: 'GET', hidden: true }));
    assert.deepEqual(sent.at(-1), valid);
  });

  it('adds list rows with blank values and flags them until they are filled in', async () => {
    const { sent, user } = edit(valid);
    await user.click(screen.getByRole('button', { name: 'Add Case' }));
    assert.deepEqual(sent.at(-1), { ...valid, cases: ['paid', ''] });
    assert.equal(screen.getByLabelText(/^Case 2/).getAttribute('aria-invalid'), 'true');
    await user.type(screen.getByLabelText(/^Case 2/), 'denied');
    assert.deepEqual(sent.at(-1), { ...valid, cases: ['paid', 'denied'] });
    assert.equal(screen.getByLabelText(/^Case 2/).getAttribute('aria-invalid'), null);
    await user.click(screen.getByRole('button', { name: 'Add Field' }));
    assert.deepEqual(sent.at(-1), {
      cases: ['paid', 'denied'],
      fields: [{ name: '', type: 'string' }]
    });
    await user.click(screen.getByRole('button', { name: 'Remove Case 1' }));
    assert.deepEqual((sent.at(-1) as { cases: string[] }).cases, ['denied']);
  });

  it('writes JSON settings once they parse and keeps the typed text while they do not', async () => {
    const { sent, user } = edit(valid);
    const extra = screen.getByRole('textbox', { name: 'Extra' });
    await user.clear(extra);
    await user.type(extra, '{{"a": "b"');
    const before = sent.length;
    assert.equal((extra as HTMLTextAreaElement).value, '{"a": "b"');
    await user.type(extra, '}');
    assert.equal(sent.length, before + 1);
    assert.deepEqual(sent.at(-1), { ...valid, extra: { a: 'b' } });
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
