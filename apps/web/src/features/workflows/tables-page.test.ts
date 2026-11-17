import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Facets, Page } from '../../shared/url-state.ts';
import type { TableSummary, WorkflowsClient } from './client.ts';
import { TablesPage, tableKindLabel } from './tables-page.tsx';

const table = (patch: Partial<TableSummary>): TableSummary => ({
  id: 't1',
  key: 'billing.base-rate',
  name: 'Base Rate',
  kind: 'decide',
  description: '',
  scope: 'system',
  overrides: null,
  overriddenBy: null,
  isStale: false,
  publishedVersion: 1,
  draftVersion: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch
});

const listed = [
  table({ overriddenBy: 't2' }),
  table({
    id: 't2',
    name: 'Mileage Rate',
    key: 'billing.mileage',
    scope: 'agency',
    kind: 'lookup',
    isStale: true,
    publishedVersion: null,
    draftVersion: 2
  })
];

const pageOf = (items: TableSummary[], facets?: Facets): Page<TableSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...(facets ? { facets } : {})
});

const fakeClient = (items: TableSummary[] = listed, facets?: Facets) => {
  const queries: string[] = [];
  const client = {
    tables: {
      search: async (query: string) => {
        queries.push(query);
        return pageOf(items, facets);
      }
    }
  } as unknown as WorkflowsClient;
  return { client, queries };
};

const show = (client: WorkflowsClient, query = '', live: Live = idleLive) => {
  window.history.replaceState(null, '', `/tables${query ? `?${query}` : ''}`);
  return render(createElement(TablesPage, { client, live }));
};

const list = () => screen.findByRole('table', { name: 'Tables' });

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.lastElementChild?.textContent);

describe('TablesPage', () => {
  it('lists tables with their key, kind, scope and versions', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const [, built, custom] = within(await list()).getAllByRole('row');
    assert.ok(built && custom);
    assert.deepEqual(cellsOf(built).slice(0, 6), [
      'Base Rate',
      'billing.base-rate',
      'Decision Table',
      'StandardHas Custom Copy',
      'v1',
      '—'
    ]);
    assert.deepEqual(cellsOf(custom).slice(0, 6), [
      'Mileage Rate',
      'billing.mileage',
      'Lookup Table',
      'CustomBase Updated',
      '—',
      'v2'
    ]);
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc']);
  });

  it('edits each table from an icon action', async () => {
    const { client } = fakeClient();
    show(client);
    await list();
    assert.deepEqual(
      ['Edit Base Rate', 'Edit Mileage Rate'].map((name) =>
        screen.getByRole('link', { name }).getAttribute('href')
      ),
      ['/tables/t1', '/tables/t2']
    );
  });

  it('searches tables and highlights the match in names and keys', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await list();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'rate');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'q=rate&page=1&pageSize=25&sort=name&dir=asc');
    assert.equal(window.location.search, '?q=rate');
    await waitFor(() =>
      assert.deepEqual(
        [...document.querySelectorAll('mark')].map((m) => m.textContent),
        ['Rate', 'rate', 'Rate']
      )
    );
  });

  it('sorts tables by key', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await list();
    await userEvent.setup().click(screen.getByRole('link', { name: /^Key/ }));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'page=1&pageSize=25&sort=key&dir=asc');
  });

  it('asks for the chosen kinds and scopes', async () => {
    const { client, queries } = fakeClient();
    show(client, 'kind=lookup&scope=agency');
    await list();
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc&kind=lookup&scope=agency']);
    assert.equal(screen.getByRole('button', { name: /^Scope/ }).textContent, 'Scope1 selected');
  });

  it('filters by kind from the counts in the database', async () => {
    const { client } = fakeClient(listed, {
      kind: [
        { value: 'decide', count: 7 },
        { value: 'lookup', count: 2 }
      ],
      scope: []
    });
    show(client);
    await list();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Kind' }));
    const panel = screen.getByRole('dialog', { name: 'Filter by Kind' });
    assert.deepEqual(
      within(panel)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
      ['Decision Table7', 'Lookup Table2']
    );
    await user.click(within(panel).getByRole('checkbox', { name: /Lookup Table/ }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/tables?kind=lookup');
  });

  it('says there are no tables yet', async () => {
    const { client } = fakeClient([]);
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Tables Yet' }));
  });

  it('offers to clear filters that match nothing', async () => {
    const { client } = fakeClient([]);
    show(client, 'scope=agency');
    assert.ok(await screen.findByRole('heading', { name: 'No Matching Tables' }));
    assert.equal(
      screen.getByRole('link', { name: 'Clear Filters' }).getAttribute('href'),
      '/tables'
    );
  });

  it('reloads after the live connection comes back', async () => {
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    const { client, queries } = fakeClient();
    show(client, '', live);
    await list();
    for (const listener of listeners) listener({ kind: 'task', id: 't1', runId: 'r1' });
    for (const listener of listeners) listener(null);
    await waitFor(() => assert.equal(queries.length, 2));
  });
});

describe('tableKindLabel', () => {
  it('names each kind of table', () => {
    assert.deepEqual(
      [tableKindLabel('decide'), tableKindLabel('lookup')],
      ['Decision Table', 'Lookup Table']
    );
  });
});
