import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InputBinding } from '@ugula/graph';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import {
  BindingEditor,
  bindingFor,
  bindingProblem,
  PinHeading,
  variablesHint
} from './binding-editor.tsx';

const spec = { name: 'miles', type: 'number', default: 5 } as const;

describe('bindingFor', () => {
  it('starts a fixed value from the default, an empty expression, or nothing', () => {
    assert.deepEqual(bindingFor('value', spec), { value: 5 });
    assert.deepEqual(bindingFor('value', {}), { value: null });
    assert.deepEqual(bindingFor('expr', spec), { expr: '' });
    assert.equal(bindingFor('default', spec), undefined);
    assert.equal(bindingFor('bogus', spec), undefined);
  });
});

describe('BindingEditor', () => {
  const markup = (binding: Parameters<typeof BindingEditor>[0]['binding']) =>
    renderToStaticMarkup(
      createElement(BindingEditor, {
        nodeId: 'n1',
        spec,
        binding,
        editable: true,
        changed: true,
        variables: ['a'],
        onBind: () => undefined
      })
    );

  it('says what an unset input uses and marks a changed pin', () => {
    const html = markup(undefined);
    assert.ok(html.includes('Uses 5 unless you set it.'));
    assert.ok(html.includes('aria-label="Changed from the Base"'));
  });

  it('edits an expression in a monospace input, checked against the graph variables', () => {
    const html = markup({ expr: 'a + 1' });
    assert.ok(html.includes('id="n1-miles-expr"') && html.includes('value="a + 1"'));
    assert.ok(html.includes('variables can be used here: a.') && html.includes('>Functions'));
    assert.ok(!html.includes('role="alert"'));
    assert.ok(markup({ expr: 'b + 1' }).includes('&quot;b&quot; is not a variable'));
  });

  it('switches between unset, a fixed value and an expression', async () => {
    HTMLElement.prototype.showPopover ??= () => undefined;
    const sent: (InputBinding | undefined)[] = [];
    const Harness = () => {
      const [binding, setBinding] = useState<InputBinding | undefined>(undefined);
      return createElement(BindingEditor, {
        nodeId: 'n1',
        spec,
        binding,
        editable: true,
        changed: false,
        variables: ['a'],
        onBind: (next) => {
          sent.push(next);
          setBinding(next);
        }
      });
    };
    render(createElement(Harness));
    const user = userEvent.setup();
    const modes = () => screen.getByRole('listbox', { name: 'Value', hidden: true });
    await user.click(within(modes()).getByRole('option', { name: 'A Fixed Value', hidden: true }));
    assert.deepEqual(sent.at(-1), { value: 5 });
    assert.ok(screen.getByLabelText(/^Fixed Value/));
    await user.click(within(modes()).getByRole('option', { name: 'An Expression', hidden: true }));
    assert.deepEqual(sent.at(-1), { expr: '' });
    const expr = screen.getByRole('textbox', { name: /^Expression/ });
    assert.equal(expr.getAttribute('aria-invalid'), 'true');
    await user.type(expr, 'b');
    assert.deepEqual(sent.at(-1), { expr: 'b' });
    assert.match(screen.getByRole('alert').textContent ?? '', /"b" is not a variable/);
    await user.clear(expr);
    await user.type(expr, 'a * 2');
    assert.deepEqual(sent.at(-1), { expr: 'a * 2' });
    assert.ok(!screen.queryByRole('alert'));
    await user.click(within(modes()).getByRole('option', { name: 'Not Set', hidden: true }));
    assert.equal(sent.at(-1), undefined);
    assert.ok(screen.getByText('Uses 5 unless you set it.'));
  });

  it('names the problem with an expression, and the variables it may use', () => {
    assert.equal(bindingProblem('a * 2', ['a']), null);
    assert.match(bindingProblem('', ['a']) ?? '', /variables/);
    assert.match(bindingProblem('nope(a)', ['a']) ?? '', /Unknown function "nope"/);
    assert.match(bindingProblem('a +', ['a']) ?? '', /\w/);
    assert.equal(bindingProblem('map(xs, x => x + 1)', ['xs']), null);
    assert.match(variablesHint([]), /no variables/);
  });

  it('heads a pin with its type and whether it is optional', () => {
    const html = renderToStaticMarkup(
      createElement(PinHeading, { spec: { name: 'note', type: 'string', optional: true } })
    );
    assert.ok(html.includes('optional'));
  });
});
