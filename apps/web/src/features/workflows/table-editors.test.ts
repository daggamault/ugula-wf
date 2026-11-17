import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import { DecisionTableEditor, LookupTableEditor } from './table-editors.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

type Editor = typeof LookupTableEditor;

const staticEditor = (editor: Editor, config: unknown, editable = true) =>
  renderToStaticMarkup(
    createElement(editor, {
      nodeId: 'n1',
      config: config as Json,
      editable,
      onConfig: () => undefined
    })
  );

const Harness = ({ editor, initial, sent }: { editor: Editor; initial: Json; sent: Json[] }) => {
  const [config, setConfig] = useState(initial);
  return createElement(editor, {
    nodeId: 'n1',
    config,
    editable: true,
    onConfig: (next) => {
      sent.push(next);
      setConfig(next);
    }
  });
};

const edit = (editor: Editor, initial: unknown) => {
  const sent: Json[] = [];
  render(createElement(Harness, { editor, initial: initial as Json, sent }));
  return { sent, last: () => sent.at(-1), user: userEvent.setup() };
};

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;

const choose = (list: string, option: string) =>
  within(screen.getByRole('listbox', { name: list })).getByRole('option', { name: option });

const DECISION = {
  inputs: [{ name: 'care', type: 'string', label: 'Level of care' }],
  outputs: [{ name: 'level', type: 'string' }],
  rules: [
    {
      label: 'ALS care',
      when: { care: { op: 'oneOf', value: ['4232003', '4232005'] } },
      set: { level: 'ALS1' }
    }
  ],
  otherwise: { level: 'BLS' }
};

describe('LookupTableEditor', () => {
  it('shows rows and the fallback as fields, with hints for lists and true or false', () => {
    const html = staticEditor(LookupTableEditor, {
      rows: [{ key: '4221003', value: 'H' }],
      fallback: 'S'
    });
    assert.ok(html.includes('value="4221003"') && html.includes('value="H"'));
    assert.ok(html.includes('When the Key Is Not Listed') && html.includes('value="S"'));
    const list = staticEditor(LookupTableEditor, {
      type: { list: 'string' },
      rows: [{ key: '', value: ['a', 'b'] }]
    });
    assert.ok(list.includes('value="a, b"') && list.includes('Separate items with commas.'));
    assert.ok(list.includes('aria-label="Remove row"'));
    assert.ok(
      staticEditor(LookupTableEditor, {
        type: 'boolean',
        rows: [{ key: 'k', value: true }]
      }).includes('true or false.')
    );
  });

  it('locks every field and hides row actions when read-only', () => {
    const html = staticEditor(LookupTableEditor, { rows: [{ key: 'k', value: 'v' }] }, false);
    assert.ok(html.includes('<fieldset disabled=""'));
    assert.ok(!html.includes('Add Row') && !html.includes('Remove k'));
  });

  it('adds, fills and removes rows', async () => {
    const { last, user } = edit(LookupTableEditor, {
      type: 'string',
      rows: [{ key: '4221003', value: 'H' }],
      fallback: null
    });
    await user.click(screen.getByRole('button', { name: 'Add Row' }));
    const keys = screen.getAllByLabelText('Key');
    const values = screen.getAllByLabelText('Value');
    assert.equal(keys.length, 2);
    await user.type(keys[1] as HTMLElement, '4221005');
    await user.type(values[1] as HTMLElement, 'S');
    await user.type(field('When the Key Is Not Listed'), 'X');
    assert.deepEqual(last(), {
      type: 'string',
      rows: [
        { key: '4221003', value: 'H' },
        { key: '4221005', value: 'S' }
      ],
      fallback: 'X'
    });
    await user.click(screen.getByRole('button', { name: 'Remove 4221003' }));
    assert.deepEqual(last(), {
      type: 'string',
      rows: [{ key: '4221005', value: 'S' }],
      fallback: 'X'
    });
  });

  it('parses values by the chosen type', async () => {
    const { last, user } = edit(LookupTableEditor, { rows: [{ key: 'miles', value: null }] });
    await user.click(choose('Values Are', 'Number'));
    assert.deepEqual(last(), {
      type: 'number',
      rows: [{ key: 'miles', value: null }],
      fallback: null
    });
    await user.type(field('Value'), '2.5');
    assert.deepEqual(last(), {
      type: 'number',
      rows: [{ key: 'miles', value: 2.5 }],
      fallback: null
    });
    await user.click(choose('Values Are', 'List of Text'));
    await user.clear(field('Value'));
    await user.type(field('Value'), 'a, b,');
    assert.deepEqual(last(), {
      type: { list: 'string' },
      rows: [{ key: 'miles', value: ['a', 'b'] }],
      fallback: null
    });
    assert.equal(field('Value').value, 'a, b,');
  });
});

describe('DecisionTableEditor', () => {
  it('shows columns, rules with their conditions and the otherwise values', () => {
    const html = staticEditor(DecisionTableEditor, DECISION);
    assert.ok(html.includes('What the Rules Check') && html.includes('What the Rules Decide'));
    assert.ok(html.includes('When Level of Care') && html.includes('value="4232003, 4232005"'));
    assert.ok(html.includes('Then Level') && html.includes('value="ALS1"'));
    assert.ok(html.includes('When No Rule Holds') && html.includes('value="BLS"'));
    const locked = staticEditor(DecisionTableEditor, DECISION, false);
    assert.ok(!locked.includes('Add Rule') && !locked.includes('Move ALS care up'));
    assert.ok(locked.includes('<fieldset disabled=""'));
  });

  it('renames an input in every rule that checks it', async () => {
    const { last, user } = edit(DecisionTableEditor, DECISION);
    const name = screen.getAllByLabelText('Name')[0] as HTMLInputElement;
    await user.clear(name);
    assert.equal((await screen.findAllByText('Enter a name.')).length, 1);
    assert.equal(name.value, '');
    await user.type(name, 'acuity');
    const config = last() as typeof DECISION;
    assert.deepEqual(config.inputs, [{ name: 'acuity', type: 'string', label: 'Level of care' }]);
    assert.deepEqual(config.rules[0]?.when, {
      acuity: { op: 'oneOf', value: ['4232003', '4232005'] }
    });
  });

  it('refuses a column name already in use and keeps the old one in the rules', async () => {
    const { last, user } = edit(DecisionTableEditor, {
      ...DECISION,
      inputs: [...DECISION.inputs, { name: 'miles', type: 'number' }]
    });
    const second = screen.getAllByLabelText('Name')[1] as HTMLInputElement;
    await user.clear(second);
    await user.type(second, 'care');
    assert.ok(screen.getByText('Another input is already called care.'));
    const config = last() as typeof DECISION;
    assert.deepEqual(
      config.inputs.map((c) => c.name),
      ['care', 'car']
    );
    assert.equal(second.getAttribute('aria-invalid'), 'true');
  });

  it('renames and removes outputs in the rules and the otherwise values', async () => {
    const { last, user } = edit(DecisionTableEditor, DECISION);
    const output = screen.getAllByLabelText('Name')[1] as HTMLInputElement;
    await user.type(output, 'Code');
    let config = last() as typeof DECISION;
    assert.deepEqual(
      [config.rules[0]?.set, config.otherwise],
      [{ levelCode: 'ALS1' }, { levelCode: 'BLS' }]
    );
    await user.click(screen.getByRole('button', { name: 'Remove output levelCode' }));
    config = last() as typeof DECISION;
    assert.deepEqual([config.outputs, config.rules[0]?.set, config.otherwise], [[], {}, {}]);
    assert.ok(!screen.queryByLabelText('Then LevelCode'));
  });

  it('adds columns with free names', async () => {
    const { last, user } = edit(DecisionTableEditor, DECISION);
    await user.click(screen.getByRole('button', { name: 'Add Input' }));
    await user.click(screen.getByRole('button', { name: 'Add Output' }));
    const config = last() as typeof DECISION;
    assert.deepEqual(
      [config.inputs.map((c) => c.name), config.outputs],
      [
        ['care', 'input2'],
        [
          { name: 'level', type: 'string' },
          { name: 'output2', type: 'string' }
        ]
      ]
    );
  });

  it('sets a condition, keeping its value across operators that take one', async () => {
    const { last, user } = edit(DecisionTableEditor, DECISION);
    const condition = () => (last() as typeof DECISION).rules[0]?.when;
    await user.click(choose('When Level of Care', 'Is Empty'));
    assert.deepEqual(condition(), { care: { op: 'empty', value: ['4232003', '4232005'] } });
    assert.ok(!screen.queryByLabelText(/^Value/));
    await user.click(choose('When Level of Care', 'Is'));
    await user.clear(field(/^Value/));
    await user.type(field(/^Value/), '4232005');
    assert.deepEqual(condition(), { care: { op: 'is', value: '4232005' } });
    await user.click(choose('When Level of Care', 'Any Value'));
    assert.deepEqual(condition(), {});
  });

  it('adds, reorders and removes rules', async () => {
    const { last, user } = edit(DecisionTableEditor, DECISION);
    await user.click(screen.getByRole('button', { name: 'Add Rule' }));
    await user.type(field('Rule 2'), ' fallback');
    const labels = () => (last() as typeof DECISION).rules.map((r) => r.label);
    assert.deepEqual(labels(), ['ALS care', 'Rule 2 fallback']);
    await user.click(screen.getByRole('button', { name: 'Move Rule 2 fallback up' }));
    assert.deepEqual(labels(), ['Rule 2 fallback', 'ALS care']);
    assert.equal(field('Rule 1').value, 'Rule 2 fallback');
    await user.click(screen.getByRole('button', { name: 'Remove ALS care' }));
    assert.deepEqual(labels(), ['Rule 2 fallback']);
  });

  it('sets what a rule decides and what holds when no rule does', async () => {
    const { last, user } = edit(DecisionTableEditor, DECISION);
    await user.clear(field('Then Level'));
    await user.type(field('Then Level'), 'ALS2');
    await user.type(field(/^Reason/), 'Basic care');
    await user.clear(field('Level'));
    const config = last() as typeof DECISION & { otherwiseLabel: string };
    assert.deepEqual(
      [config.rules[0]?.set, config.otherwise, config.otherwiseLabel],
      [{ level: 'ALS2' }, { level: null }, 'Basic care']
    );
  });
});
