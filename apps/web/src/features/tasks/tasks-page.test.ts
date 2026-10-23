import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { TaskSummary, TasksClient } from './client.ts';
import { QueueCards, queueFilters, TasksPage, TaskTable } from './tasks-page.tsx';

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

describe('QueueCards', () => {
  it('explains each queue in billing order and only starts queues with unclaimed work', () => {
    const html = renderToStaticMarkup(
      createElement(QueueCards, { queues, onStart: () => undefined })
    );
    assert.ok(html.indexOf('PCR review') < html.indexOf('Stuck runs'));
    assert.ok(html.includes('Confirm the level of service'));
    assert.ok(html.includes('2 unclaimed'));
    assert.equal(html.match(/aria-disabled="true"/g)?.length, 1);
    assert.ok(html.includes('Everything here is claimed by someone.'));
  });
});

describe('TaskTable', () => {
  it('leads with what the task is about and shows its state', () => {
    const html = renderToStaticMarkup(
      createElement(TaskTable, {
        label: 'Open tasks',
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
  });
});

describe('queueFilters', () => {
  it('filters the task list by queue through the URL', () => {
    assert.deepEqual(queueFilters(queues, 'billing-review'), [
      { label: 'All', href: '/tasks', isSelected: false },
      { label: 'PCR review (3)', href: '/tasks?queue=billing-review', isSelected: true },
      { label: 'Stuck runs (1)', href: '/tasks?queue=exceptions', isSelected: false }
    ]);
  });
});

describe('TasksPage', () => {
  it('starts loading queues, claimed tasks and open tasks', () => {
    const html = renderToStaticMarkup(
      createElement(TasksPage, {
        client: {
          queues: async () => [],
          mine: async () => [],
          open: async () => []
        } as unknown as TasksClient,
        live: idleLive,
        queue: null
      })
    );
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('Everything waiting on a person'));
  });
});
