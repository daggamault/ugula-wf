import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { tableStateOf } from '../../shared/url-state.ts';
import type { TaskSummary, TasksClient } from './client.ts';
import {
  assigneeFilters,
  assigneeOf,
  TASK_TABLE,
  TasksPage,
  TaskTable,
  typeFilters
} from './tasks-page.tsx';

const queues = [
  { queue: 'exceptions', open: 1, unassigned: 0, mine: 1, oldest: '2026-01-01T00:00:00Z' },
  { queue: 'billing-review', open: 3, unassigned: 2, mine: 0, oldest: '2026-01-01T00:00:00Z' }
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

const href = (name: string, value: string | null) => (value ? `/tasks?${name}=${value}` : '/tasks');

describe('TaskTable', () => {
  it('leads with what the task is about, its type, and who has it', () => {
    const html = renderToStaticMarkup(
      createElement(TaskTable, {
        me: 'me@example.com',
        sorting: tableStateOf('/tasks', params('type=billing-review'), TASK_TABLE),
        tasks: [
          task(),
          task({
            id: 't2',
            kind: 'fault',
            queue: 'exceptions',
            title: 'Stuck at Price',
            subject: null
          }),
          task({ id: 't3', assignee_id: 'u1', assignee_email: 'pat@example.com' }),
          task({ id: 't4', assignee_id: 'u2', assignee_email: 'me@example.com' })
        ]
      })
    );
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('<span class="font-medium">PCR-1 · Jane Doe</span>'));
    assert.ok(html.includes('href="/tasks/t1" aria-label="Open task PCR-1 · Jane Doe"'));
    assert.ok(html.includes('href="/tasks/t2" aria-label="Open task Stuck at Price"'));
    assert.equal(html.split('href="/tasks/t1"').length, 2);
    assert.ok(html.includes('Billing Review') && html.includes('Stuck Runs'));
    assert.ok(
      html.includes('pat@example.com') && html.includes('Unassigned') && html.includes('>You<')
    );
    assert.ok(html.includes('href="/tasks?type=billing-review&amp;sort=task&amp;dir=asc"'));
  });

  it('names whoever a task is assigned to', () => {
    assert.equal(assigneeOf({ assignee_id: null }, 'me'), null);
    assert.equal(assigneeOf({ assignee_id: 'u1', assignee_email: null }, 'me'), 'Someone');
  });
});

describe('task filters', () => {
  it('filter by type with counts, in the usual order', () => {
    assert.deepEqual(typeFilters(queues, href), [
      { value: '', label: 'All (4)', href: '/tasks' },
      {
        value: 'billing-review',
        label: 'Billing Review (3)',
        href: '/tasks?type=billing-review'
      },
      { value: 'exceptions', label: 'Stuck Runs (1)', href: '/tasks?type=exceptions' }
    ]);
  });

  it('filter by assignee with counts for the selected types', () => {
    assert.deepEqual(assigneeFilters(queues, href), [
      { value: 'anyone', label: 'Anyone (4)', href: '/tasks' },
      { value: 'me', label: 'Me (1)', href: '/tasks?assignee=me' },
      { value: 'unassigned', label: 'Unassigned (2)', href: '/tasks?assignee=unassigned' }
    ]);
  });
});

describe('TasksPage', () => {
  it('starts loading the task types and the list', () => {
    const pending = () => new Promise(() => undefined);
    const html = renderToStaticMarkup(
      createElement(TasksPage, {
        client: { queues: pending, list: pending } as unknown as TasksClient,
        live: idleLive,
        me: 'me@example.com',
        filter: { queue: null, assignee: 'anyone' }
      })
    );
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('Start Working'));
  });
});
