import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunDetail, RunsClient } from './client.ts';
import { RunPage, RunView } from './run-page.tsx';

const detail = (status: RunDetail['run']['status']): RunDetail => ({
  run: {
    id: 'r1',
    status,
    parent_id: 'p1',
    parent_index: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    graph_id: 'g1',
    key: 'demo.item',
    name: 'Item',
    version: 2,
    version_id: 'v2',
    error_message: null,
    inputs: { id: 'a' },
    result: null,
    error: status === 'faulted' ? { message: 'payer rejected', path: '', node: 'n' } : null,
    state: null
  },
  children: [],
  childCount: 0,
  tasks: [
    {
      id: 't1',
      kind: 'task',
      queue: 'review',
      title: 'Approve',
      status: 'open',
      created_at: '2026-01-01'
    }
  ]
});

const graphs = [
  {
    key: 'demo.item',
    version: 2,
    definition: {
      signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
      variables: [],
      nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
      edges: []
    }
  }
];

const render = (status: RunDetail['run']['status']) =>
  renderToStaticMarkup(
    createElement(RunView, {
      detail: detail(status),
      graphs,
      steps: [],
      onCancel: async () => undefined
    })
  );

describe('RunView', () => {
  it('shows status, open tasks, inputs, links and cancel for unfinished runs', () => {
    const html = render('faulted');
    assert.ok(html.includes('Stuck'));
    assert.ok(html.includes('payer rejected'));
    assert.ok(html.includes('href="/tasks/t1"'));
    assert.ok(html.includes('href="/runs/p1"'));
    assert.ok(html.includes('href="/workflows/g1?version=2"'));
    assert.ok(html.includes('Cancel run'));
    assert.ok(html.includes('aria-label="Graph path"'));
    assert.ok(html.includes('&quot;id&quot;: &quot;a&quot;'));
  });

  it('hides cancel once a run is finished', () => {
    assert.ok(!render('completed').includes('Cancel run'));
  });
});

describe('RunPage', () => {
  it('waits for run data before rendering', () => {
    const html = renderToStaticMarkup(
      createElement(RunPage, {
        client: {} as RunsClient,
        live: { subscribe: () => () => undefined, close: () => undefined },
        runId: 'r1'
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
