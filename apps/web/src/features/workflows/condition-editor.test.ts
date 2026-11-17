import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valueKinds } from '@ugula/catalog';
import type { GraphDef, Json } from '@ugula/graph';
import { createElement, useState } from 'react';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { ValueKindsContext } from '../../shared/graph/pins.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import { againstOptions, ConditionEditor, rulesOf } from './condition-editor.tsx';

const def: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

const Harness = ({
  initial,
  sent,
  editable
}: {
  initial: Json;
  sent: (Json | undefined)[];
  editable: boolean;
}) => {
  const [config, setConfig] = useState<Json | undefined>(initial);
  return createElement(
    ValueKindsContext.Provider,
    { value: valueKinds },
    createElement(ConditionEditor, {
      nodeId: 'c',
      config,
      editable,
      onConfig: (next) => {
        sent.push(next);
        setConfig(next);
      },
      def,
      catalog: createCatalog(testNodes)
    })
  );
};

const show = (initial: Json, editable = true) => {
  const sent: (Json | undefined)[] = [];
  render(createElement(Harness, { initial, sent, editable }));
  return { sent, last: () => sent.at(-1), user: userEvent.setup() };
};

const STATE_RULES = {
  match: 'any',
  inputs: [
    { name: 'pickupState', type: 'string' },
    { name: 'emergency', type: 'boolean', label: 'Emergency Trip' }
  ],
  rules: [
    { field: 'pickupState', op: 'oneOf', value: ['NH', 'ME'] },
    { field: 'emergency', op: 'present' }
  ]
};

const COUNTS = {
  inputs: [
    { name: 'count', type: 'integer' },
    { name: 'shown', type: 'integer' }
  ],
  rules: [{ field: 'count', op: 'gt', input: 'shown' }]
};

const rule = (n: number) => {
  const tests = screen.getAllByRole('listbox', { name: 'Test' });
  const item = tests[n]?.closest('li');
  assert.ok(item, `rule ${n + 1}`);
  return within(item as HTMLElement);
};

const shownIn = (scope: ReturnType<typeof rule>, label: string) =>
  scope.getByRole('button', { name: label }).textContent;

const option = (scope: ReturnType<typeof rule>, list: string, name: string) =>
  within(scope.getByRole('listbox', { name: list })).getByRole('option', { name });

describe('ConditionEditor', () => {
  it('shows whether any or every rule must hold', () => {
    show(STATE_RULES);
    assert.equal(screen.getByRole('button', { name: 'Holds When' }).textContent, 'Any Rule Holds');
  });

  it('assumes every rule must hold when no match is set', () => {
    show({ rules: [] });
    assert.equal(
      screen.getByRole('button', { name: 'Holds When' }).textContent,
      'Every Rule Holds'
    );
  });

  it('sends the chosen match', async () => {
    const { last, user } = show(STATE_RULES);
    const list = screen.getByRole('listbox', { name: 'Holds When' });
    await user.click(within(list).getByRole('option', { name: 'Every Rule Holds' }));
    assert.deepEqual(last(), { ...STATE_RULES, match: 'all' });
  });

  it('lays each rule out as an input, a test and a value', () => {
    show(STATE_RULES);
    const first = rule(0);
    assert.equal(shownIn(first, 'Input'), 'Pickup State');
    assert.equal(shownIn(first, 'Test'), 'Is One of');
    assert.equal(shownIn(first, 'Compare with'), 'A Value');
    const value = first.getByRole('textbox', { name: 'Value' }) as HTMLInputElement;
    assert.equal(value.value, 'NH, ME');
    assert.equal(
      document.getElementById(value.getAttribute('aria-describedby') ?? '')?.textContent,
      'Separate items with commas.'
    );
  });

  it('asks for no value when the test only checks that the input has one', () => {
    show(STATE_RULES);
    const second = rule(1);
    assert.equal(shownIn(second, 'Input'), 'Emergency Trip');
    assert.equal(shownIn(second, 'Test'), 'Has a Value');
    assert.equal(second.queryByRole('textbox', { name: 'Value' }), null);
    assert.equal(second.queryByRole('button', { name: 'Compare with' }), null);
  });

  it('offers every other input to compare with, using their labels', () => {
    assert.deepEqual(
      againstOptions(['count', 'shown', 'total'], 'count', (n) => n.toUpperCase()),
      [
        { value: '', label: 'A Value' },
        { value: 'shown', label: 'SHOWN' },
        { value: 'total', label: 'TOTAL' }
      ]
    );
  });

  it('compares with another input in place of a value', () => {
    show(COUNTS);
    const first = rule(0);
    assert.equal(shownIn(first, 'Compare with'), 'Shown');
    assert.equal(first.queryByRole('textbox', { name: 'Value' }), null);
    assert.deepEqual(
      within(first.getByRole('listbox', { name: 'Compare with' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
      ['A Value', 'Shown']
    );
  });

  it('goes back to a typed value when comparing with a value again', async () => {
    const { last, user } = show(COUNTS);
    await user.click(option(rule(0), 'Compare with', 'A Value'));
    assert.deepEqual(last(), { ...COUNTS, rules: [{ field: 'count', op: 'gt' }] });
    await user.type(rule(0).getByRole('textbox', { name: 'Value' }), '12');
    assert.deepEqual(last(), { ...COUNTS, rules: [{ field: 'count', op: 'gt', value: 12 }] });
  });

  it('drops the comparison when the rule is moved onto the input it compared with', async () => {
    const { last, user } = show(COUNTS);
    await user.click(option(rule(0), 'Input', 'Shown'));
    assert.deepEqual(last(), { ...COUNTS, rules: [{ field: 'shown', op: 'gt' }] });
  });

  it('keeps the comparison when the rule is moved onto another input', async () => {
    const config = {
      inputs: [...COUNTS.inputs, { name: 'limit', type: 'integer' }],
      rules: [{ field: 'count', op: 'gt', input: 'shown' }]
    };
    const { last, user } = show(config);
    await user.click(option(rule(0), 'Input', 'Limit'));
    assert.deepEqual(last(), { ...config, rules: [{ field: 'limit', op: 'gt', input: 'shown' }] });
  });

  it('drops the value once the test no longer takes one, and keeps it otherwise', async () => {
    const { last, user } = show(STATE_RULES);
    await user.click(option(rule(0), 'Test', 'Is Not One of'));
    assert.deepEqual(last(), {
      ...STATE_RULES,
      rules: [{ field: 'pickupState', op: 'notOneOf', value: ['NH', 'ME'] }, STATE_RULES.rules[1]]
    });
    await user.click(option(rule(0), 'Test', 'Is Empty'));
    assert.deepEqual(last(), {
      ...STATE_RULES,
      rules: [{ field: 'pickupState', op: 'empty' }, STATE_RULES.rules[1]]
    });
  });

  it('reads a typed value by the type of the input', async () => {
    const config = {
      inputs: [{ name: 'miles', type: 'number' }],
      rules: [{ field: 'miles', op: 'gte' }]
    };
    const { last, user } = show(config);
    await user.type(rule(0).getByRole('textbox', { name: 'Value' }), '2.5');
    assert.deepEqual(last(), { ...config, rules: [{ field: 'miles', op: 'gte', value: 2.5 }] });
  });

  it('adds a rule on the first input', async () => {
    const { last, user } = show(STATE_RULES);
    await user.click(screen.getByRole('button', { name: 'Add Rule' }));
    assert.deepEqual(last(), {
      ...STATE_RULES,
      rules: [...STATE_RULES.rules, { field: 'pickupState', op: 'is' }]
    });
  });

  it('adds a rule with no input when there are no inputs yet', async () => {
    const { last, user } = show({});
    await user.click(screen.getByRole('button', { name: 'Add Rule' }));
    assert.deepEqual(last(), { rules: [{ field: '', op: 'is' }] });
  });

  it('removes a rule', async () => {
    const { last, user } = show(STATE_RULES);
    await user.click(screen.getByRole('button', { name: 'Remove Rule 1' }));
    assert.deepEqual(last(), { ...STATE_RULES, rules: [STATE_RULES.rules[1]] });
  });

  it('locks every field and hides the list actions when read-only', () => {
    const { sent } = show(STATE_RULES, false);
    assert.equal(screen.getByRole('group').hasAttribute('disabled'), true);
    assert.ok(!screen.queryByRole('button', { name: 'Add Rule' }));
    assert.ok(!screen.queryByRole('button', { name: 'Remove Rule 1' }));
    assert.deepEqual(sent, []);
  });
});

describe('rulesOf', () => {
  it('keeps only rules that name an input', () => {
    assert.deepEqual(rulesOf([{ field: 'a', op: 'is' }, null, { op: 'is' }, 'x', [1]] as Json), [
      { field: 'a', op: 'is' }
    ]);
    assert.deepEqual(rulesOf(undefined), []);
    assert.deepEqual(rulesOf({ field: 'a' }), []);
  });
});
