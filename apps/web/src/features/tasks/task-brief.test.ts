import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Json } from '@ugula/graph';
import { createElement } from 'react';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { TaskIssue } from './task-brief.tsx';

type Task = Parameters<typeof TaskIssue>[0]['task'];

const TASK: Task = {
  kind: 'task',
  summary: null,
  instructions: '',
  context: null
};

const showIssue = (patch: Partial<Task>, children?: string) =>
  render(createElement(TaskIssue, { task: { ...TASK, ...patch } }, children));

const panel = (name: string) => screen.getByRole('region', { name });

const listItems = (el: HTMLElement) =>
  within(el)
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('TaskIssue', () => {
  it('heads a task with the issue and its summary', () => {
    showIssue({ summary: 'Review PCR' });
    assert.ok(within(panel('The Issue')).getByText('Review PCR'));
  });

  it('heads a fault with what went wrong', () => {
    showIssue({ kind: 'fault', summary: 'Timed out' });
    assert.ok(within(panel('What Went Wrong')).getByText('Timed out'));
  });

  it('lists the non-empty reasons', () => {
    showIssue({ context: { reasons: ['Responded emergent', '', 3, 'Lights on'] } });
    assert.deepEqual(listItems(panel('The Issue')), ['Responded emergent', 'Lights on']);
  });

  it('shows the warnings and notes the workflow left', () => {
    showIssue({ context: { warnings: ['Late filing', ''], notes: ['Called payer'] } });
    assert.deepEqual(
      screen
        .getAllByRole('status')
        .map((s) => [s.querySelector('strong')?.textContent, ...listItems(s)]),
      [
        ['Warnings', 'Late filing'],
        ['Notes', 'Called payer']
      ]
    );
  });

  it("says what's needed only when there are instructions", () => {
    showIssue({ instructions: 'Confirm the service.' });
    assert.ok(screen.getByRole('heading', { name: "What's Needed" }));
    assert.ok(screen.getByText('Confirm the service.'));
  });

  it('shows nothing extra for a task with no context or instructions', () => {
    showIssue({ context: 'odd' as Json });
    assert.ok(!screen.queryByRole('heading', { name: "What's Needed" }));
    assert.ok(!screen.queryByRole('list'));
    assert.ok(!screen.queryByRole('status'));
    assert.ok(!screen.queryByRole('alert'));
  });

  it('shows what is passed below the issue', () => {
    showIssue({}, 'Pick an outcome');
    assert.ok(within(panel('The Issue')).getByText('Pick an outcome'));
  });
});
