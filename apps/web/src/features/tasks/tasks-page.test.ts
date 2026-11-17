import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import { formatAgo, formatDay } from '../../shared/format.ts';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Facets, Page } from '../../shared/url-state.ts';
import type { TaskRow, TasksClient } from './client.ts';
import { TasksPage } from './tasks-page.tsx';

const row = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: 't1',
  kind: 'task',
  queue: 'billing-review',
  title: 'Review PCR',
  subject: 'PCR-1 · Jane Doe',
  priority: 0,
  due_at: null,
  assignee_id: null,
  assignee_email: null,
  created_at: '2026-11-01T00:00:00Z',
  ...over
});

const FAULT = row({
  id: 't2',
  kind: 'fault',
  queue: 'exceptions',
  title: 'Fix import',
  subject: null,
  assignee_email: 'sam@example.com'
});

const PAGE_QUERY = 'page=1&pageSize=25&sort=waiting&dir=asc';

const FACETS: Facets = {
  queue: [
    { value: 'billing-review', count: 3 },
    { value: 'exceptions', count: 1 }
  ],
  assignee: [
    { value: 'u-me', label: 'me@example.com', count: 2 },
    { value: 'u-sam', label: 'sam@example.com', count: 1 },
    { value: 'none', count: 4 }
  ]
};

const pageOf = (items: TaskRow[]): Page<TaskRow> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  facets: FACETS
});

const fakeClient = (tasks: TaskRow[] = [row({ assignee_email: 'me@example.com' }), FAULT]) => {
  const lists: string[] = [];
  const client = {
    list: async (query: string) => {
      lists.push(query);
      return pageOf(tasks);
    }
  } as unknown as TasksClient;
  return { client, lists };
};

const show = (client: TasksClient, query = '', live: Live = idleLive) => {
  window.history.replaceState(null, '', `/tasks${query ? `?${query}` : ''}`);
  return render(createElement(TasksPage, { client, live, me: 'me@example.com' }));
};

const table = () => screen.findByRole('table', { name: 'Tasks' });

const cellsOf = (tr: HTMLElement) =>
  within(tr)
    .getAllByRole('cell')
    .map((cell) => cell.lastElementChild?.textContent);

const rows = async () =>
  within(await table())
    .getAllByRole('row')
    .slice(1)
    .map(cellsOf);

const choicesOf = async (filter: string) => {
  await userEvent.setup().click(screen.getByRole('button', { name: filter }));
  return within(screen.getByRole('dialog', { name: `Filter by ${filter}` }))
    .getAllByRole('checkbox')
    .map((c) => c.closest('label')?.textContent);
};

const here = () => `${window.location.pathname}${window.location.search}`;

describe('TasksPage', () => {
  it('lists each task with its queue, assignee and age', async () => {
    const { client, lists } = fakeClient();
    show(client);
    const ago = formatAgo('2026-11-01T00:00:00Z');
    assert.deepEqual(await rows(), [
      ['Review PCRPCR-1 · Jane Doe', 'Billing Review', 'You', '—', ago, 'Open'],
      ['Fix import', 'Stuck Runs', 'sam@example.com', '—', ago, 'Open']
    ]);
    assert.deepEqual(lists, [PAGE_QUERY]);
  });

  it('marks faults in red', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(screen.getByText('Review PCR').className, 'font-medium');
    assert.equal(screen.getByText('Fix import').className, 'text-danger font-medium');
  });

  it('opens a task and comes back to the list', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(
      screen.getByRole('link', { name: 'Open task Review PCR' }).getAttribute('href'),
      '/tasks/t1'
    );
  });

  it('says when nobody is assigned', async () => {
    const { client } = fakeClient([row()]);
    show(client);
    const [cells] = await rows();
    assert.equal(cells?.[2], 'Unassigned');
  });

  it('shows the due day, in red only once overdue', async () => {
    const { client } = fakeClient([
      row({ due_at: '2000-01-15T12:00:00Z' }),
      row({ id: 't3', title: 'Later', due_at: '2999-01-15T12:00:00Z' })
    ]);
    show(client);
    await table();
    const overdue = screen.getByText(formatDay('2000-01-15T12:00:00Z'));
    assert.equal(overdue.className, 'text-danger font-medium');
    assert.equal(screen.getByText(formatDay('2999-01-15T12:00:00Z')).className, '');
  });

  it('highlights the search in titles and subjects, and returns to it', async () => {
    const { client, lists } = fakeClient();
    show(client, 'q=doe');
    await table();
    assert.deepEqual(
      [...document.querySelectorAll('mark')].map((m) => m.textContent),
      ['Doe']
    );
    assert.equal(
      screen.getByRole('link', { name: 'Open task Review PCR' }).getAttribute('href'),
      '/tasks/t1?back=%2Ftasks%3Fq%3Ddoe'
    );
    assert.equal(lists[0], 'q=doe&page=1&pageSize=25&sort=waiting&dir=asc');
  });

  it('searches tasks from the search box', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'import');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(lists.length, 2));
    assert.equal(lists[1], 'q=import&page=1&pageSize=25&sort=waiting&dir=asc');
    assert.equal(here(), '/tasks?q=import');
  });

  it('sorts by a column from its header', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Task' }));
    assert.equal(here(), '/tasks?sort=title&dir=asc');
    await waitFor(() => assert.equal(lists.length, 2));
    assert.equal(lists[1], 'page=1&pageSize=25&sort=title&dir=asc');
  });

  it('filters by queue from the open counts in the database', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    assert.deepEqual(await choicesOf('Queue'), ['Billing Review3', 'Stuck Runs1']);
    await userEvent.setup().click(
      within(screen.getByRole('dialog', { name: 'Filter by Queue' })).getByRole('checkbox', {
        name: /Stuck Runs/
      })
    );
    assert.equal(here(), '/tasks?queue=exceptions');
    await waitFor(() => assert.equal(lists.at(-1), `${PAGE_QUERY}&queue=exceptions`));
  });

  it('names assignees by email, the signed-in user as You and nobody as Unassigned', async () => {
    const { client } = fakeClient();
    show(client, 'queue=exceptions');
    await table();
    assert.deepEqual(await choicesOf('Assignee'), ['sam@example.com1', 'Unassigned4', 'You2']);
    await userEvent.setup().click(
      within(screen.getByRole('dialog', { name: 'Filter by Assignee' })).getByRole('checkbox', {
        name: /Unassigned/
      })
    );
    assert.equal(here(), '/tasks?queue=exceptions&assignee=none');
  });

  it('lists the tasks of the chosen queues and assignees', async () => {
    const { client, lists } = fakeClient();
    show(client, 'queue=billing-review,exceptions&assignee=u-me');
    await table();
    assert.deepEqual(lists, [`${PAGE_QUERY}&queue=billing-review%2Cexceptions&assignee=u-me`]);
    assert.equal(screen.getByRole('button', { name: /^Queue/ }).textContent, 'Queue2 selected');
  });

  it('offers to clear filters that match nothing', async () => {
    const { client } = fakeClient([]);
    show(client, 'assignee=none');
    await screen.findByRole('heading', { name: 'No Matching Tasks' });
    assert.equal(
      screen.getByRole('link', { name: 'Clear Filters' }).getAttribute('href'),
      '/tasks'
    );
  });

  it('says everything is caught up when there are no tasks', async () => {
    const { client } = fakeClient([]);
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'All Caught Up' }));
    assert.ok(screen.getByText('New tasks show up here as claims need work.'));
  });

  it('reloads the tasks when a listed task changes', async () => {
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
    for (const listener of listeners) listener({ kind: 'task', id: 't1', runId: null });
    await waitFor(() => assert.equal(lists.length, 2), { timeout: 3_000 });
  });
});
