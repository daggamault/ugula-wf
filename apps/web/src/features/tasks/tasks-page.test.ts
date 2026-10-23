import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { tableStateOf } from '../../shared/url-state.ts';
import type { TaskSummary, TasksClient } from './client.ts';
import {
  QUEUE_TABLE,
  QueuesTable,
  queueFilters,
  TASK_TABLE,
  TasksPage,
  TaskTable
} from './tasks-page.tsx';

const queues = [
  { queue: 'exceptions', open: 1, unassigned: 0, oldest: '2026-01-01T00:00:00Z' },
  { queue: 'billing-review', open: 3, unassigned: 2, oldest: '2026-01-01T00:00:00Z' }
];

const task = (over: Partial<TaskSummary> = {}): TaskSummary => ({
  id: 't1',
  run_id: 'r1',
  kind: 'task',
  queue: 'billing-review',
  title: 'Review PCR',
  subject: 'PCR-1 · Jane Doe',
  priority: 0,
  status: 'open',
  assignee_id: null,
  created_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  ...over
});

const params = (search: string) => new URLSearchParams(search);

describe('QueuesTable', () => {
  it('describes each queue and only starts queues with unclaimed work', () => {
    const html = renderToStaticMarkup(
      createElement(QueuesTable, {
        queues,
        sorting: tableStateOf('/tasks', params('queuesSort=open'), QUEUE_TABLE),
        onStart: () => undefined
      })
    );
    assert.ok(html.includes('Confirm the level of service'));
    assert.ok(html.includes('href="/tasks?queue=billing-review"'));
    assert.equal(html.match(/aria-disabled="true"/g)?.length, 1);
    assert.ok(html.includes('Everything here is claimed by someone.'));
    assert.ok(html.includes('aria-sort="descending"'));
    assert.ok(html.includes('href="/tasks?queuesSort=open&amp;queuesDir=asc"'));
  });
});

describe('TaskTable', () => {
  it('leads with what the task is about, shows its state and sorts by column', () => {
    const html = renderToStaticMarkup(
      createElement(TaskTable, {
        label: 'Open tasks',
        sorting: tableStateOf('/tasks', params('queue=billing-review'), TASK_TABLE),
        tasks: [
          task(),
          task({
            id: 't2',
            kind: 'fault',
            queue: 'exceptions',
            title: 'Stuck at Price',
            subject: null
          }),
          task({ id: 't3', assignee_id: 'u1' })
        ]
      })
    );
    assert.match(html, /href="\/tasks\/t1"[^>]*>PCR-1 · Jane Doe</);
    assert.match(html, /href="\/tasks\/t2"[^>]*>Stuck at Price</);
    assert.ok(html.includes('Stuck run') && html.includes('Claimed') && html.includes('Unclaimed'));
    assert.ok(html.includes('href="/tasks?queue=billing-review&amp;sort=task&amp;dir=asc"'));
  });
});

describe('queueFilters', () => {
  it('filters the task list by queue through the URL', () => {
    const href = (name: string, value: string | null) =>
      value ? `/tasks?${name}=${value}` : '/tasks';
    assert.deepEqual(queueFilters(queues, 'billing-review', href), [
      { label: 'All', href: '/tasks', isSelected: false },
      { label: 'PCR review (3)', href: '/tasks?queue=billing-review', isSelected: true },
      { label: 'Stuck runs (1)', href: '/tasks?queue=exceptions', isSelected: false }
    ]);
  });
});

describe('TasksPage', () => {
  it('starts loading queues, claimed tasks and open tasks', () => {
    const pending = () => new Promise(() => undefined);
    const html = renderToStaticMarkup(
      createElement(TasksPage, {
        client: { queues: pending, mine: pending, open: pending } as unknown as TasksClient,
        live: idleLive,
        queue: null
      })
    );
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('Everything waiting on a person'));
  });
});
