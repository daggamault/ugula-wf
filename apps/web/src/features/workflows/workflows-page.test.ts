import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type Facets, type Page, searchStateOf } from '../../shared/url-state.ts';
import type { GraphSummary, WorkflowsClient } from './client.ts';
import {
  GRAPH_TABLE,
  newKindOf,
  startsLabel,
  WorkflowsPage,
  WorkflowsTable
} from './workflows-page.tsx';

const graph = (patch: Partial<GraphSummary>): GraphSummary => ({
  id: 'g1',
  key: 'demo.batch',
  name: 'Batch',
  kind: 'workflow',
  role: 'workflow',
  description: '',
  scope: 'agency',
  isSystem: false,
  overrides: null,
  isStale: false,
  overriddenBy: null,
  publishedVersion: 2,
  draftVersion: null,
  trigger: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch
});

const graphs = [
  graph({ draftVersion: 3 }),
  graph({
    id: 'g2',
    key: 'billing.payer',
    name: 'Payer Rule',
    kind: 'node',
    role: 'rule',
    scope: 'system',
    isSystem: true,
    publishedVersion: null
  }),
  graph({
    id: 'g3',
    key: 'billing.match',
    name: 'Match',
    kind: 'node',
    scope: 'system',
    isSystem: true,
    overriddenBy: 'g4'
  }),
  graph({
    id: 'g4',
    key: 'billing.match',
    name: 'Match',
    kind: 'node',
    overrides: 'g3',
    isStale: true
  })
];

const search = (query = '') => searchStateOf('/workflows', new URLSearchParams(query), GRAPH_TABLE);

const showTable = (query = '') =>
  render(createElement(WorkflowsTable, { graphs, search: search(query) }));

const rowsOf = () =>
  within(screen.getByRole('table', { name: 'Workflows and subworkflows' }))
    .getAllByRole('row')
    .slice(1);

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .slice(0, 6)
    .map((c) => c.lastElementChild?.textContent);

const pageOf = (items: GraphSummary[], facets?: Facets): Page<GraphSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...(facets ? { facets } : {})
});

const fakeClient = (items: GraphSummary[] = graphs, facets?: Facets) => {
  const queries: string[] = [];
  const client = {
    search: async (query: string) => {
      queries.push(query);
      return pageOf(items, facets);
    }
  } as unknown as WorkflowsClient;
  return { client, queries };
};

const showPage = (client: WorkflowsClient, query = '') => {
  window.history.replaceState(null, '', `/workflows${query ? `?${query}` : ''}`);
  return render(createElement(WorkflowsPage, { client, live: idleLive }));
};

describe('newKindOf', () => {
  it('offers a subworkflow only when the list shows subworkflows alone', () => {
    assert.equal(newKindOf({}), 'workflow');
    assert.equal(newKindOf({ kind: [] }), 'workflow');
    assert.equal(newKindOf({ kind: ['node'] }), 'node');
    assert.equal(newKindOf({ kind: ['node', 'workflow'] }), 'workflow');
  });
});

describe('WorkflowsTable', () => {
  it('lists each graph with its kind, what starts it, scope and versions', () => {
    showTable();
    assert.deepEqual(rowsOf().map(cellsOf), [
      ['Batch', 'Workflow', 'When Someone Runs It', 'Custom', 'v2', 'v3'],
      ['Payer Rule', 'Subworkflow', '—', 'Standard', '—', '—'],
      ['Match', 'Subworkflow', '—', 'StandardHas Custom Copy', 'v2', '—'],
      ['Match', 'Subworkflow', '—', 'CustomBase Updated', 'v2', '—']
    ]);
  });

  it('names the event or schedule that starts a workflow', () => {
    const events = [{ type: 'claim.denied', label: 'Claim Denied', description: '', payload: [] }];
    assert.equal(
      startsLabel(graph({ trigger: { kind: 'event', event: 'claim.denied', where: {} } }), events),
      'On Claim Denied'
    );
    assert.equal(
      startsLabel(graph({ trigger: { kind: 'schedule', every: 'day', hour: 6 } }), events),
      'Every Day at 06:00'
    );
    assert.equal(startsLabel(graph({ kind: 'node' }), events), null);
  });

  it('highlights the search in names', () => {
    showTable('q=bat');
    assert.deepEqual(
      [...document.querySelectorAll('mark')].map((m) => m.textContent),
      ['Bat']
    );
  });

  it('runs only published workflows and edits every graph', () => {
    showTable();
    assert.deepEqual(
      screen.getAllByRole('link', { name: /^Run / }).map((a) => a.getAttribute('href')),
      ['/runs/new?graph=g1']
    );
    assert.deepEqual(
      screen.getAllByRole('link', { name: /^Edit / }).map((a) => a.getAttribute('href')),
      ['/workflows/g1', '/workflows/g2', '/workflows/g3', '/workflows/g4']
    );
    assert.ok(screen.getByRole('link', { name: 'Run Batch' }));
  });

  it('sorts by name and kind but not by scope or versions', () => {
    showTable('q=bat');
    const headers = within(screen.getAllByRole('row')[0] as HTMLElement).getAllByRole(
      'columnheader'
    );
    assert.deepEqual(
      headers.map((h) => [
        h.textContent,
        h.getAttribute('aria-sort'),
        h.querySelector('a')?.getAttribute('href') ?? null
      ]),
      [
        ['Name', 'ascending', '/workflows?q=bat&sort=name&dir=desc'],
        ['Kind', null, '/workflows?q=bat&sort=kind&dir=desc'],
        ['Starts', null, null],
        ['Scope', null, null],
        ['Published', null, null],
        ['Draft', null, null],
        ['Actions', null, null]
      ]
    );
  });
});

describe('WorkflowsPage', () => {
  it('lists every graph and asks for the chosen kinds and scopes', async () => {
    const { client, queries } = fakeClient();
    showPage(client, 'kind=node&scope=agency,system');
    await screen.findByRole('table', { name: 'Workflows and subworkflows' });
    assert.equal(rowsOf().length, 4);
    assert.deepEqual(queries, [
      'page=1&pageSize=25&sort=name&dir=asc&kind=node&scope=agency%2Csystem'
    ]);
  });

  it('filters by kind from the counts in the database', async () => {
    const { client } = fakeClient(graphs, {
      kind: [
        { value: 'workflow', count: 4 },
        { value: 'node', count: 9 }
      ],
      scope: [{ value: 'system', count: 13 }]
    });
    showPage(client);
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Kind/ }));
    const panel = screen.getByRole('dialog', { name: 'Filter by Kind' });
    assert.deepEqual(
      within(panel)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
      ['Subworkflow9', 'Workflow4']
    );
    assert.ok(within(panel).getByRole<HTMLInputElement>('checkbox', { name: /^Workflow/ }).checked);
    await user.click(within(panel).getByRole('checkbox', { name: /Subworkflow/ }));
    assert.equal(window.location.search, '?kind=workflow%2Cnode');
    await user.click(within(panel).getByRole('checkbox', { name: /^Workflow/ }));
    assert.equal(window.location.search, '?kind=node');
    await screen.findByRole('table');
    assert.ok(screen.getByRole('button', { name: 'New Subworkflow' }));
    assert.equal(screen.getByRole('button', { name: /^Kind/ }).textContent, 'Kind1 selected');
  });

  it('names scopes Standard and Custom', async () => {
    const { client } = fakeClient(graphs, {
      kind: [],
      scope: [
        { value: 'system', count: 3 },
        { value: 'agency', count: 1 }
      ]
    });
    showPage(client);
    await screen.findByRole('table');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Scope' }));
    assert.deepEqual(
      within(screen.getByRole('dialog', { name: 'Filter by Scope' }))
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
      ['Custom1', 'Standard3']
    );
  });

  it('creates a workflow from a name and opens it, without asking for a key', async () => {
    const { client } = fakeClient();
    const created: unknown[] = [];
    client.create = async (graph) => {
      created.push(graph);
      return { id: 'g9' };
    };
    showPage(client);
    await screen.findByRole('table');
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Workflows' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New Workflow' }));
    const form = screen.getByRole('form', { name: 'Create Workflow' });
    assert.ok(!within(form).queryByRole('textbox', { name: 'Key' }));
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Payer Rules');
    await user.type(within(form).getByRole('textbox', { name: 'Description' }), 'Reorders payers');
    await user.click(within(form).getByRole('button', { name: 'Create Workflow' }));
    await waitFor(() => assert.equal(window.location.pathname, '/workflows/g9'));
    assert.deepEqual(created, [
      { name: 'Payer Rules', description: 'Reorders payers', kind: 'workflow' }
    ]);
  });

  it('keeps the dialog open and says why when creating fails', async () => {
    const { client } = fakeClient();
    client.create = async () => {
      throw new Error('Name is taken');
    };
    showPage(client);
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New Workflow' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Rules');
    await user.click(screen.getByRole('button', { name: 'Create Workflow' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Name is taken');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    assert.ok(!screen.queryByRole('form', { name: 'Create Workflow' }));
  });

  it('offers the customization map', async () => {
    const { client } = fakeClient();
    showPage(client);
    await screen.findByRole('table');
    assert.equal(
      screen.getByRole('link', { name: 'Customization Map' }).getAttribute('href'),
      '/workflows/customized'
    );
    assert.equal(document.querySelector('search')?.getAttribute('aria-label'), 'Search Workflows');
  });

  it('offers a new subworkflow when showing subworkflows', async () => {
    const { client } = fakeClient();
    showPage(client, 'kind=node');
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New Subworkflow' }));
    assert.ok(screen.getByRole('form', { name: 'Create Subworkflow' }));
  });

  it('offers to clear filters that match nothing', async () => {
    const { client } = fakeClient([]);
    showPage(client, 'kind=node&scope=agency');
    await screen.findByRole('heading', { name: 'No Matching Workflows' });
    assert.equal(
      screen.getByRole('link', { name: 'Clear Filters' }).getAttribute('href'),
      '/workflows?kind='
    );
  });

  it('shows only workflows until the kind filter changes', async () => {
    const { client, queries } = fakeClient();
    showPage(client);
    await screen.findByRole('table');
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc&kind=workflow']);
  });

  it('says when there are no workflows at all', async () => {
    const { client } = fakeClient([]);
    showPage(client, 'kind=');
    assert.ok(await screen.findByRole('heading', { name: 'No Workflows Yet' }));
    assert.ok(!screen.queryByRole('table'));
  });

  it('shows why the graphs could not be loaded', async () => {
    const client = {
      search: async () => {
        throw new Error('Server down');
      }
    } as unknown as WorkflowsClient;
    showPage(client);
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Server down'));
  });
});
