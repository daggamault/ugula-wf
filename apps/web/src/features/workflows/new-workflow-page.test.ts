import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { GraphKind, NewGraph, WorkflowsClient } from './client.ts';
import { graphKindOf, NewWorkflowForm, NewWorkflowPage } from './new-workflow-page.tsx';

const showForm = (
  kind: GraphKind,
  onCreate: (graph: NewGraph) => Promise<string | null> = async () => null
) => {
  const kinds: GraphKind[] = [];
  render(
    createElement(NewWorkflowForm, {
      kind,
      back: '/workflows?kind=blocks',
      onKindChange: (k) => kinds.push(k),
      onCreate
    })
  );
  return { kinds, user: userEvent.setup() };
};

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Match Patient');
  await user.type(screen.getByRole('textbox', { name: 'Key' }), 'billing.match-patient');
  await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Finds the patient');
};

const fakeClient = (create: WorkflowsClient['create']) => {
  const created: NewGraph[] = [];
  const client = {
    create: async (graph: NewGraph) => {
      created.push(graph);
      return create(graph);
    }
  } as unknown as WorkflowsClient;
  return { client, created };
};

describe('graphKindOf', () => {
  it('reads a subworkflow from the kind param and defaults to a workflow', () => {
    assert.equal(graphKindOf(new URLSearchParams('kind=node')), 'node');
    assert.equal(graphKindOf(new URLSearchParams('kind=x')), 'workflow');
    assert.equal(graphKindOf(new URLSearchParams()), 'workflow');
  });
});

describe('NewWorkflowForm', () => {
  it('names the form, section and submit button after the kind being created', () => {
    showForm('node');
    const form = screen.getByRole('form', { name: 'Create Subworkflow' });
    assert.ok(within(form).getByRole('heading', { name: 'Subworkflow' }));
    assert.equal(screen.getByRole('button', { name: 'Kind' }).textContent, 'Subworkflow');
    assert.equal(
      screen.getByRole('button', { name: 'Create Subworkflow' }).getAttribute('type'),
      'submit'
    );
  });

  it('requires a name and key, and explains what the key is for', () => {
    showForm('workflow');
    assert.equal(screen.getByRole('textbox', { name: 'Name' }).hasAttribute('required'), true);
    const key = screen.getByRole('textbox', { name: 'Key' });
    assert.equal(key.hasAttribute('required'), true);
    assert.equal(key.getAttribute('placeholder'), 'billing.match-patient');
    assert.equal(
      document.getElementById(key.getAttribute('aria-describedby') ?? '')?.textContent,
      'Dotted lowercase; used to reference this subworkflow from other workflows.'
    );
    assert.equal(
      screen.getByRole('textbox', { name: 'Description' }).hasAttribute('required'),
      false
    );
  });

  it('cancels back to where the user came from', () => {
    showForm('workflow');
    assert.equal(
      screen.getByRole('link', { name: 'Cancel' }).getAttribute('href'),
      '/workflows?kind=blocks'
    );
  });

  it('asks to switch the kind when another is chosen', async () => {
    const { kinds, user } = showForm('workflow');
    await user.click(screen.getByRole('button', { name: 'Kind' }));
    await user.click(screen.getByRole('option', { name: 'Subworkflow' }));
    assert.deepEqual(kinds, ['node']);
  });

  it('creates the graph from the entered fields and kind', async () => {
    const created: NewGraph[] = [];
    const { user } = showForm('node', async (graph) => {
      created.push(graph);
      return null;
    });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create Subworkflow' }));
    assert.deepEqual(created, [
      {
        key: 'billing.match-patient',
        name: 'Match Patient',
        description: 'Finds the patient',
        kind: 'node'
      }
    ]);
    assert.ok(!screen.queryByRole('alert'));
  });

  it('locks the fields while creating', async () => {
    let finish: (failure: string | null) => void = () => undefined;
    const { user } = showForm(
      'workflow',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create Workflow' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    assert.equal(name.closest('fieldset')?.disabled, true);
    assert.equal(
      screen.getByRole('button', { name: 'Create Workflow' }).getAttribute('aria-busy'),
      'true'
    );
    finish(null);
    await waitFor(() => assert.equal(name.closest('fieldset')?.disabled, false));
  });

  it('says why the graph could not be created and keeps what was entered', async () => {
    const { user } = showForm('workflow', async () => 'Key is taken');
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create Workflow' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Key is taken');
    assert.equal(
      (screen.getByRole('textbox', { name: 'Key' }) as HTMLInputElement).value,
      'billing.match-patient'
    );
  });
});

describe('NewWorkflowPage', () => {
  it('titles the page after the kind with a way back to the list', () => {
    render(
      createElement(NewWorkflowPage, {
        client: {} as WorkflowsClient,
        kind: 'node',
        back: '/workflows?kind=blocks'
      })
    );
    assert.ok(screen.getByRole('heading', { level: 1, name: 'New Subworkflow' }));
    assert.equal(
      screen.getByRole('link', { name: 'Back to Workflows' }).getAttribute('href'),
      '/workflows?kind=blocks'
    );
  });

  it('switches the kind in place by replacing the URL', async () => {
    window.history.replaceState(null, '', '/workflows/new?back=%2Fworkflows');
    const length = window.history.length;
    render(
      createElement(NewWorkflowPage, {
        client: {} as WorkflowsClient,
        kind: 'workflow',
        back: '/workflows'
      })
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Kind' }));
    await user.click(screen.getByRole('option', { name: 'Subworkflow' }));
    assert.equal(window.location.search, '?back=%2Fworkflows&kind=node');
    assert.equal(window.history.length, length);
  });

  it('opens the created graph', async () => {
    window.history.replaceState(null, '', '/workflows/new');
    const { client, created } = fakeClient(async () => ({ id: 'g7' }) as never);
    render(createElement(NewWorkflowPage, { client, kind: 'workflow', back: '/workflows' }));
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create Workflow' }));
    await waitFor(() => assert.equal(window.location.pathname, '/workflows/g7'));
    assert.deepEqual(created, [
      {
        key: 'billing.match-patient',
        name: 'Match Patient',
        description: 'Finds the patient',
        kind: 'workflow'
      }
    ]);
  });

  it('stays on the form and says why when creating fails', async () => {
    window.history.replaceState(null, '', '/workflows/new');
    const { client } = fakeClient(async () => {
      throw new Error('Key is taken');
    });
    render(createElement(NewWorkflowPage, { client, kind: 'workflow', back: '/workflows' }));
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create Workflow' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Key is taken');
    assert.equal(window.location.pathname, '/workflows/new');
  });
});
