import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import {
  ExpressionEditor,
  FunctionReference,
  formulaInputs,
  formulaProblem,
  ListFormulaEditor
} from './expression-editor.tsx';

const props = (config: Json, editable = true) => ({
  nodeId: 'e',
  config,
  editable,
  onConfig: () => undefined,
  def: {
    signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
    variables: [],
    nodes: [],
    edges: []
  },
  catalog: createCatalog(testNodes)
});

describe('formulas', () => {
  it('lists the names a formula needs and says what is wrong with it', () => {
    assert.deepEqual(formulaInputs('price * units + round(tax)'), ['price', 'units', 'tax']);
    assert.deepEqual(formulaInputs('item.amount * rate', ['item', 'index']), ['rate']);
    assert.deepEqual(formulaInputs('price *'), []);
    assert.equal(formulaProblem('price * 2'), null);
    assert.match(formulaProblem('') ?? '', /Write a formula/);
    assert.match(formulaProblem('nope(1)') ?? '', /Unknown function "nope"/);
  });
});

describe('ExpressionEditor', () => {
  it('edits the formula with live checks, its inputs and a function reference', () => {
    const html = renderToStaticMarkup(
      createElement(ExpressionEditor, props({ expression: 'price * units' }))
    );
    assert.ok(html.includes('>Formula</label>') && html.includes('font-mono'));
    assert.ok(html.includes('price * units</textarea>') && !html.includes('role="alert"'));
    assert.ok(html.includes('>price</li>') && html.includes('>units</li>'));
    assert.ok(html.includes('>Functions') && html.includes('round(x, digits)'));
    const bad = renderToStaticMarkup(createElement(ExpressionEditor, props({ expression: 'a +' })));
    assert.ok(bad.includes('role="alert"'));
    const locked = renderToStaticMarkup(
      createElement(ExpressionEditor, props({ expression: 'a' }, false))
    );
    assert.ok(locked.includes('<fieldset disabled=""'));
  });

  it('says which names a list formula is given for each item', () => {
    const html = renderToStaticMarkup(
      createElement(ListFormulaEditor, props({ expression: 'item.amount > limit' }))
    );
    assert.ok(html.includes('Given for Each Item') && html.includes('>index</li>'));
    assert.ok(html.includes('>limit</li>') && !html.includes('>amount</li>'));
  });
});

describe('editing a formula', () => {
  it('keeps the other settings, lists new inputs and flags a broken formula as it is typed', async () => {
    const sent: Json[] = [];
    const Harness = () => {
      const [config, setConfig] = useState<Json>({ expression: 'a', label: 'Total' });
      return createElement(ExpressionEditor, {
        ...props(config),
        onConfig: (next) => {
          sent.push(next ?? null);
          setConfig(next ?? null);
        }
      });
    };
    render(createElement(Harness));
    const user = userEvent.setup();
    const formula = screen.getByRole('textbox', { name: 'Formula' });
    await user.type(formula, ' *');
    assert.deepEqual(sent.at(-1), { expression: 'a *', label: 'Total' });
    assert.equal(formula.getAttribute('aria-invalid'), 'true');
    await user.type(formula, ' rate');
    assert.deepEqual(sent.at(-1), { expression: 'a * rate', label: 'Total' });
    assert.equal(formula.getAttribute('aria-invalid'), null);
    assert.deepEqual(
      screen.getAllByRole('listitem').map((li) => li.textContent),
      ['a', 'rate']
    );
  });
});

describe('FunctionReference', () => {
  it('groups the functions by category, collapsed', () => {
    const html = renderToStaticMarkup(createElement(FunctionReference));
    assert.ok(html.startsWith('<details') && !html.includes('<details open'));
    assert.ok(html.includes('>Dates</h3>') && html.includes('daysBetween(from, to)'));
  });
});
