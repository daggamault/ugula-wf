import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { RunStatus } from '../../shared/ui/run-status-badge.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { RunSummary, RunsClient } from './client.ts';
import { RunsPage, statusOptions } from './runs-page.tsx';

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

const pageOf = (items: RunSummary[]): Page<RunSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (items: RunSummary[] = [run, done]) => {
  const lists: [RunStatus | null, string][] = [];
  const client = {
    list: async (status: RunStatus | null, query: string) => {
      lists.push([status, query]);
      return pageOf(items);
    }
  } as RunsClient;
  return { client, lists };
};

const show = (client: RunsClient, status: RunStatus | null = null, live: Live = idleLive) =>
  render(createElement(RunsPage, { client, live, status }));

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
    assert.deepEqual(lists, [[null, 'page=1&pageSize=25&sort=started&dir=desc']]);
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

  it('lists only runs of the chosen status', async () => {
    const { client, lists } = fakeClient();
    show(client, 'faulted');
    await table();
    assert.deepEqual(lists, [['faulted', 'page=1&pageSize=25&sort=started&dir=desc']]);
    assert.equal(screen.getByRole('button', { name: 'Status' }).textContent, 'Stuck');
  });

  it('goes to the filter for the status chosen', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('option', { name: 'Waiting' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/runs?status=suspended');
  });

  it('searches runs and highlights the match in names and problems', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'rej');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(lists.length, 2));
    assert.deepEqual(lists[1], [null, 'q=rej&page=1&pageSize=25&sort=started&dir=desc']);
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
    assert.deepEqual(lists[1], [null, 'page=1&pageSize=25&sort=workflow&dir=asc']);
  });

  it('says runs show up as workflows start when there are none', async () => {
    const { client } = fakeClient([]);
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Runs Yet' }));
    assert.ok(screen.getByText('Runs show up here as workflows start.'));
  });

  it('says nothing matches when a status filter finds no runs', async () => {
    const { client } = fakeClient([]);
    show(client, 'cancelled');
    assert.ok(await screen.findByRole('heading', { name: 'No Matching Runs' }));
    assert.ok(screen.getByText('Nothing matches these filters.'));
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
    show(client, null, live);
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

describe('statusOptions', () => {
  it('links every run status to its filter, after one for all statuses', () => {
    const options = statusOptions((name, value) => (value ? `/runs?${name}=${value}` : '/runs'));
    assert.deepEqual(options, [
      { value: '', label: 'All Statuses', href: '/runs' },
      { value: 'running', label: 'Running', href: '/runs?status=running' },
      { value: 'suspended', label: 'Waiting', href: '/runs?status=suspended' },
      { value: 'faulted', label: 'Stuck', href: '/runs?status=faulted' },
      { value: 'completed', label: 'Completed', href: '/runs?status=completed' },
      { value: 'failed', label: 'Failed', href: '/runs?status=failed' },
      { value: 'cancelled', label: 'Cancelled', href: '/runs?status=cancelled' }
    ]);
  });
});
