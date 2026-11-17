import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import { formatAgo, formatDay } from '../../shared/format.ts';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Page } from '../../shared/url-state.ts';
import type { QueueSummary, TaskFilter, TaskRow, TasksClient } from './client.ts';
import { assigneeOptions, queueOptions, TasksPage } from './tasks-page.tsx';

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
  claim_id: 'c1',
  claim_number: '20261101-0012',
  first_name: 'Jane',
  last_name: 'Doe',
  ...over
});

const FAULT = row({
  id: 't2',
  kind: 'fault',
  queue: 'exceptions',
  title: 'Fix import',
  subject: null,
  claim_id: null,
  claim_number: null,
  first_name: null,
  last_name: null,
  assignee_email: 'sam@example.com'
});

const href = (name: string, value: string | null) =>
  value === null ? `/tasks?drop=${name}` : `/tasks?${name}=${value}`;

const queue = (name: string, open: number): QueueSummary => ({
  queue: name,
  open,
  unassigned: 0,
  mine: 0,
  oldest: '2026-11-01T00:00:00Z'
});

const ALL: TaskFilter = { queue: null, assignee: 'all' };

const pageOf = (items: TaskRow[]): Page<TaskRow> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (
  tasks: TaskRow[] = [row({ assignee_email: 'me@example.com' }), FAULT],
  queues: QueueSummary[] = [queue('billing-review', 3), queue('exceptions', 1)]
) => {
  const lists: [TaskFilter, string][] = [];
  let queueLoads = 0;
  const client = {
    list: async (filter: TaskFilter, query: string) => {
      lists.push([filter, query]);
      return pageOf(tasks);
    },
    queues: async () => {
      queueLoads++;
      return queues;
    }
  } as unknown as TasksClient;
  return { client, lists, queueLoads: () => queueLoads };
};

const show = (client: TasksClient, filter: TaskFilter = ALL, live: Live = idleLive) =>
  render(createElement(TasksPage, { client, live, me: 'me@example.com', filter }));

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

const choose = async (list: string, option: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: list }));
  await user.click(
    within(screen.getByRole('listbox', { name: list })).getByRole('option', { name: option })
  );
};

const here = () => `${window.location.pathname}${window.location.search}`;

describe('queueOptions', () => {
  it('offers every queue with its open count after all queues', () => {
    assert.deepEqual(queueOptions([queue('billing-review', 3)], null, href), [
      { value: '', label: 'All Queues', href: '/tasks?drop=queue' },
      { value: 'billing-review', label: 'Billing Review (3)', href: '/tasks?queue=billing-review' }
    ]);
  });

  it('keeps a picked queue that has emptied', () => {
    assert.deepEqual(queueOptions([queue('billing-review', 3)], 'custom-intake', href).at(-1), {
      value: 'custom-intake',
      label: 'Custom Intake (0)',
      href: '/tasks?queue=custom-intake'
    });
  });

  it('does not repeat a picked queue that is listed', () => {
    assert.deepEqual(
      queueOptions([queue('billing-review', 3)], 'billing-review', href).map((o) => o.value),
      ['', 'billing-review']
    );
  });
});

describe('assigneeOptions', () => {
  it('filters by anyone, the signed in user or nobody', () => {
    assert.deepEqual(assigneeOptions(href), [
      { value: 'all', label: 'Anyone', href: '/tasks?drop=assignee' },
      { value: 'mine', label: 'Assigned to Me', href: '/tasks?assignee=mine' },
      { value: 'unassigned', label: 'Unassigned', href: '/tasks?assignee=unassigned' }
    ]);
  });
});

describe('TasksPage', () => {
  it('lists each task with its queue, claim, patient, assignee and age', async () => {
    const { client, lists } = fakeClient();
    show(client);
    const ago = formatAgo('2026-11-01T00:00:00Z');
    assert.deepEqual(await rows(), [
      [
        'Review PCRPCR-1 · Jane Doe',
        'Billing Review',
        '20261101-0012Doe, Jane',
        'You',
        '—',
        ago,
        'Open'
      ],
      ['Fix import', 'Stuck Runs', '—', 'sam@example.com', '—', ago, 'Open']
    ]);
    assert.deepEqual(lists, [[ALL, 'page=1&pageSize=25&sort=waiting&dir=asc']]);
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

  it('says when the claim has no patient yet and when nobody is assigned', async () => {
    const { client } = fakeClient([row({ first_name: null, last_name: null })]);
    show(client);
    const [cells] = await rows();
    assert.equal(cells?.[2], '20261101-0012Not matched yet');
    assert.equal(cells?.[3], 'Unassigned');
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

  it('highlights the search in titles, patients and claim numbers, and returns to it', async () => {
    window.history.replaceState(null, '', '/tasks?q=doe');
    const { client, lists } = fakeClient();
    show(client);
    await table();
    assert.deepEqual(
      [...document.querySelectorAll('mark')].map((m) => m.textContent),
      ['Doe', 'Doe']
    );
    assert.equal(
      screen.getByRole('link', { name: 'Open task Review PCR' }).getAttribute('href'),
      '/tasks/t1?back=%2Ftasks%3Fq%3Ddoe'
    );
    assert.equal(lists[0]?.[1], 'q=doe&page=1&pageSize=25&sort=waiting&dir=asc');
  });

  it('highlights a searched claim number however it is typed', async () => {
    window.history.replaceState(null, '', '/tasks?q=%23202611010012');
    const { client } = fakeClient();
    show(client);
    await table();
    assert.deepEqual(
      [...document.querySelectorAll('mark')].map((m) => m.textContent),
      ['20261101-0012']
    );
  });

  it('searches tasks from the search box', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'import');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(lists.length, 2));
    assert.equal(lists[1]?.[1], 'q=import&page=1&pageSize=25&sort=waiting&dir=asc');
    assert.equal(here(), '/tasks?q=import');
  });

  it('sorts by a column from its header', async () => {
    const { client, lists } = fakeClient();
    show(client);
    await table();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Task' }));
    assert.equal(here(), '/tasks?sort=title&dir=asc');
    await waitFor(() => assert.equal(lists.length, 2));
    assert.equal(lists[1]?.[1], 'page=1&pageSize=25&sort=title&dir=asc');
  });

  it('filters by queue with each open count', async () => {
    const { client } = fakeClient();
    show(client);
    await table();
    await waitFor(() =>
      assert.ok(screen.getByRole('option', { name: 'Billing Review (3)', hidden: true }))
    );
    await choose('Queue', 'Stuck Runs (1)');
    assert.equal(here(), '/tasks?queue=exceptions');
  });

  it('filters by assignee', async () => {
    window.history.replaceState(null, '', '/tasks?queue=exceptions');
    const { client } = fakeClient();
    show(client, { queue: 'exceptions', assignee: 'all' });
    await table();
    await choose('Assignee', 'Assigned to Me');
    assert.equal(here(), '/tasks?queue=exceptions&assignee=mine');
  });

  it('lists the tasks of the chosen queue and assignee', async () => {
    const filter: TaskFilter = { queue: 'billing-review', assignee: 'mine' };
    const { client, lists } = fakeClient();
    show(client, filter);
    await table();
    assert.deepEqual(lists, [[filter, 'page=1&pageSize=25&sort=waiting&dir=asc']]);
  });

  it('keeps a filtered queue selectable before the queues load', () => {
    const client = {
      list: () => new Promise(() => undefined),
      queues: () => new Promise(() => undefined)
    } as unknown as TasksClient;
    show(client, { queue: 'billing-review', assignee: 'mine' });
    assert.deepEqual(
      within(screen.getByRole('listbox', { name: 'Queue', hidden: true }))
        .getAllByRole('option', { hidden: true })
        .map((o) => o.textContent),
      ['All Queues', 'Billing Review (0)']
    );
  });

  it('says everything is caught up when there are no tasks', async () => {
    const { client } = fakeClient([]);
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'All Caught Up' }));
    assert.ok(screen.getByText('New tasks show up here as claims need work.'));
  });

  it('reloads the tasks and queues when a listed task changes', async () => {
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    const { client, lists, queueLoads } = fakeClient();
    show(client, ALL, live);
    await table();
    for (const listener of listeners) listener({ kind: 'task', id: 't1', runId: null });
    await waitFor(() => assert.equal(lists.length, 2), { timeout: 3_000 });
    assert.equal(queueLoads(), 2);
  });
});
