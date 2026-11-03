import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Breadcrumbs } from './breadcrumbs.tsx';

describe('Breadcrumbs', () => {
  it('links or selects every level above the current one', () => {
    const html = renderToStaticMarkup(
      createElement(Breadcrumbs, {
        label: 'Workflow path',
        crumbs: [
          { label: 'Workflows', to: '/workflows' },
          { label: 'Process PCR', onSelect: () => undefined },
          { label: 'Resolve Payers' }
        ]
      })
    );
    assert.ok(html.includes('aria-label="Workflow path"'));
    assert.ok(html.includes('href="/workflows"'));
    assert.ok(html.includes('<button type="button"') && html.includes('Process PCR</button>'));
    assert.ok(html.includes('aria-current="page"') && html.includes('Resolve Payers</span>'));
    assert.equal(html.match(/<li/g)?.length, 3);
    assert.equal(html.match(/cursor-pointer/g)?.length, 2);
    assert.equal(html.match(/lucide-chevron-right/g)?.length, 2);
  });
});
