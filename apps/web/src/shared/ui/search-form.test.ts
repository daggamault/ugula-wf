import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeCount, type SearchField, SearchForm, searchHref } from './search-form.tsx';

const fields: readonly SearchField[] = [
  { name: 'lastName', label: 'Last Name' },
  { name: 'birthDate', label: 'Birth Date', type: 'date' },
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
  it('renders text, date and select fields in a card', () => {
    const html = renderToStaticMarkup(
      createElement(SearchForm, { label: 'Search Claims', path: '/claims', fields })
    );
    assert.ok(!html.includes('aria-expanded'));
    assert.ok(
      html.includes(
        '<search aria-label="Search Claims" class="border-border bg-surface rounded-xl border p-5">'
      )
    );
    assert.ok(html.includes('type="submit"') && html.includes('Search</span>'));
    assert.ok(!html.includes('Clear</span>') && !html.includes(' active</span>'));
    assert.ok(html.includes('type="date"') && html.includes('type="search"'));
    assert.ok(html.includes('@lg:grid-cols-2 @3xl:grid-cols-4') && !html.includes('w-44'));
    assert.ok(!html.includes('sr-only'));
    assert.match(html, /<\/div><\/div><div class="flex flex-col-reverse[^"]*sm:justify-end/);
    assert.match(html, /<option value="open" selected="">Open<\/option>/);
  });

  it('puts the buttons beside a lone field instead of below a grid', () => {
    const html = renderToStaticMarkup(
      createElement(SearchForm, { label: 'Search', path: '/runs', fields: fields.slice(0, 1) })
    );
    assert.ok(html.includes('sm:flex-row sm:items-end') && !html.includes('@container'));
    assert.ok(html.includes('sr-only">Last Name<'));
  });
});
