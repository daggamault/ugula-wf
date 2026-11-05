import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { TaskDetail, TasksClient } from './client.ts';
import {
  backOfTask,
  describeTask,
  fieldErrorsOf,
  NextUp,
  TaskPage,
  TaskView
} from './task-page.tsx';

const task = (patch: Partial<TaskDetail> = {}): TaskDetail => ({
  id: 't1',
  run_id: 'r1',
  kind: 'task',
  queue: 'billing-review',
  title: 'Review PCR',
  subject: 'PCR-1 · Jane Doe',
  priority: 0,
  due_at: null,
  permission: null,
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
  source: { reportId: null, pcrNumber: null, claim: null },
  ...patch
});

const render = (t: TaskDetail, source: string | null = null, back = '/claims') =>
  renderToStaticMarkup(
    createElement(TaskView, {
      task: t,
      back,
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
    assert.ok(html.includes('href="/claims"') && html.includes('Back to Claims'));
    assert.ok(html.includes('SOURCE PANEL'));
    assert.ok(!html.includes('Open Claim'));
  });

  it('shows when a task is due and blocks completing it without its permission', () => {
    const html = render(task({ due_at: '2026-02-01T00:00:00Z', permission: 'claims:approve' }));
    assert.ok(html.includes('due <time dateTime="2026-02-01T00:00:00Z"'));
    assert.ok(html.includes('needs the claims:approve permission'));
  });

  it('names and links the claim a task is about, and goes back where the biller came from', () => {
    const claim = { id: 'c1', number: 12, status: 'draft', patient: null } as const;
    const onClaim = task({ source: { reportId: null, pcrNumber: 'PCR-1', claim } });
    const html = render(onClaim);
    assert.ok(html.includes('Review PCR on claim #12 for a patient not matched yet, opened'));
    assert.ok(html.includes('href="/claims/c1"') && html.includes('Open Claim'));
    const fromClaim = render(onClaim, null, '/claims/c1');
    assert.ok(!fromClaim.includes('Open Claim') && fromClaim.includes('Back to Claim'));
    assert.equal(backOfTask(null, onClaim), '/claims/c1');
    assert.equal(backOfTask(null, task()), '/claims');
    assert.equal(backOfTask('/runs/r1', onClaim), '/runs/r1');
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
    assert.ok(!done.includes('>Approve<') && !done.includes('Assign to Me'));
    const cancelled = render(task({ status: 'cancelled' }));
    assert.ok(
      cancelled.includes('This task was cancelled.') && cancelled.includes('bg-warning/10')
    );
    assert.ok(!cancelled.includes('Assign to Me'));
  });

  it('marks required fields, blocks the outcomes that need them and themes destructive ones', () => {
    const html = render(
      task({
        title: 'Match payer',
        fields: [
          { name: 'payerId', type: 'string', label: 'Directory payer', required: ['link'] },
          { name: 'birthDate', type: 'string', label: 'Birth date', format: 'date' }
        ],
        outcomes: ['link', 'unlisted', 'void'],
        defaults: null
      })
    );
    assert.ok(html.includes('Directory Payer') && html.includes('required=""'));
    assert.ok(html.includes('type="date"'));
    assert.ok(html.includes('Fill in Directory Payer first.'));
    assert.ok(html.includes('>Link Payer<') && html.includes('>Mark Unlisted<'));
    assert.ok(html.includes('border-danger/40 text-danger'));
    assert.ok(html.includes('>Void<'));
  });
});

describe('fieldErrorsOf', () => {
  it('reads field errors from an invalid completion', () => {
    const err = Object.assign(new Error('Some fields are invalid'), {
      status: 422,
      body: { error: 'Some fields are invalid', fields: { payerId: 'is required', bad: 1 } }
    });
    assert.deepEqual(fieldErrorsOf(err), { payerId: 'is required' });
    assert.deepEqual(fieldErrorsOf(new Error('x')), {});
    const other = Object.assign(new Error('Conflict'), {
      status: 409,
      body: { fields: { payerId: 'is required' } }
    });
    assert.deepEqual(fieldErrorsOf(other), {});
    assert.deepEqual(fieldErrorsOf(Object.assign(new Error('x'), { status: 422, body: {} })), {});
  });
});

describe('NextUp', () => {
  const next = (remaining: number | null) =>
    renderToStaticMarkup(
      createElement(NextUp, {
        outcome: 'approve',
        queue: 'billing-review',
        remaining,
        back: '/claims?task=billing-review',
        onNext: async () => undefined
      })
    );

  it('confirms the decision and offers the next task only when there is one', () => {
    const more = next(2);
    assert.ok(more.includes('“Approve”'));
    assert.ok(more.includes('2 more tasks are waiting in Billing Review.'));
    assert.ok(more.includes('Next Task'));
    assert.ok(
      more.includes('href="/claims?task=billing-review"') && more.includes('Back to Claims')
    );
    const clear = next(0);
    assert.ok(clear.includes('Billing Review is clear.'));
    assert.ok(!clear.includes('Next Task'));
    assert.ok(next(1).includes('1 more task is waiting'));
    assert.ok(next(null).includes('Checking Billing Review'));
  });
});

describe('TaskPage', () => {
  it('shows a spinner while the task loads', () => {
    const html = renderToStaticMarkup(
      createElement(TaskPage, {
        client: {
          find: async () => task(),
          queues: async () => []
        } as unknown as TasksClient,
        live: idleLive,
        taskId: 't1',
        back: null
      })
    );
    assert.ok(html.includes('aria-label="Loading"') && !html.includes('<h1'));
  });
});

describe('describeTask', () => {
  it('says what a task is and which claim it is on in one sentence', () => {
    const claim = { id: 'c1', number: 12, status: 'draft', patient: 'Doe, Jane' } as const;
    assert.equal(describeTask(task()), 'Review PCR');
    assert.equal(
      describeTask(task({ subject: null, source: { reportId: null, pcrNumber: null, claim } })),
      'On claim #12 for Doe, Jane'
    );
    assert.equal(describeTask(task({ subject: null })), 'Waiting on a decision');
  });
});
