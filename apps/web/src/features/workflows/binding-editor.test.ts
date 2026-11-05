import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BindingEditor, bindingFor, PinHeading } from './binding-editor.tsx';

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
  const render = (binding: Parameters<typeof BindingEditor>[0]['binding']) =>
    renderToStaticMarkup(
      createElement(BindingEditor, {
        nodeId: 'n1',
        spec,
        binding,
        editable: true,
        changed: true,
        onBind: () => undefined
      })
    );

  it('says what an unset input uses and marks a changed pin', () => {
    const html = render(undefined);
    assert.ok(html.includes('Uses 5 unless you set it.'));
    assert.ok(html.includes('aria-label="Changed from the base"'));
  });

  it('edits an expression in a monospace input', () => {
    const html = render({ expr: 'a + 1' });
    assert.ok(html.includes('id="n1-miles-expr"') && html.includes('value="a + 1"'));
  });

  it('heads a pin with its type and whether it is optional', () => {
    const html = renderToStaticMarkup(
      createElement(PinHeading, { spec: { name: 'note', type: 'string', optional: true } })
    );
    assert.ok(html.includes('optional'));
  });
});
