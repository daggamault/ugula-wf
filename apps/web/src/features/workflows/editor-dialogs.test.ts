import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, useState } from 'react';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import type { GraphDetail } from './client.ts';
import { type EditorDialog, EditorDialogs } from './editor-dialogs.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const graph = (overrides: string | null): GraphDetail['graph'] => ({
  id: 'g1',
  scope: 'agency',
  key: 'acme.rule',
  name: 'Rule',
  kind: 'node',
  role: 'rule',
  description: '',
  overridden_by: null,
  overrides,
  is_stale: false,
  canEdit: true,
  canOverride: false,
  effectiveId: 'g1',
  effectiveScope: 'agency'
});

const show = (opened: EditorDialog, overrides: string | null = null, removable = true) => {
  const calls: string[] = [];
  const Host = () => {
    const [dialog, setDialog] = useState<EditorDialog | null>(opened);
    return createElement(EditorDialogs, {
      graph: graph(overrides),
      dialog,
      removable,
      onClose: () => {
        calls.push('close');
        setDialog(null);
      },
      onRemove: () => void calls.push('remove'),
      onReset: () => void calls.push('reset')
    });
  };
  render(createElement(Host));
  return { calls, user: userEvent.setup() };
};

const openDialog = () => screen.getByRole('dialog');

describe('EditorDialogs', () => {
  it('deletes a custom graph once confirmed', async () => {
    const { calls, user } = show('remove');
    assert.equal(openDialog().getAttribute('open'), '');
    assert.match(
      openDialog().textContent ?? '',
      /Delete Subworkflow\?.*Rule and its versions are deleted/
    );
    await user.click(screen.getByRole('button', { name: 'Delete Subworkflow' }));
    assert.deepEqual(calls, ['close', 'remove']);
    assert.ok(!screen.queryByRole('dialog'));
  });

  it('keeps the graph when the removal is dismissed', async () => {
    const { calls, user } = show('remove', 'g0');
    assert.match(openDialog().textContent ?? '', /Remove Override\?.*this copy overrides/);
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    assert.deepEqual(calls, ['close']);
  });

  it('starts the draft again from the base once confirmed, or keeps it', async () => {
    const reset = show('reset');
    assert.match(
      openDialog().textContent ?? '',
      /Your draft of Rule is replaced with the newest base/
    );
    await reset.user.click(screen.getByRole('button', { name: 'Start From Base' }));
    assert.deepEqual(reset.calls, ['close', 'reset']);
  });

  it('keeps the draft when starting again is dismissed', async () => {
    const { calls, user } = show('reset');
    await user.click(screen.getByRole('button', { name: 'Keep My Draft' }));
    assert.deepEqual(calls, ['close']);
  });

  it('never asks to remove what cannot be removed', () => {
    show('remove', 'g0', false);
    assert.ok(!screen.queryByRole('dialog'));
  });
});
