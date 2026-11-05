import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphDetail } from './client.ts';
import { EditorDialogs } from './editor-dialogs.tsx';

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
  canOverride: { organization: false, agency: false },
  effectiveId: 'g1',
  effectiveScope: 'agency'
});

const noop = () => undefined;

const render = (overrides: string | null, removable = true) =>
  renderToStaticMarkup(
    createElement(EditorDialogs, {
      graph: graph(overrides),
      dialog: null,
      removable,
      leaving: null,
      onClose: noop,
      onRemove: noop,
      onReset: noop,
      onStay: noop,
      onLeave: noop
    })
  );

describe('EditorDialogs', () => {
  it('asks before removing an override, deleting a custom graph, resetting or leaving', () => {
    const override = render('g0');
    assert.ok(override.includes('Remove Override?') && override.includes('this copy overrides'));
    const custom = render(null);
    assert.ok(
      custom.includes('and its versions are deleted') && !custom.includes('Remove Override')
    );
    assert.ok(custom.includes('Start From Base?') && custom.includes('Discard Unsaved Changes?'));
    assert.ok(!render('g0', false).includes('Remove Override?'));
  });
});
