import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive, testNodes } from '../../shared/testing.ts';
import type { RunDetail, RunsClient } from './client.ts';
import { RunPage, RunView } from './run-page.tsx';

const detail = (status: RunDetail['run']['status']): RunDetail => ({
  run: {
    id: 'r1',
    status,
    parent_id: 'p1',
    parent_index: 0,
    parent_wait: null,
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
  ],
  ancestors: [
    { id: 'p0', name: 'Ingest NEMSIS File', status: 'completed' },
    { id: 'p1', name: 'Process PCR', status: 'suspended' }
  ]
});

const graphs = [
  {
    key: 'demo.item',
    version: 2,
    definition: {
      signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
      variables: [],
      nodes: [
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        { id: 'payers', type: 'demo.sub', version: 1, label: 'Resolve payers' }
      ],
      edges: []
    }
  },
  {
    key: 'demo.sub',
    version: 1,
    definition: {
      signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
      variables: [],
      nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
      edges: []
    }
  }
];

const render = (status: RunDetail['run']['status'], stack: string[] = []) =>
  renderToStaticMarkup(
    createElement(RunView, {
      detail: detail(status),
      nodes: testNodes,
      graphs,
      steps: [],
      stack,
      onCancel: async () => undefined
    })
  );

describe('RunView', () => {
  it('shows status, open tasks, inputs, links and cancel for unfinished runs', () => {
    const html = render('faulted');
    assert.ok(html.includes('Stuck'));
    assert.ok(html.includes('payer rejected'));
    assert.ok(html.includes('href="/tasks/t1"'));
    assert.ok(html.includes('href="/runs/p0"') && html.includes('href="/runs/p1"'));
    assert.ok(html.includes('aria-label="Back to Process PCR"'));
    assert.ok(html.includes('href="/workflows/g1?version=2"'));
    assert.ok(html.includes('Cancel Run'));
    assert.ok(html.includes('aria-label="Run path"'));
    assert.ok(html.includes('Ingest NEMSIS File') && html.includes('Item</span>'));
    assert.ok(html.includes('&quot;id&quot;: &quot;a&quot;'));
  });

  it('keeps the opened sub-graph in the path, labelled, with a way back to its parent', () => {
    const html = render('running', ['payers']);
    assert.ok(html.includes('href="/runs/r1"'));
    assert.ok(html.includes('Resolve payers</span>'));
    assert.ok(html.includes('aria-label="Back to Item"'));
  });

  it('opens child runs from an icon action', () => {
    const base = detail('running');
    const { inputs, result, error, state, ...summary } = base.run;
    const html = renderToStaticMarkup(
      createElement(RunView, {
        detail: { ...base, children: [{ ...summary, id: 'c1', parent_index: 1 }], childCount: 1 },
        nodes: testNodes,
        graphs,
        steps: [],
        stack: [],
        onCancel: async () => undefined
      })
    );
    assert.ok(html.includes('href="/runs/c1" aria-label="Open run #2 Item"'));
    assert.equal(html.split('href="/runs/c1"').length, 2);
  });

  it('hides cancel once a run is finished', () => {
    assert.ok(!render('completed').includes('Cancel Run'));
  });

  it('flags stuck-point tasks, counts trimmed child runs and goes back to the list for top runs', () => {
    const base = detail('suspended');
    const { inputs, result, error, state, ...summary } = base.run;
    const html = renderToStaticMarkup(
      createElement(RunView, {
        detail: {
          ...base,
          tasks: [{ ...(base.tasks[0] as RunDetail['tasks'][number]), kind: 'fault' }],
          ancestors: [],
          children: [{ ...summary, id: 'c1' }],
          childCount: 40
        },
        nodes: testNodes,
        graphs,
        steps: [],
        stack: [],
        onCancel: async () => undefined
      })
    );
    assert.ok(html.includes('Needs attention: '));
    assert.ok(html.includes('The first 1 of 40 runs this run started.'));
    assert.ok(html.includes('aria-label="Back to Runs"') && html.includes('href="/runs"'));
    assert.ok(render('running').includes('Waiting on '));
  });
});

describe('RunPage', () => {
  it('waits for run data before rendering', () => {
    const html = renderToStaticMarkup(
      createElement(RunPage, {
        client: {} as RunsClient,
        nodes: testNodes,
        live: idleLive,
        runId: 'r1',
        at: []
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
