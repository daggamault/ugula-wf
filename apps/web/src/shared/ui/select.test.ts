import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Select } from './select.tsx';

describe('Select', () => {
  it('renders a labelled pointer select with options', () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        id: 'kind',
        label: 'Kind',
        options: [{ value: 'node', label: 'Node' }]
      })
    );
    assert.ok(html.includes('<option value="node">Node</option>'));
    assert.ok(html.includes('appearance-none'));
  });
});
