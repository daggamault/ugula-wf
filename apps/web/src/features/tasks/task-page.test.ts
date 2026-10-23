import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskDetail, TasksClient } from './client.ts';
import { TaskPage, TaskView } from './task-page.tsx';

const task = (patch: Partial<TaskDetail> = {}): TaskDetail => ({
  id: 't1',
  run_id: 'r1',
  kind: 'task',
  queue: 'review',
  title: 'Approve large item',
  priority: 0,
  status: 'open',
  assignee_id: null,
  created_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  instructions: 'Check the charges.',
  context: { claim: 'C1' },
  fields: [{ name: 'note', type: 'string', label: 'Note' }],
  outcomes: ['approve', 'reject'],
  defaults: { note: 'looks fine' },
  resolution: null,
  ...patch
});

const render = (t: TaskDetail) =>
  renderToStaticMarkup(
    createElement(TaskView, {
      task: t,
      onComplete: async () => undefined,
      onAssign: async () => undefined
    })
  );

describe('TaskView', () => {
  it('renders context, prefilled fields and one button per outcome', () => {
    const html = render(task());
    assert.ok(html.includes('Check the charges.'));
    assert.ok(html.includes('&quot;claim&quot;'));
    assert.ok(html.includes('value="looks fine"'));
    assert.ok(html.includes('>Approve<'));
    assert.ok(html.includes('>Reject<'));
    assert.ok(html.includes('>Claim<'));
    assert.ok(html.includes('href="/runs/r1"'));
  });

  it('explains stuck-run resolutions and shows completed decisions', () => {
    const fault = render(
      task({
        kind: 'fault',
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
    assert.ok(fault.includes('Stuck run'));
    assert.ok(fault.includes('Retry the failed step'));
    assert.ok(fault.includes('>Release<'));
    assert.ok(fault.includes('<option value="then">Then</option>'));
    const done = render(
      task({
        status: 'completed',
        completed_at: '2026-01-02T00:00:00Z',
        resolution: { outcome: 'approve', values: { note: 'ok' } }
      })
    );
    assert.ok(done.includes('as “approve”'));
    assert.ok(!done.includes('>Approve<'));
  });
});

describe('TaskPage', () => {
  it('waits for the task before rendering', () => {
    assert.ok(
      renderToStaticMarkup(
        createElement(TaskPage, { client: {} as TasksClient, taskId: 't1' })
      ).includes('aria-label="Loading"')
    );
  });
});
