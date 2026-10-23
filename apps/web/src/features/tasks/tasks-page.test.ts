import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TasksClient } from './client.ts';
import { MyTasksTable, QueuesTable, TasksPage } from './tasks-page.tsx';

describe('TasksPage', () => {
  it('lists queues with work-next actions disabled when nothing is unassigned', () => {
    const html = renderToStaticMarkup(
      createElement(QueuesTable, {
        queues: [
          { queue: 'review', open: 3, unassigned: 2, oldest: '2026-01-01T00:00:00Z' },
          { queue: 'exceptions', open: 1, unassigned: 0, oldest: '2026-01-01T00:00:00Z' }
        ],
        onWork: () => undefined
      })
    );
    assert.ok(html.includes('review'));
    assert.equal(html.match(/aria-disabled="true"/g)?.length, 1);
    assert.ok(html.includes('Every task here is assigned.'));
  });

  it('flags stuck-run tasks in my list', () => {
    const html = renderToStaticMarkup(
      createElement(MyTasksTable, {
        tasks: [
          {
            id: 't1',
            run_id: 'r1',
            kind: 'fault',
            queue: 'exceptions',
            title: 'Stuck at call',
            priority: 0,
            status: 'open',
            assignee_id: 'u1',
            created_at: '2026-01-01T00:00:00Z',
            completed_at: null
          }
        ]
      })
    );
    assert.ok(html.includes('href="/tasks/t1"'));
    assert.ok(html.includes('Stuck run'));
  });

  it('renders both sections', () => {
    const html = renderToStaticMarkup(
      createElement(TasksPage, {
        client: { queues: async () => [], mine: async () => [] } as unknown as TasksClient,
        live: { subscribe: () => () => undefined, close: () => undefined }
      })
    );
    assert.ok(html.includes('Queues'));
    assert.ok(html.includes('Assigned to Me'));
  });
});
