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
  kindLabel,
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
    role: 'slot',
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

describe('kindLabel', () => {
  it('calls a node a subworkflow', () => {
    assert.equal(kindLabel('workflow'), 'Workflow');
    assert.equal(kindLabel('node'), 'Subworkflow');
  });
});

describe('WorkflowsTable', () => {
  it('lists each graph with its kind, scope and versions', () => {
    showTable();
    assert.deepEqual(rowsOf().map(cellsOf), [
      ['Batch', 'demo.batch', 'Workflow', 'Agency', 'v2', 'v3'],
      ['Payer Rule', 'billing.payer', 'SubworkflowAgency Rule', 'Built-in', '—', '—'],
      ['Match', 'billing.match', 'Subworkflow', 'Built-inHas Your Copy', 'v2', '—'],
      ['Match', 'billing.match', 'Subworkflow', 'AgencyBase Updated', 'v2', '—']
    ]);
  });

  it('highlights the search in names and keys', () => {
    showTable('q=bat');
    assert.deepEqual(
      [...document.querySelectorAll('mark')].map((m) => m.textContent),
      ['Bat', 'bat']
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

  it('sorts by name, key and kind but not by scope or versions', () => {
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
        ['Key', null, '/workflows?q=bat&sort=key&dir=asc'],
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

  it('offers a new workflow that returns to the list, and the customization map', async () => {
    window.history.replaceState(null, '', '/workflows?q=bat');
    const { client } = fakeClient();
    showPage(client, 'workflows');
    await screen.findByRole('table');
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Workflows' }));
    assert.equal(
      screen.getByRole('link', { name: 'New Workflow' }).getAttribute('href'),
      '/workflows/new?kind=workflow&back=%2Fworkflows%3Fq%3Dbat'
    );
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
    assert.equal(
      screen.getByRole('link', { name: 'New Subworkflow' }).getAttribute('href'),
      '/workflows/new?kind=node'
    );
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
