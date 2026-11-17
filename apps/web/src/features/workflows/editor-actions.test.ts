import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import type { GraphDetail } from './client.ts';
import { EditorActions } from './editor-actions.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const detail = (published: boolean, overrides: string | null = null): GraphDetail => ({
  graph: {
    id: 'g1',
    scope: 'agency',
    key: 'acme.flow',
    name: 'Flow',
    kind: 'workflow',
    role: 'workflow',
    description: '',
    overridden_by: null,
    overrides,
    is_stale: false,
    canEdit: true,
    canOverride: false,
    effectiveId: 'g1',
    effectiveScope: 'agency'
  },
  versions: [
    {
      id: 'v1',
      version: 1,
      published_at: published ? '2026-01-01' : null,
      created_at: '2026-01-01',
      base_version: null,
      base_graph_id: null
    }
  ]
});

const system = (effectiveScope: 'system' | 'agency'): GraphDetail => {
  const base = detail(true);
  return {
    ...base,
    graph: {
      ...base.graph,
      scope: 'system',
      canEdit: false,
      canOverride: true,
      effectiveScope,
      effectiveId: effectiveScope === 'system' ? 'g1' : 'g9'
    }
  };
};

const show = (d: GraphDetail, props: Partial<Parameters<typeof EditorActions>[0]> = {}) => {
  const calls: string[] = [];
  const on = (name: string) => () => void calls.push(name);
  render(
    createElement(EditorActions, {
      detail: d,
      version: 1,
      editable: !d.versions[0]?.published_at,
      removable: true,
      dirty: false,
      busy: null,
      signatureHref: '/?panel=signature',
      compareHref: null,
      removed: null,
      onAdd: on('add'),
      onArrange: on('arrange'),
      onVersion: (v) => void calls.push(`version ${v}`),
      onOverride: on('override'),
      onRemove: on('remove'),
      onSave: on('save'),
      onPublish: on('publish'),
      ...props
    })
  );
  return { calls, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });

const reason = (name: string) =>
  document.getElementById(button(name).getAttribute('aria-describedby') ?? '')?.textContent;

describe('EditorActions', () => {
  it('adds, arranges, saves changes and removes a custom draft', async () => {
    const { calls, user } = show(detail(false), { dirty: true });
    await user.click(button('Add Node'));
    await user.click(button('Arrange Nodes'));
    await user.click(button('Save'));
    await user.click(button('Delete Workflow'));
    assert.deepEqual(calls, ['add', 'arrange', 'save', 'remove']);
    assert.equal(
      screen.getByRole('link', { name: 'Inputs and Outputs' }).getAttribute('href'),
      '/?panel=signature'
    );
    assert.ok(!screen.queryByRole('link', { name: 'Run' }));
  });

  it('asks to save before publishing', async () => {
    const { calls, user } = show(detail(false), { dirty: true });
    await user.click(button('Publish'));
    assert.deepEqual(calls, []);
    assert.equal(reason('Publish'), 'Save your changes first.');
  });

  it('has nothing to save on a clean draft, which can be published', async () => {
    const { calls, user } = show(detail(false));
    await user.click(button('Save'));
    await user.click(button('Publish'));
    assert.deepEqual(calls, ['publish']);
    assert.equal(reason('Save'), 'No changes to save.');
  });

  it('blocks the other action while saving', async () => {
    const { calls, user } = show(detail(false), { dirty: true, busy: 'save' });
    assert.equal(button('Save').getAttribute('aria-busy'), 'true');
    await user.click(button('Save'));
    await user.click(button('Publish'));
    assert.deepEqual(calls, []);
    assert.equal(reason('Publish'), 'Wait for this to finish.');
  });

  it('blocks saving while publishing', async () => {
    const { calls, user } = show(detail(false), { busy: 'publish' });
    await user.click(button('Save'));
    await user.click(button('Publish'));
    assert.deepEqual(calls, []);
    assert.equal(reason('Save'), 'Wait for this to finish.');
  });

  it('switches to the chosen version', async () => {
    const d = detail(true);
    const { calls, user } = show(
      {
        ...d,
        versions: [
          {
            ...d.versions[0],
            id: 'v2',
            version: 2,
            published_at: null
          } as GraphDetail['versions'][number],
          ...d.versions
        ]
      },
      { version: 2 }
    );
    assert.equal(button('Version').textContent, 'v2 (Draft)');
    await user.click(screen.getByRole('option', { name: 'v1', hidden: true }));
    assert.deepEqual(calls, ['version 1']);
  });

  it('starts a new draft from a published override and links to compare, removed nodes and runs', async () => {
    const { calls, user } = show(detail(true, 'g0'), {
      signatureHref: null,
      compareHref: '/?panel=compare',
      removed: { href: '/?removed=shown', shown: false }
    });
    await user.click(button('Edit as New Draft'));
    await user.click(button('Remove Override'));
    assert.deepEqual(calls, ['save', 'remove']);
    assert.equal(
      screen.getByRole('link', { name: 'Compare' }).getAttribute('href'),
      '/?panel=compare'
    );
    assert.equal(
      screen.getByRole('link', { name: 'Show Removed' }).getAttribute('href'),
      '/?removed=shown'
    );
    assert.equal(
      screen.getByRole('link', { name: 'Run' }).getAttribute('href'),
      '/runs/new?graph=g1'
    );
    for (const name of ['Add Node', 'Save', 'Publish', 'Delete Workflow']) {
      assert.equal(screen.queryByRole('button', { name }), null, name);
    }
  });

  it('offers to hide removed nodes once shown', () => {
    show(detail(true, 'g0'), { removed: { href: '/', shown: true } });
    assert.ok(screen.getByRole('link', { name: 'Hide Removed' }));
  });

  it('customizes a built-in graph', async () => {
    const { calls, user } = show(system('system'), { signatureHref: null, removable: false });
    await user.click(button('Customize'));
    assert.deepEqual(calls, ['override']);
    assert.ok(!screen.queryByRole('button', { name: 'Edit as New Draft' }));
  });

  it('opens the agency copy of a built-in graph instead of customizing it again', () => {
    show(system('agency'), { signatureHref: null, removable: false });
    assert.ok(!screen.queryByRole('button', { name: 'Customize' }));
    assert.equal(
      screen.getByRole('link', { name: 'Open Agency Copy' }).getAttribute('href'),
      '/workflows/g9'
    );
  });

  it('shows the customize action as pending while copying', async () => {
    const { calls, user } = show(system('system'), { busy: 'override', removable: false });
    await user.click(button('Customize'));
    assert.deepEqual(calls, []);
  });
});
