import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { TaskDetail, TasksClient } from './client.ts';
import { NextUp, queuePath, TaskPage, TaskView } from './task-page.tsx';

const task = (patch: Partial<TaskDetail> = {}): TaskDetail => ({
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
  instructions: 'Check the charges.',
  context: { suggested: { level: 'ALS1' } },
  fields: [{ name: 'note', type: 'string', label: 'Note' }],
  outcomes: ['approve', 'keepWaiting'],
  defaults: { note: 'looks fine' },
  resolution: null,
  source: { reportId: null, pcrNumber: null, claimId: null },
  ...patch
});

const render = (t: TaskDetail, source: string | null = null) =>
  renderToStaticMarkup(
    createElement(TaskView, {
      task: t,
      remaining: 2,
      source,
      onComplete: async () => undefined,
      onAssign: async () => undefined,
      onNext: async () => undefined
    })
  );

describe('TaskView', () => {
  it('leads with the subject and queue, explains what to do and prefills the decision', () => {
    const html = render(task(), 'SOURCE PANEL');
    assert.ok(html.includes('PCR-1 · Jane Doe</h1>'));
    assert.ok(html.includes('Billing Review') && html.includes('Review PCR'));
    assert.ok(html.includes('What to Do') && html.includes('Check the charges.'));
    assert.ok(html.includes('ALS1'));
    assert.ok(html.includes('value="looks fine"'));
    assert.ok(html.includes('>Approve<') && html.includes('>Keep Waiting<'));
    assert.ok(html.includes('Assign to Me'));
    assert.ok(!html.includes('href="/runs/r1"'));
    assert.ok(html.includes('href="/tasks?type=billing-review"'));
    assert.ok(html.includes('SOURCE PANEL'));
    assert.ok(!html.includes('Open Claim'));
  });

  it('links the claim a task is about', () => {
    const html = render(task({ source: { reportId: null, pcrNumber: 'PCR-1', claimId: 'c1' } }));
    assert.ok(html.includes('href="/claims/c1"'));
    const fromContext = render(task({ context: { claimId: 'c2' } }));
    assert.ok(fromContext.includes('href="/claims/c2"'));
  });

  it('explains stuck-run resolutions and shows completed decisions', () => {
    const fault = render(
      task({
        kind: 'fault',
        queue: 'exceptions',
        subject: null,
        title: 'Stuck at Price',
        fields: [
          {
            name: 'pin',
            type: 'string',
            label: 'Continue from',
            options: [{ value: 'then', label: 'Then' }]
          },
          { name: 'outputs', type: { object: {} } }
        ],
        outcomes: ['retry', 'skip', 'cancel'],
        defaults: null,
        assignee_id: 'u1'
      })
    );
    assert.ok(fault.includes('Stuck at Price</h1>'));
    assert.ok(fault.includes('What Went Wrong'));
    assert.ok(fault.includes('Retry the failed step'));
    assert.ok(fault.includes('Unassign'));
    assert.ok(fault.includes('href="/runs/r1"') && fault.includes('Open Run'));
    assert.ok(fault.includes('<option value="then">Then</option>'));
    const done = render(
      task({
        status: 'completed',
        completed_at: '2026-01-02T00:00:00Z',
        resolution: { outcome: 'keepWaiting', values: { note: 'ok' } }
      })
    );
    assert.ok(done.includes('as “Keep Waiting”'));
    assert.ok(!done.includes('>Approve<'));
  });
});

describe('NextUp', () => {
  const next = (remaining: number | null) =>
    renderToStaticMarkup(
      createElement(NextUp, {
        outcome: 'approve',
        queue: 'billing-review',
        remaining,
        onNext: async () => undefined
      })
    );

  it('confirms the decision and offers the next task only when there is one', () => {
    const more = next(2);
    assert.ok(more.includes('“Approve”'));
    assert.ok(more.includes('2 more tasks are waiting in Billing Review.'));
    assert.ok(more.includes('Next Task'));
    assert.ok(more.includes('Back to Tasks'));
    const clear = next(0);
    assert.ok(clear.includes('Billing Review is clear.'));
    assert.ok(!clear.includes('Next Task'));
    assert.ok(next(1).includes('1 more task is waiting'));
    assert.ok(next(null).includes('Checking Billing Review'));
  });

  it('links back to the filtered queue', () => {
    assert.equal(queuePath('billing review'), '/tasks?type=billing%20review');
  });
});

describe('TaskPage', () => {
  it('loads the task before rendering it', () => {
    const html = renderToStaticMarkup(
      createElement(TaskPage, {
        client: {
          find: async () => task(),
          queues: async () => []
        } as unknown as TasksClient,
        live: idleLive,
        taskId: 't1'
      })
    );
    assert.ok(html.length > 0);
  });
});
