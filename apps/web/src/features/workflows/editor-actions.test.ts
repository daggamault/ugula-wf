import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphDetail } from './client.ts';
import { EditorActions } from './editor-actions.tsx';

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
    canOverride: { organization: false, agency: false },
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

const noop = () => undefined;

const render = (d: GraphDetail, props: Partial<Parameters<typeof EditorActions>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(EditorActions, {
      detail: d,
      version: 1,
      editable: !d.versions[0]?.published_at,
      removable: true,
      dirty: false,
      busy: null,
      settingsHref: '/?panel=settings',
      compareHref: null,
      removed: null,
      onAdd: noop,
      onArrange: noop,
      onVersion: noop,
      onOverride: noop,
      onRemove: noop,
      onSave: noop,
      onPublish: noop,
      ...props
    })
  );

describe('EditorActions', () => {
  it('edits, saves and publishes a draft, and deletes a custom graph', () => {
    const html = render(detail(false));
    for (const label of ['Add Node', 'Arrange Nodes', 'Workflow Settings', '>Save<', '>Publish<']) {
      assert.ok(html.includes(label), label);
    }
    assert.ok(html.includes('Delete Workflow') && !html.includes('Run<'));
  });

  it('offers a new draft, a run, compare and removed nodes on a published override', () => {
    const html = render(detail(true, 'g0'), {
      compareHref: '/?panel=compare',
      removed: { href: '/?removed=shown', shown: false }
    });
    assert.ok(html.includes('Edit as New Draft') && html.includes('href="/runs/new?graph=g1"'));
    assert.ok(html.includes('Remove Override') && !html.includes('Delete Workflow'));
    assert.ok(html.includes('href="/?panel=compare"') && html.includes('Show Removed'));
    assert.ok(!html.includes('Add Node'));
  });
});
