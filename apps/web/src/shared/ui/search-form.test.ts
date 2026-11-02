import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeCount, type SearchField, SearchForm, searchHref } from './search-form.tsx';

const fields: readonly SearchField[] = [
  { name: 'lastName', label: 'Last name' },
  { name: 'birthDate', label: 'Birth date', type: 'date' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    defaultValue: 'open',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'paid', label: 'Paid' }
    ]
  }
];

describe('searchHref', () => {
  it('keeps set filters, drops blanks and defaults, and resets paging', () => {
    const query = new URLSearchParams('page=3&sort=total');
    assert.equal(
      searchHref('/claims', query, fields, { lastName: ' Doe ', birthDate: '', status: 'open' }),
      '/claims?sort=total&lastName=Doe'
    );
    assert.equal(
      searchHref('/claims', query, fields, { status: 'paid' }),
      '/claims?sort=total&status=paid'
    );
  });

  it('counts only filters that differ from their defaults', () => {
    assert.equal(activeCount(fields, new URLSearchParams('status=open')), 0);
    assert.equal(activeCount(fields, new URLSearchParams('status=paid&lastName=Doe')), 2);
  });
});

describe('SearchForm', () => {
  it('renders text, date and select fields, collapsible under a title', () => {
    const html = renderToStaticMarkup(
      createElement(SearchForm, {
        label: 'Filter claims',
        path: '/claims',
        fields,
        collapsibleTitle: 'Filters'
      })
    );
    assert.ok(html.includes('aria-expanded="true"') && html.includes('>Filters'));
    assert.ok(html.includes('type="date"') && html.includes('type="search"'));
    assert.match(html, /<option value="open" selected="">Open<\/option>/);
    const inline = renderToStaticMarkup(
      createElement(SearchForm, { label: 'Search', path: '/patients', fields })
    );
    assert.ok(!inline.includes('aria-expanded'));
  });
});
