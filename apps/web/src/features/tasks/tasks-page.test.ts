import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { QueueSummary, TaskRow, TasksClient } from './client.ts';
import { assigneeOptions, queueOptions, TASKS_PATH, TasksPage, TasksTable } from './tasks-page.tsx';

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

const search = (query: string) =>
  searchStateOf(TASKS_PATH, new URLSearchParams(query), {
    sorts: { waiting: 'asc', title: 'asc' },
    sort: 'waiting'
  });

const href = (name: string, value: string | null) =>
  value === null ? `/tasks?drop=${name}` : `/tasks?${name}=${value}`;

const queue = (name: string, open: number): QueueSummary =>
  ({ queue: name, open, unassigned: 0, mine: 0, oldest: '2026-11-01T00:00:00Z' }) as QueueSummary;

describe('queueOptions', () => {
  it('offers every queue with its open count, keeping a picked queue that has emptied', () => {
    assert.deepEqual(queueOptions([queue('billing-review', 3)], null, href), [
      { value: '', label: 'All Queues', href: '/tasks?drop=queue' },
      { value: 'billing-review', label: 'Billing Review (3)', href: '/tasks?queue=billing-review' }
    ]);
    const kept = queueOptions([queue('billing-review', 3)], 'custom-intake', href);
    assert.deepEqual(kept.at(-1), {
      value: 'custom-intake',
      label: 'Custom Intake (0)',
      href: '/tasks?queue=custom-intake'
    });
    assert.equal(queueOptions([queue('billing-review', 3)], 'billing-review', href).length, 2);
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

describe('TasksTable', () => {
  it('lists each task with its queue, claim, patient and assignee, and links to work it', () => {
    const html = renderToStaticMarkup(
      createElement(TasksTable, {
        tasks: [
          row({ assignee_email: 'me@example.com' }),
          row({
            id: 't2',
            kind: 'fault',
            title: 'Fix import',
            subject: null,
            claim_id: null,
            claim_number: null,
            first_name: null,
            last_name: null,
            assignee_email: 'sam@example.com'
          })
        ],
        me: 'me@example.com'
      })
    );
    assert.ok(html.includes('Review PCR') && html.includes('PCR-1 · Jane Doe'));
    assert.ok(html.includes('Billing Review'));
    assert.ok(html.includes('>20261101-0012<') && html.includes('Doe, Jane'));
    assert.ok(!html.includes('#'));
    assert.ok(html.includes('>You<') && html.includes('sam@example.com'));
    assert.ok(html.includes('text-danger font-medium'));
    assert.ok(html.includes('href="/tasks/t1" aria-label="Work task Review PCR"'));
    assert.ok(html.includes('aria-label="Work task Fix import"'));
    assert.ok(
      html.includes('href="/claims/c1?back=%2Ftasks" aria-label="Open claim 20261101-0012"')
    );
    assert.equal(html.split('href="/claims/').length, 2);
    assert.ok(!html.includes('<mark'));
  });

  it('says when the claim has no patient yet and when the task is overdue', () => {
    const html = renderToStaticMarkup(
      createElement(TasksTable, {
        tasks: [row({ first_name: null, last_name: null, due_at: '2000-01-15T12:00:00Z' })]
      })
    );
    assert.ok(html.includes('Not matched yet'));
    assert.match(html, /<span class="text-danger font-medium">[^<]*2000[^<]*<\/span>/);
    assert.ok(html.includes('>Unassigned<'));
  });

  it('highlights the search in titles, patients and the claim number, and returns to the search', () => {
    const byText = renderToStaticMarkup(
      createElement(TasksTable, { tasks: [row()], search: search('q=doe') })
    );
    assert.match(byText, /<mark[^>]*>Doe<\/mark>, Jane/);
    assert.ok(byText.includes('href="/tasks/t1?back=%2Ftasks%3Fq%3Ddoe"'));
    const byNumber = renderToStaticMarkup(
      createElement(TasksTable, { tasks: [row()], search: search('q=%23202611010012') })
    );
    assert.match(byNumber, /<mark[^>]*>20261101-0012<\/mark>/);
  });
});

describe('TasksPage', () => {
  const pending = () => new Promise<never>(() => undefined);
  const render = (filter: Parameters<typeof TasksPage>[0]['filter']) =>
    renderToStaticMarkup(
      createElement(TasksPage, {
        client: { list: pending, queues: pending } as unknown as TasksClient,
        live: idleLive,
        me: 'me@example.com',
        filter
      })
    );

  it('searches open tasks and filters them by queue and assignee', () => {
    const html = render({ queue: null, assignee: 'all' });
    assert.ok(html.includes('>Tasks<'));
    assert.ok(html.includes('aria-label="Search Tasks"'));
    assert.ok(html.includes('id="tasks-queue"') && html.includes('id="tasks-assignee"'));
    assert.ok(html.includes('All Queues') && html.includes('Assigned to Me'));
    assert.ok(!html.includes('Work Next Task'));
  });

  it('keeps a filtered queue selectable before the queues load', () => {
    const html = render({ queue: 'billing-review', assignee: 'mine' });
    assert.ok(html.includes('Billing Review (0)'));
  });
});
