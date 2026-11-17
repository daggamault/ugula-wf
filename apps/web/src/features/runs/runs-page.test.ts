import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Facets, Page } from '../../shared/url-state.ts';
import type { RunSummary, RunsClient } from './client.ts';
import { RunsPage } from './runs-page.tsx';

const run: RunSummary = {
  id: 'r1',
  status: 'faulted',
  parent_id: null,
  parent_index: null,
  parent_wait: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  graph_id: 'g1',
  key: 'demo.batch',
  name: 'Batch',
  version: 3,
  version_id: 'v3',
  error_message: 'payer rejected'
};

const done: RunSummary = {
  ...run,
  id: 'r2',
  status: 'completed',
  name: 'Ingest',
  version: 1,
  completed_at: '2026-01-01T00:05:00Z',
  error_message: null
};

const PAGE_QUERY = 'page=1&pageSize=25&sort=started&dir=desc';

const FACETS: Facets = {
  status: [
    { value: 'completed', count: 7 },
    { value: 'faulted', count: 2 },
    { value: 'suspended', count: 1 }
  ],
  workflow: [
    { value: 'demo.ingest', label: 'Ingest', count: 6 },
    { value: 'demo.batch', label: 'Batch', count: 4 }
  ]
};

const pageOf = (items: RunSummary[]): Page<RunSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  facets: FACETS
});

const fakeClient = (items: RunSummary[] = [run, done]) => {
  const lists: string[] = [];
  const client = {
    list: async (query: string) => {
      lists.push(query);
      return pageOf(items);
    }
  } as RunsClient;
  return { client, lists };
};

const show = (client: RunsClient, query = '', live: Live = idleLive) => {
  window.history.replaceState(null, '', `/runs${query ? `?${query}` : ''}`);
  return render(createElement(RunsPage, { client, live }));
};

const choicesOf = async (filter: string) => {
  await userEvent.setup().click(screen.getByRole('button', { name: filter }));
  return within(screen.getByRole('dialog', { name: `Filter by ${filter}` }))
    .getAllByRole('checkbox')
    .map((c) => c.closest('label')?.textContent);
};

const table = () => screen.findByRole('table', { name: 'Workflow runs' });

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.lastElementChild?.textContent);

describe('RunsPage', () => {
  it('lists runs with their version, status, times and problem, newest first', async () => {
    const { client, lists } = fakeClient();
    show(client);
    const [, first, second] = within(await table()).getAllByRole('row');
    assert.ok(first && second);
    assert.deepEqual(cellsOf(first).slice(0, 5), [
      'Batch v3',
      'Stuck',
      formatDateTime(run.created_at),
      '—',
      'payer rejected'
    ]);
    assert.deepEqual(cellsOf(second).slice(0, 5), [
      'Ingest v1',
      'Completed',
      formatDateTime(done.created_at),
      formatDateTime('2026-01-01T00:05:00Z'),
      ''
    ]);
    assert.deepEqual(lists, [PAGE_QUERY]);
  });

  it('opens each run from an icon action named for the run', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(
      screen
        .getByRole('link', { name: `Open run Batch started ${formatDateTime(run.created_at)}` })
        .getAttribute('href'),
      '/runs/r1'
    );
  });

  it('lists only runs of the chosen statuses and workflows', async () => {
    const { client, lists } = fakeClient();
    show(client, 'status=faulted,failed&workflow=demo.batch');
    await table();
    assert.deepEqual(lists, [`${PAGE_QUERY}&status=faulted%2Cfailed&workflow=demo.batch`]);
    assert.equal(screen.getByRole('button', { name: /^Status/ }).textContent, 'Status2 selected');
  });

  it('filters by status from the counts in the database, named as the badges are', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    assert.deepEqual(await choicesOf('Status'), ['Completed7', 'Stuck2', 'Waiting1']);
    await userEvent.setup().click(
      within(screen.getByRole('dialog', { name: 'Filter by Status' })).getByRole('checkbox', {
        name: /Waiting/
      })
    );
    assert.equal(`${window.location.pathname}${window.location.search}`, '/runs?status=suspended');
    await waitFor(() => assert.equal(lists.at(-1), `${PAGE_QUERY}&status=suspended`));
  });

  it('filters by workflow name', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.deepEqual(await choicesOf('Workflow'), ['Batch4', 'Ingest6']);
    await userEvent.setup().click(
      within(screen.getByRole('dialog', { name: 'Filter by Workflow' })).getByRole('checkbox', {
        name: /Batch/
      })
    );
    assert.equal(window.location.search, '?workflow=demo.batch');
  });

  it('searches runs and highlights the match in names and problems', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'rej');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(lists.length, 2));
    assert.equal(lists[1], 'q=rej&page=1&pageSize=25&sort=started&dir=desc');
    await waitFor(() =>
      assert.deepEqual(
        [...document.querySelectorAll('mark')].map((m) => m.textContent),
        ['rej']
      )
    );
  });

  it('sorts runs by a column', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    await userEvent.setup().click(screen.getByRole('link', { name: /^Workflow/ }));
    await waitFor(() => assert.equal(lists.length, 2));
    assert.equal(lists[1], 'page=1&pageSize=25&sort=workflow&dir=asc');
  });

  it('says runs show up as workflows start when there are none', async () => {
    const { client } = fakeClient([]);
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Runs Yet' }));
    assert.ok(screen.getByText('Runs show up here as workflows start.'));
  });

  it('offers to clear filters that find no runs', async () => {
    const { client } = fakeClient([]);
    show(client, 'status=cancelled');
    assert.ok(await screen.findByRole('heading', { name: 'No Matching Runs' }));
    assert.ok(screen.getByText('Nothing matches these filters.'));
    assert.equal(screen.getByRole('link', { name: 'Clear Filters' }).getAttribute('href'), '/runs');
  });

  it('reloads when a run changes and ignores other events', async () => {
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    const { client, lists } = fakeClient();
    show(client, '', live);
    await table();
    const emit = (e: LiveEvent) => {
      for (const listener of listeners) listener(e);
    };
    emit({ kind: 'task', id: 't1', runId: 'r1' });
    emit({ kind: 'run', id: 'r9', status: 'running', parentId: null });
    emit({ kind: 'run', id: 'r1', status: 'completed', parentId: null });
    await waitFor(() => assert.equal(lists.length, 2), { timeout: 3000 });
  });
});
