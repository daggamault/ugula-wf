import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeSelect, Select } from './select.tsx';

describe('Select', () => {
  it('renders a labelled pointer select with options', () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        options: [{ value: 'node', label: 'Node' }]
      })
    );
    assert.ok(html.includes('for="kind"') && /<select [^>]*id="kind"/.test(html));
    assert.ok(html.includes('<option value="node">Node</option>'));
    assert.ok(html.includes('appearance-none') && html.includes('cursor-pointer'));
    assert.ok(html.includes('h-10') && html.includes('rounded-lg'));
    assert.ok(!html.includes('aria-invalid=') && !html.includes('aria-describedby'));
  });

  it('links an error to the select', () => {
    const html = renderToStaticMarkup(
      createElement(Select, { id: 'payer', label: 'Payer', error: 'Pick one', options: [] })
    );
    assert.ok(html.includes('aria-invalid="true"'));
    assert.ok(html.includes('aria-describedby="payer-error"'));
  });
});

describe('NativeSelect', () => {
  it('draws a decorative chevron over a bare select', () => {
    const html = renderToStaticMarkup(
      createElement(NativeSelect, { 'aria-label': 'Rows', options: [{ value: '10', label: '10' }] })
    );
    assert.ok(html.includes('aria-label="Rows"') && !html.includes('<label'));
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
  });
});
