import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { navigate } from '../router.tsx';
import { act, render, screen, userEvent, within } from '../testing-dom.ts';
import { activeCount, type SearchField, SearchForm, searchHref } from './search-form.tsx';

const fields: readonly SearchField[] = [
  { name: 'lastName', label: 'Last Name', placeholder: 'Doe' },
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

const show = (url: string, shown: readonly SearchField[] = fields) => {
  window.history.replaceState(null, '', url);
  render(createElement(SearchForm, { label: 'Search Claims', path: '/claims', fields: shown }));
  return userEvent.setup();
};

const form = () => {
  const search = document.querySelector('search');
  assert.equal(search?.getAttribute('aria-label'), 'Search Claims');
  return search as HTMLElement;
};

const here = () => `${window.location.pathname}${window.location.search}`;

describe('searchHref', () => {
  it('keeps set filters trimmed and drops blanks and defaults', () => {
    assert.equal(
      searchHref('/claims', new URLSearchParams(), fields, {
        lastName: ' Doe ',
        birthDate: '',
        status: 'open'
      }),
      '/claims?lastName=Doe'
    );
  });

  it('keeps other parameters but goes back to the first page', () => {
    assert.equal(
      searchHref('/claims', new URLSearchParams('page=3&sort=total'), fields, { status: 'paid' }),
      '/claims?sort=total&status=paid'
    );
  });

  it('removes filters that were set before but are now blank', () => {
    assert.equal(
      searchHref('/claims', new URLSearchParams('lastName=Doe&status=paid'), fields, {
        lastName: '   '
      }),
      '/claims'
    );
  });
});

describe('activeCount', () => {
  it('counts only filters that differ from their defaults', () => {
    assert.equal(activeCount(fields, new URLSearchParams('status=open')), 0);
    assert.equal(activeCount(fields, new URLSearchParams('status=paid&lastName=Doe')), 2);
  });

  it('ignores blank values and parameters that are not fields', () => {
    assert.equal(activeCount(fields, new URLSearchParams('lastName=%20&sort=total')), 0);
  });
});

describe('SearchForm', () => {
  it('labels a search landmark with text, date and select fields', () => {
    show('/claims');
    const search = form();
    const name = within(search).getByRole('searchbox', { name: 'Last Name' });
    assert.equal(name.getAttribute('placeholder'), 'Doe');
    assert.equal(within(search).getByLabelText('Birth Date').getAttribute('type'), 'date');
    assert.equal(within(search).getByRole('button', { name: 'Status' }).textContent, 'Open');
    assert.equal(
      within(search).getByRole('button', { name: 'Search' }).getAttribute('type'),
      'submit'
    );
  });

  it('fills the fields from the address', () => {
    show('/claims?lastName=Doe&birthDate=1980-02-03&status=paid');
    assert.equal(
      (screen.getByRole('searchbox', { name: 'Last Name' }) as HTMLInputElement).value,
      'Doe'
    );
    assert.equal((screen.getByLabelText('Birth Date') as HTMLInputElement).value, '1980-02-03');
    assert.equal(screen.getByRole('button', { name: 'Status' }).textContent, 'Paid');
  });

  it('searches with what was entered and keeps the sort', async () => {
    const user = show('/claims?sort=total&page=4');
    await user.type(screen.getByRole('searchbox', { name: 'Last Name' }), ' Doe ');
    await user.click(screen.getByRole('option', { name: 'Paid' }));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    assert.equal(here(), '/claims?sort=total&lastName=Doe&status=paid');
  });

  it('searches when Enter is pressed in a field', async () => {
    const user = show('/claims');
    await user.type(screen.getByRole('searchbox', { name: 'Last Name' }), 'Roe{Enter}');
    assert.equal(here(), '/claims?lastName=Roe');
  });

  it('offers no Clear button until a filter is set', () => {
    show('/claims?status=open&sort=total');
    assert.ok(!screen.queryByRole('button', { name: 'Clear' }));
  });

  it('clears every filter but keeps the sort', async () => {
    const user = show('/claims?lastName=Doe&status=paid&sort=total&page=2');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    assert.equal(here(), '/claims?sort=total');
  });

  it('refills the fields when the address changes elsewhere', async () => {
    const user = show('/claims');
    await user.type(screen.getByRole('searchbox', { name: 'Last Name' }), 'Typed');
    act(() => navigate('/claims?lastName=Roe'));
    assert.equal(
      (screen.getByRole('searchbox', { name: 'Last Name' }) as HTMLInputElement).value,
      'Roe'
    );
  });

  it('hides the label of a lone field but still names it', () => {
    show('/claims', fields.slice(0, 1));
    const label = screen.getByText('Last Name');
    assert.equal(label.tagName, 'LABEL');
    assert.equal(label.classList.contains('sr-only'), true);
    assert.equal(screen.getByRole('searchbox', { name: 'Last Name' }).tagName, 'INPUT');
  });

  it('shows the labels of several fields', () => {
    show('/claims');
    assert.equal(screen.getByText('Last Name').classList.contains('sr-only'), false);
  });
});
