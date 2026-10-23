import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterPills } from './filter-pills.tsx';

describe('FilterPills', () => {
  it('links each option and marks the selected one', () => {
    const html = renderToStaticMarkup(
      createElement(FilterPills, {
        label: 'Filter runs by status',
        options: [
          { label: 'All', href: '/runs', isSelected: false },
          { label: 'Stuck', href: '/runs?status=faulted', isSelected: true }
        ]
      })
    );
    assert.ok(html.includes('aria-label="Filter runs by status"'));
    assert.equal(html.match(/aria-current="true"/g)?.length, 1);
    assert.match(html, /<a href="\/runs\?status=faulted" aria-current="true"/);
    assert.ok(html.includes('cursor-pointer'));
  });
});
