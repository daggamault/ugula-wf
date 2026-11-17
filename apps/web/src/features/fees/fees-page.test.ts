import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { Fee, FeesClient } from './client.ts';
import { FeesPage, feeDeleteNote, feeName } from './fees-page.tsx';

const fee = (over: Partial<Fee> = {}): Fee => ({
  id: 'f1',
  payer_id: null,
  payer: null,
  code: 'A0427',
  amount_cents: 95000,
  updated_at: '2026-10-01T00:00:00Z',
  ...over
});

const listed = [fee(), fee({ id: 'f2', payer_id: 'p-m', payer: 'Medicare', amount_cents: 50000 })];

const pageOf = (items: Fee[]): Page<Fee> => ({ items, total: items.length, page: 1, pageSize: 25 });

const fakeClient = (over: Partial<FeesClient> = {}) => {
  const queries: string[] = [];
  const removed: string[] = [];
  const client = {
    search: async (query: string) => {
      queries.push(query);
      return pageOf(listed);
    },
    remove: async (id: string) => {
      removed.push(id);
      return { id };
    },
    ...over
  } as FeesClient;
  return { client, queries, removed };
};

const show = (client: FeesClient) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(FeesPage, { client, live: idleLive })
    )
  );
  return toasts;
};

const table = () => screen.findByRole('table', { name: 'Fee schedule' });

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .slice(0, 4)
    .map((c) => c.lastElementChild?.textContent);

const openDelete = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Delete Medicare A0427' }));
  return screen.getByRole('dialog', { name: 'Delete Medicare A0427?' });
};

describe('FeesPage', () => {
  it('lists default and payer prices', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const rows = within(await table()).getAllByRole('row');
    const updated = formatDateTime('2026-10-01T00:00:00Z');
    assert.deepEqual(
      rows.slice(1).map((r) => cellsOf(r)),
      [
        ['Default', 'A0427', '$950.00', updated],
        ['Medicare', 'A0427', '$500.00', updated]
      ]
    );
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=payer&dir=asc']);
  });

  it('searches fees and highlights the matching codes', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'a04');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'q=a04&page=1&pageSize=25&sort=payer&dir=asc');
    await waitFor(() =>
      assert.deepEqual(
        Array.from(document.querySelectorAll('mark'), (m) => m.textContent),
        ['A04', 'A04']
      )
    );
    assert.equal(
      screen.getByRole('link', { name: 'Edit Default A0427' }).getAttribute('href'),
      '/fees/f1?back=%2Ffees%3Fq%3Da04'
    );
  });

  it('sorts by amount, highest first', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('columnheader', { name: 'Amount' })).getByRole('link')
    );
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'page=1&pageSize=25&sort=amount&dir=desc');
    assert.equal(
      screen.getByRole('columnheader', { name: 'Amount' }).getAttribute('aria-sort'),
      'descending'
    );
  });

  it('filters by payer and code from the counts in the database', async () => {
    window.history.replaceState(null, '', '/fees');
    const { client, queries } = fakeClient({
      search: async (query: string) => {
        queries.push(query);
        return {
          ...pageOf(listed),
          facets: {
            payer: [
              { value: 'p-m', label: 'Medicare', count: 1 },
              { value: 'default', label: 'Default', count: 1 }
            ],
            code: [{ value: 'A0427', label: 'ALS1, emergency transport (A0427)', count: 2 }]
          }
        };
      }
    });
    show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'HCPCS' }));
    assert.deepEqual(
      within(screen.getByRole('dialog', { name: 'Filter by HCPCS' }))
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
      ['ALS1, emergency transport (A0427)2']
    );
    await user.click(screen.getByRole('button', { name: 'Payer' }));
    const panel = screen.getByRole('dialog', { name: 'Filter by Payer' });
    assert.deepEqual(
      within(panel)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
      ['Default1', 'Medicare1']
    );
    await user.click(within(panel).getByRole('checkbox', { name: /Default/ }));
    assert.equal(window.location.search, '?payer=default');
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'page=1&pageSize=25&sort=payer&dir=asc&payer=default');
  });

  it('offers to add a fee that returns to the searched list', async () => {
    window.history.replaceState(null, '', '/fees?q=a04');
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(
      screen.getByRole('link', { name: 'Add Fee' }).getAttribute('href'),
      '/fees/new?back=%2Ffees%3Fq%3Da04'
    );
  });

  it('suggests adding a fee when there are none', async () => {
    const { client } = fakeClient({ search: async () => pageOf([]) });
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Fees Yet' }));
    assert.ok(screen.getByText('Claims cannot be priced until each code has a fee.'));
    assert.equal(screen.getAllByRole('link', { name: 'Add Fee' }).length, 2);
  });

  it('deletes a fee once confirmed and reloads the list', async () => {
    const { client, queries, removed } = fakeClient();
    const toasts = show(client);
    await table();
    const user = userEvent.setup();
    const dialog = await openDelete(user);
    assert.ok(
      within(dialog).getByText('Claims will no longer be priced with $500.00 for Medicare A0427.')
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Medicare A0427 deleted' }]));
    assert.deepEqual(removed, ['f2']);
    await waitFor(() => assert.equal(queries.length, 2));
  });

  it('keeps the fee when the deletion is not confirmed', async () => {
    const { client, removed } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    const dialog = await openDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.equal(dialog.hasAttribute('open'), false);
    assert.deepEqual(removed, []);
  });

  it('says why a fee could not be deleted', async () => {
    const { client, queries } = fakeClient({
      remove: async () => {
        throw new Error('Fee is in use');
      }
    });
    const toasts = show(client);
    await table();
    const user = userEvent.setup();
    await user.click(within(await openDelete(user)).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      assert.deepEqual(toasts, [
        { intent: 'danger', title: 'Could not delete fee', description: 'Fee is in use' }
      ])
    );
    assert.equal(queries.length, 1);
  });
});

describe('feeName', () => {
  it('names a fee by its payer, or as the default', () => {
    assert.equal(feeName({ payer: null, code: 'A0427' }), 'Default A0427');
    assert.equal(feeName({ payer: 'Medicare', code: 'A0425' }), 'Medicare A0425');
  });
});

describe('feeDeleteNote', () => {
  it('says which price claims stop using', () => {
    assert.equal(
      feeDeleteNote(fee({ payer: 'Medicare', amount_cents: 50_050 })),
      'Claims will no longer be priced with $500.50 for Medicare A0427.'
    );
  });
});
