import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Page } from '../../shared/url-state.ts';
import type { TableSummary, WorkflowsClient } from './client.ts';
import { TablesPage, tableFilterOf, tableKindLabel } from './tables-page.tsx';

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

const pageOf = (items: TableSummary[]): Page<TableSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (items: TableSummary[] = listed) => {
  const queries: string[] = [];
  const client = {
    tables: {
      search: async (query: string) => {
        queries.push(query);
        return pageOf(items);
      }
    }
  } as unknown as WorkflowsClient;
  return { client, queries };
};

const show = (
  client: WorkflowsClient,
  filter: 'all' | 'customized' = 'all',
  live: Live = idleLive
) => render(createElement(TablesPage, { client, live, show: filter }));

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
      'Built-inHas Your Copy',
      'v1',
      '—'
    ]);
    assert.deepEqual(cellsOf(custom).slice(0, 6), [
      'Mileage Rate',
      'billing.mileage',
      'Lookup Table',
      'AgencyBase Updated',
      '—',
      'v2'
    ]);
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc&show=all']);
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
    assert.equal(queries[1], 'q=rate&page=1&pageSize=25&sort=name&dir=asc&show=all');
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
    assert.equal(queries[1], 'page=1&pageSize=25&sort=key&dir=asc&show=all');
  });

  it('lists only customized tables when chosen', async () => {
    const { client, queries } = fakeClient();
    show(client, 'customized');
    await list();
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc&show=customized']);
    assert.equal(screen.getByRole('button', { name: 'Show' }).textContent, 'Customized');
  });

  it('goes to the filter chosen', async () => {
    const { client } = fakeClient();
    show(client);
    await list();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByRole('option', { name: 'Customized' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/tables?show=customized');
  });

  it('says there are no tables yet', async () => {
    const { client } = fakeClient([]);
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Tables Yet' }));
  });

  it('says nothing is customized yet under the customized filter', async () => {
    const { client } = fakeClient([]);
    show(client, 'customized');
    assert.ok(await screen.findByRole('heading', { name: 'Nothing Customized Yet' }));
    assert.ok(screen.getByText('Every table is as built. Override one to change its rules.'));
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
    show(client, 'all', live);
    await list();
    for (const listener of listeners) listener({ kind: 'task', id: 't1', runId: 'r1' });
    for (const listener of listeners) listener(null);
    await waitFor(() => assert.equal(queries.length, 2));
  });
});

describe('tableFilterOf', () => {
  it('reads the customized filter and defaults to all', () => {
    assert.equal(tableFilterOf(new URLSearchParams('show=customized')), 'customized');
    assert.equal(tableFilterOf(new URLSearchParams('show=x')), 'all');
    assert.equal(tableFilterOf(new URLSearchParams()), 'all');
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
