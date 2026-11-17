import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { GraphDetails } from './client.ts';
import { kindLabel, WorkflowDetailsDialog } from './workflow-details.tsx';

describe('kindLabel', () => {
  it('calls a node a subworkflow', () => {
    assert.equal(kindLabel('workflow'), 'Workflow');
    assert.equal(kindLabel('node'), 'Subworkflow');
  });
});

describe('WorkflowDetailsDialog', () => {
  const edit = (onSubmit: (details: GraphDetails) => Promise<void>) => {
    const closed: string[] = [];
    render(
      createElement(WorkflowDetailsDialog, {
        mode: 'edit',
        kind: 'node',
        initial: { name: 'Payer Rules', description: 'Reorders payers' },
        onClose: () => void closed.push('closed'),
        onSubmit
      })
    );
    return { closed, user: userEvent.setup() };
  };

  it('edits the name and description, with no kind or key to change', async () => {
    const saved: GraphDetails[] = [];
    const { user } = edit(async (details) => void saved.push(details));
    const form = screen.getByRole('form', { name: 'Subworkflow details' });
    assert.ok(!within(form).queryByRole('button', { name: 'Kind' }));
    assert.ok(!within(form).queryByRole('textbox', { name: 'Key' }));
    const name = within(form).getByRole('textbox', { name: 'Name' });
    assert.equal(name.hasAttribute('required'), true);
    await user.clear(name);
    await user.type(name, 'Payer Order');
    await user.click(within(form).getByRole('button', { name: 'Save Details' }));
    assert.deepEqual(saved, [{ name: 'Payer Order', description: 'Reorders payers' }]);
  });

  it('says why saving failed and closes on cancel', async () => {
    const { closed, user } = edit(async () => {
      throw new Error('Standard graphs are read-only');
    });
    await user.click(screen.getByRole('button', { name: 'Save Details' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Standard graphs are read-only');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    assert.deepEqual(closed, ['closed']);
  });

  it('chooses the kind when creating', async () => {
    const created: unknown[] = [];
    render(
      createElement(WorkflowDetailsDialog, {
        mode: 'create',
        kind: 'workflow',
        onClose: () => undefined,
        onSubmit: async (graph) => void created.push(graph)
      })
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Match');
    await user.click(screen.getByRole('button', { name: 'Kind' }));
    await user.click(screen.getByRole('option', { name: 'Subworkflow' }));
    await user.click(screen.getByRole('button', { name: 'Create Subworkflow' }));
    assert.deepEqual(created, [{ name: 'Match', description: '', kind: 'node' }]);
  });
});
