import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { Payer, PayersClient } from './client.ts';
import { FILING_OPTIONS, filingLabel, LearnedNames, PayersPage } from './payers-page.tsx';

const medicare: Payer = {
  id: 'p1',
  name: 'Medicare',
  payer_code: '00952',
  claim_filing: 'MB',
  filing_limit_days: null,
  correction_method: null,
  appeal_days: null,
  plan_type: null,
  is_searchable: false,
  aliases: [{ id: 'a1', alias: 'MCR Part B' }]
};

const acme: Payer = {
  ...medicare,
  id: 'p2',
  name: 'Acme Health',
  payer_code: 'ACM01',
  claim_filing: 'ZZ',
  aliases: []
};

const pageOf = (items: Payer[]): Page<Payer> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (over: Partial<PayersClient> = {}) => {
  const queries: string[] = [];
  const removed: string[] = [];
  const client = {
    search: async (query: string) => {
      queries.push(query);
      return pageOf([medicare, acme]);
    },
    remove: async (id: string) => {
      removed.push(id);
      return { id };
    },
    ...over
  } as PayersClient;
  return { client, queries, removed };
};

const show = (client: PayersClient) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(PayersPage, { client, live: idleLive })
    )
  );
  return toasts;
};

const table = () => screen.findByRole('table', { name: 'Payers' });

/** The visible value of each cell, without the label shown on narrow screens. */
const valuesOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .slice(0, 3)
    .map((cell) => cell.lastElementChild?.textContent);

const confirmDelete = async (name: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `Delete ${name}` }));
  const dialog = screen.getByRole('dialog', { name: `Delete ${name}?` });
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
};

describe('PayersPage', () => {
  it('lists payers by name with their learned names, payer ID and claim filing', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const rows = within(await table()).getAllByRole('row');
    assert.deepEqual(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
      ['Payer', 'Clearinghouse Payer ID', 'Claim Filing', 'Actions']
    );
    assert.deepEqual(
      rows.slice(1).map((r) => valuesOf(r)),
      [
        ['MedicareMCR Part B', '00952', 'MB · Medicare Part B'],
        ['Acme Health', 'ACM01', 'ZZ']
      ]
    );
    assert.deepEqual(
      within(screen.getByRole('list', { name: 'Learned Names for Medicare' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['MCR Part B']
    );
    assert.ok(!screen.queryByRole('list', { name: 'Learned Names for Acme Health' }));
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc']);
  });

  it('searches payers and highlights matches in names, learned names and IDs', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    const box = screen.getByRole('searchbox', { name: 'Search' });
    assert.equal(box.getAttribute('placeholder'), 'Search payers');
    await user.type(box, 'part');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'q=part&page=1&pageSize=25&sort=name&dir=asc');
    assert.equal(window.location.search, '?q=part');
    await waitFor(() =>
      assert.deepEqual(
        Array.from(document.querySelectorAll('mark'), (m) => m.textContent),
        ['Part']
      )
    );
    assert.equal(
      screen.getByRole('link', { name: 'Edit Medicare' }).getAttribute('href'),
      '/payers/p1?back=%2Fpayers%3Fq%3Dpart'
    );
  });

  it('edits each payer on its own page', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(
      screen.getByRole('link', { name: 'Edit Medicare' }).getAttribute('href'),
      '/payers/p1'
    );
    assert.equal(
      screen.getByRole('link', { name: 'Edit Acme Health' }).getAttribute('href'),
      '/payers/p2'
    );
  });

  it('adds payers on their own page', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(
      screen.getByRole('link', { name: 'Add Payer' }).getAttribute('href'),
      '/payers/new'
    );
  });

  it('filters by claim filing from the counts in the database', async () => {
    window.history.replaceState(null, '', '/payers');
    const { client, queries } = fakeClient({
      search: async (query: string) => {
        queries.push(query);
        return {
          ...pageOf([medicare, acme]),
          facets: {
            filing: [
              { value: 'ZZ', count: 2 },
              { value: 'MB', count: 7 }
            ]
          }
        };
      }
    });
    show(client);
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Claim Filing' }));
    const panel = screen.getByRole('dialog', { name: 'Filter by Claim Filing' });
    assert.deepEqual(
      within(panel)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
      [`${filingLabel('MB')}7`, `${filingLabel('ZZ')}2`]
    );
    await user.click(within(panel).getByRole('checkbox', { name: /Medicare Part B/ }));
    assert.equal(window.location.search, '?filing=MB');
    await waitFor(() =>
      assert.equal(queries.at(-1), 'page=1&pageSize=25&sort=name&dir=asc&filing=MB')
    );
  });

  it('suggests adding a payer when there are none', async () => {
    const { client } = fakeClient({ search: async () => pageOf([]) });
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Payers Yet' }));
    assert.ok(
      screen.getByText('Claims cannot go in an 837P file until their payers are listed here.')
    );
    assert.equal(screen.getAllByRole('link', { name: 'Add Payer' }).length, 2);
  });

  it('explains what deleting a payer does before deleting it and reloading the list', async () => {
    const { client, queries, removed } = fakeClient();
    const toasts = show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Medicare' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Medicare?' });
    assert.ok(
      within(dialog).getByText(
        'Its prices are removed, and claims billed to Medicare cannot go in an 837P file until it is added again.'
      )
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Medicare deleted' }]));
    assert.deepEqual(removed, ['p1']);
    await waitFor(() => assert.equal(queries.length, 2));
  });

  it('keeps the payer when the deletion is not confirmed', async () => {
    const { client, removed } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Medicare' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Medicare?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.equal(dialog.hasAttribute('open'), false);
    assert.deepEqual(removed, []);
  });

  it('says why a payer could not be deleted and keeps the list', async () => {
    const { client, queries } = fakeClient({
      remove: async () => {
        throw new Error('Payer is billed on open claims');
      }
    });
    const toasts = show(client);
    await table();
    await confirmDelete('Medicare');
    await waitFor(() =>
      assert.deepEqual(toasts, [
        {
          intent: 'danger',
          title: 'Could not delete payer',
          description: 'Payer is billed on open claims'
        }
      ])
    );
    assert.equal(queries.length, 1);
  });
});

describe('LearnedNames', () => {
  it('shows nothing for a payer without learned names', () => {
    const { container } = render(
      createElement(LearnedNames, { payer: { ...medicare, aliases: [] } })
    );
    assert.equal(container.innerHTML, '');
  });
});

describe('filingLabel', () => {
  it('names known claim filing codes', () => {
    assert.equal(filingLabel('MB'), 'MB · Medicare Part B');
    assert.deepEqual(
      FILING_OPTIONS.find((o) => o.value === 'MB'),
      { value: 'MB', label: 'MB · Medicare Part B' }
    );
  });

  it('keeps unknown codes as they are', () => {
    assert.equal(filingLabel('ZZ'), 'ZZ');
  });
});
