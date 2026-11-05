import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Checkbox } from './checkbox.tsx';

describe('Checkbox', () => {
  it('renders a themed checkbox that only looks clickable when enabled', () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { 'aria-label': 'View Claims', checked: true, onChange: () => {} })
    );
    assert.ok(html.startsWith('<input type="checkbox"'));
    assert.ok(html.includes('accent-primary') && html.includes('enabled:cursor-pointer'));
    assert.ok(html.includes('aria-label="View Claims"') && html.includes('checked=""'));
    const off = renderToStaticMarkup(createElement(Checkbox, { disabled: true, readOnly: true }));
    assert.ok(off.includes('disabled=""') && off.includes('disabled:opacity-60'));
  });
});
