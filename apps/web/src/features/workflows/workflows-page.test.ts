import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type Page, searchStateOf } from '../../shared/url-state.ts';
import type { GraphSummary, WorkflowsClient } from './client.ts';
import {
  GRAPH_TABLE,
  graphFilterOf,
  graphsQueryOf,
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
    .slice(0, 5)
    .map((c) => c.lastElementChild?.textContent);

const pageOf = (items: GraphSummary[]): Page<GraphSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (items: GraphSummary[] = graphs) => {
  const queries: string[] = [];
  const client = {
    search: async (query: string) => {
      queries.push(query);
      return pageOf(items);
    }
  } as unknown as WorkflowsClient;
  return { client, queries };
};

const showPage = (client: WorkflowsClient, show: Parameters<typeof WorkflowsPage>[0]['show']) =>
  render(createElement(WorkflowsPage, { client, live: idleLive, show }));

describe('graphFilterOf', () => {
  it('reads a known kind filter and defaults to workflows', () => {
    assert.equal(graphFilterOf(new URLSearchParams()), 'workflows');
    assert.equal(graphFilterOf(new URLSearchParams('kind=blocks')), 'blocks');
    assert.equal(graphFilterOf(new URLSearchParams('kind=mine')), 'mine');
    assert.equal(graphFilterOf(new URLSearchParams('kind=customized')), 'customized');
    assert.equal(graphFilterOf(new URLSearchParams('kind=all')), 'all');
    assert.equal(graphFilterOf(new URLSearchParams('kind=nope')), 'workflows');
  });
});

describe('graphsQueryOf', () => {
  it('asks the API for the chosen filter after the search query', () => {
    assert.equal(
      graphsQueryOf(search('q=bat').apiQuery, 'mine'),
      'q=bat&page=1&pageSize=25&sort=name&dir=asc&show=mine'
    );
  });
});

describe('WorkflowsTable', () => {
  it('lists each graph with its kind, scope and versions', () => {
    showTable();
    assert.deepEqual(rowsOf().map(cellsOf), [
      ['Batch', 'Workflow', 'Agency', 'v2', 'v3'],
      ['Payer Rule', 'Subworkflow', 'Built-in', '—', '—'],
      ['Match', 'Subworkflow', 'Built-inHas Your Copy', 'v2', '—'],
      ['Match', 'Subworkflow', 'AgencyBase Updated', 'v2', '—']
    ]);
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
        ['Scope', null, null],
        ['Published', null, null],
        ['Draft', null, null],
        ['Actions', null, null]
      ]
    );
  });
});

describe('WorkflowsPage', () => {
  it('searches graphs of the chosen filter and lists them', async () => {
    const { client, queries } = fakeClient();
    showPage(client, 'mine');
    await screen.findByRole('table', { name: 'Workflows and subworkflows' });
    assert.equal(rowsOf().length, 4);
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc&show=mine']);
  });

  it('creates a workflow from a name and opens it, without asking for a key', async () => {
    window.history.replaceState(null, '', '/workflows');
    const { client } = fakeClient();
    const created: unknown[] = [];
    client.create = async (graph) => {
      created.push(graph);
      return { id: 'g9' };
    };
    showPage(client, 'workflows');
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
    showPage(client, 'workflows');
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
    showPage(client, 'workflows');
    await screen.findByRole('table');
    assert.equal(
      screen.getByRole('link', { name: 'Customization Map' }).getAttribute('href'),
      '/workflows/customized'
    );
    assert.equal(document.querySelector('search')?.getAttribute('aria-label'), 'Search Workflows');
  });

  it('offers a new subworkflow when showing subworkflows', async () => {
    const { client } = fakeClient();
    showPage(client, 'blocks');
    await screen.findByRole('table');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New Subworkflow' }));
    assert.ok(screen.getByRole('form', { name: 'Create Subworkflow' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    assert.equal(
      document.querySelector('search')?.getAttribute('aria-label'),
      'Search Subworkflows'
    );
    assert.equal(screen.getByRole('button', { name: 'Show' }).textContent, 'Subworkflows');
  });

  it('switches the filter by navigating to its kind', async () => {
    window.history.replaceState(null, '', '/workflows?kind=blocks');
    const { client } = fakeClient();
    showPage(client, 'blocks');
    await screen.findByRole('table');
    const user = userEvent.setup();
    assert.deepEqual(
      within(screen.getByRole('listbox', { name: 'Show' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
      ['Workflows', 'Subworkflows', 'Your Copies', 'Customized', 'All']
    );
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByRole('option', { name: 'Customized' }));
    assert.equal(window.location.search, '?kind=customized');
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await user.click(screen.getByRole('option', { name: 'Workflows' }));
    assert.equal(window.location.search, '');
  });

  for (const [show, title, text] of [
    [
      'mine',
      'No Copies Yet',
      'Your agency has no workflows of its own yet. Create one, or override a built-in one.'
    ],
    [
      'customized',
      'Nothing Customized Yet',
      'Every workflow runs as built. Customize one for your agency to change it.'
    ],
    ['all', 'Nothing Here Yet', 'Nothing matches this filter.']
  ] as const) {
    it(`explains an empty ${show} list`, async () => {
      const { client } = fakeClient([]);
      showPage(client, show);
      const heading = await screen.findByRole('heading', { name: title });
      assert.equal(heading.nextElementSibling?.textContent, text);
      assert.ok(!screen.queryByRole('table'));
    });
  }

  it('shows why the graphs could not be loaded', async () => {
    const client = {
      search: async () => {
        throw new Error('Server down');
      }
    } as unknown as WorkflowsClient;
    showPage(client, 'workflows');
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Server down'));
  });
});
