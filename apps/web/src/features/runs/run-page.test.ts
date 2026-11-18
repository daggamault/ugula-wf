import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE } from '@ugula/graph';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowEventsContext } from '../../shared/graph/pins.ts';
import { idleLive, testNodes } from '../../shared/testing.ts';
import {
  act,
  render as mount,
  screen,
  userEvent,
  waitFor,
  within
} from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { RunDetail, RunStep, RunsClient } from './client.ts';
import { RunPage, RunView } from './run-page.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

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
    state: null,
    event: null
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
    assert.ok(html.includes('aria-label="Run Path"'));
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

  it('says which event started the run', () => {
    const base = detail('running');
    const html = renderToStaticMarkup(
      createElement(
        WorkflowEventsContext.Provider,
        {
          value: [
            {
              type: 'payer_file.received',
              label: 'Payer File Received',
              description: '',
              payload: []
            }
          ]
        },
        createElement(RunView, {
          detail: {
            ...base,
            run: {
              ...base.run,
              event: { id: 'e1', type: 'payer_file.received', createdAt: base.run.created_at }
            }
          },
          nodes: testNodes,
          graphs,
          steps: [],
          stack: [],
          onCancel: async () => undefined
        })
      )
    );
    assert.match(html, /Started [^.]+ by Payer File Received./);
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

describe('RunView interactions', () => {
  const view = (onCancel: () => Promise<void>, steps: RunStep[] = []) =>
    mount(
      createElement(RunView, {
        detail: detail('running'),
        nodes: testNodes,
        graphs,
        steps,
        stack: [],
        onCancel
      })
    );
  const nodeEl = (id: string) => document.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const step = (seq: number, path: string): RunStep => ({
    seq,
    path,
    node: 'entry',
    node_type: 'x',
    event: 'exec',
    inputs: {},
    outputs: { id: 'a' },
    pin: null,
    error: null,
    started_at: '2026-01-01T00:00:00Z',
    duration_ms: 2
  });

  it('cancels the run only after the user confirms', async () => {
    let cancels = 0;
    view(async () => {
      cancels += 1;
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel Run' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel Run?' }) as HTMLDialogElement;
    await user.click(within(dialog).getByRole('button', { name: 'Keep Running' }));
    assert.equal(cancels, 0);
    assert.equal(dialog.open, false);
    await user.click(screen.getAllByRole('button', { name: 'Cancel Run' })[0] as HTMLElement);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Run' }));
    assert.equal(cancels, 1);
    assert.equal(dialog.open, false);
  });

  it('shows why a cancel failed', async () => {
    view(async () => {
      throw new Error('Run already finished');
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel Run' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Cancel Run?' })).getByRole('button', {
        name: 'Cancel Run'
      })
    );
    assert.equal((await screen.findByRole('alert')).textContent, 'Run already finished');
  });

  it('shows what a selected node did on the open path', async () => {
    view(async () => undefined, [step(1, ''), step(2, 'payers/')]);
    assert.ok(screen.getByRole('heading', { name: 'Run Data' }));
    await act(() => nodeEl('entry').click());
    assert.ok(screen.getByRole('heading', { name: 'Start' }));
    assert.ok(screen.getByText('It ran 1 time on this path, newest first.'));
    assert.ok(!screen.queryByRole('heading', { name: 'Run Data' }));
  });

  it('opens a subworkflow node in place on double-click', async () => {
    view(async () => undefined);
    await act(() => {
      nodeEl('payers').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    assert.equal(`${window.location.pathname}${window.location.search}`, '/runs/r1?at=payers');
  });
});

describe('RunPage', () => {
  it('cancels through the client, tells the user and reloads the run', async () => {
    let finds = 0;
    const cancelled: string[] = [];
    const toasts: ToastInput[] = [];
    const client = {
      find: async () => {
        finds += 1;
        return detail(finds === 1 ? 'running' : 'cancelled');
      },
      steps: async () => [],
      graphs: async () => graphs,
      cancel: async (id: string) => {
        cancelled.push(id);
        return { status: 'cancelled' };
      }
    } as unknown as RunsClient;
    mount(
      createElement(
        ToastProvider,
        { onNotify: (t) => toasts.push(t) },
        createElement(RunPage, { client, nodes: testNodes, live: idleLive, runId: 'r1', at: [] })
      )
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel Run' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Cancel Run?' })).getByRole('button', {
        name: 'Cancel Run'
      })
    );
    assert.deepEqual(cancelled, ['r1']);
    assert.deepEqual(
      toasts.map((t) => t.title),
      ['Run cancelled']
    );
    await waitFor(() => assert.ok(!screen.queryByRole('button', { name: 'Cancel Run' })));
    assert.equal(finds, 2);
  });

  it('reports a run that fails to load', async () => {
    mount(
      createElement(RunPage, {
        client: {
          find: async () => {
            throw new Error('Run not found');
          },
          steps: async () => [],
          graphs: async () => graphs
        } as unknown as RunsClient,
        nodes: testNodes,
        live: idleLive,
        runId: 'r1',
        at: []
      })
    );
    assert.ok(await screen.findByText('Run not found'));
  });

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
