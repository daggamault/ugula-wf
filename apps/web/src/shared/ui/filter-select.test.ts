import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterSelect, hrefOf } from './filter-select.tsx';

const options = [
  { value: 'open', label: 'Open', href: '/claims' },
  { value: 'paid', label: 'Paid', href: '/claims?view=paid' }
];

describe('FilterSelect', () => {
  it('renders a select labelled for screen readers only, with the current value chosen', () => {
    const html = renderToStaticMarkup(
      createElement(FilterSelect, { id: 'status', label: 'Status', value: 'paid', options })
    );
    assert.ok(html.includes('class="text-sm font-medium sr-only"') && html.includes('>Status<'));
    assert.match(
      html,
      /role="option"[^>]*aria-selected="true" data-value="paid"[^>]*><span[^>]*>Paid<\/span>/
    );
  });

  it('finds the link for a chosen value', () => {
    assert.equal(hrefOf(options, 'paid'), '/claims?view=paid');
    assert.equal(hrefOf(options, 'missing'), undefined);
  });
});
