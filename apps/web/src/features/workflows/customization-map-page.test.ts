import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, waitFor, within } from '../../shared/testing-dom.ts';
import type { CustomizationMap, WorkflowsClient } from './client.ts';
import { buildMap, CustomizationMapPage, CustomizationMapView } from './customization-map-page.tsx';

const map: CustomizationMap = {
  graphs: [
    {
      id: 'g-other',
      key: 'billing.other',
      name: 'Other',
      kind: 'workflow',
      role: 'workflow',
      scope: 'system',
      children: [],
      tables: []
    },
    {
      id: 'g-flow',
      key: 'billing.flow',
      name: 'Flow',
      kind: 'workflow',
      role: 'workflow',
      scope: 'system',
      children: ['billing.build', 'billing.price', 'billing.missing'],
      tables: []
    },
    {
      id: 'g-build',
      key: 'billing.build',
      name: 'Build',
      kind: 'node',
      role: 'stage',
      scope: 'system',
      children: ['billing.charges', 'billing.flow'],
      tables: ['billing.rates', 'billing.codes', 'billing.gone']
    },
    {
      id: 'g-charges',
      key: 'billing.charges',
      name: 'Agency Charges',
      kind: 'node',
      role: 'rule',
      scope: 'agency',
      children: [],
      tables: []
    },
    {
      id: 'g-price',
      key: 'billing.price',
      name: 'Price',
      kind: 'node',
      role: 'rule',
      scope: 'system',
      children: [],
      tables: []
    }
  ],
  tables: [
    { id: 't-rates', key: 'billing.rates', name: 'Rates', scope: 'agency' },
    { id: 't-codes', key: 'billing.codes', name: 'Codes', scope: 'system' }
  ]
};

type Outline = [string, boolean, Outline[]];

const shape = (nodes: ReturnType<typeof buildMap>): Outline[] =>
  nodes.map((n) => [
    n.key,
    n.customized,
    [
      ...n.tables.map((t): Outline => [`table ${t.key}`, t.scope !== 'system', []]),
      ...shape(n.children)
    ]
  ]);

const outlineOf = (list: Element, depth = 0): string[] =>
  [...list.children].flatMap((li) => {
    const link = li.querySelector('a');
    const line = `${'  '.repeat(depth)}${link?.textContent}${li.className.includes('border-custom') ? ' *' : ''}`;
    const nested = [...li.children].find((c) => c.tagName === 'UL');
    return [line, ...(nested ? outlineOf(nested, depth + 1) : [])];
  });

const panel = (name: string) => screen.getByRole('region', { name });

const view = (showAll: boolean, m: CustomizationMap = map) =>
  render(createElement(CustomizationMapView, { map: m, showAll }));

describe('buildMap', () => {
  it('grows each workflow call tree by name, without looping back up or missing parts', () => {
    assert.deepEqual(shape(buildMap(map, false)), [
      [
        'billing.flow',
        false,
        [
          [
            'billing.build',
            false,
            [
              ['table billing.rates', true, []],
              ['table billing.codes', false, []],
              ['billing.charges', true, []]
            ]
          ],
          ['billing.price', false, []]
        ]
      ],
      ['billing.other', false, []]
    ]);
  });

  it('keeps only branches and tables that lead to a customization', () => {
    assert.deepEqual(shape(buildMap(map, true)), [
      [
        'billing.flow',
        false,
        [
          [
            'billing.build',
            false,
            [
              ['table billing.rates', true, []],
              ['billing.charges', true, []]
            ]
          ]
        ]
      ]
    ]);
  });

  it('carries each graph id, name and scope', () => {
    const [flow] = buildMap(map, true);
    const charges = flow?.children[0]?.children[0];
    assert.deepEqual(charges && { id: charges.id, name: charges.name, scope: charges.scope }, {
      id: 'g-charges',
      name: 'Agency Charges',
      scope: 'agency'
    });
  });
});

describe('CustomizationMapView', () => {
  it('shows only the workflows that lead to a customization, highlighted', () => {
    view(false);
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
      ['Flow']
    );
    const flow = panel('Flow');
    assert.ok(
      within(flow).getByText('Highlighted branches lead to a copy or table your agency changed.')
    );
    assert.deepEqual(outlineOf(within(flow).getAllByRole('list')[0] as Element), [
      'Flow *',
      '  Build *',
      '    Rates *',
      '    Agency Charges *'
    ]);
  });

  it('links each graph and table and badges the agency copies', () => {
    view(false);
    const flow = panel('Flow');
    assert.deepEqual(
      within(flow)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
      [
        ['Flow', '/workflows/g-flow'],
        ['Build', '/workflows/g-build'],
        ['Rates', '/tables/t-rates'],
        ['Agency Charges', '/workflows/g-charges']
      ]
    );
    const charges = screen.getByRole('link', { name: 'Agency Charges' }).parentElement;
    assert.equal(charges?.textContent, 'Agency Chargesbilling.chargesAgency');
    const rates = screen.getByRole('link', { name: 'Rates' }).parentElement;
    assert.equal(rates?.textContent, 'RatesAgency');
  });

  it('offers to show everything', () => {
    view(false);
    assert.equal(
      screen.getByRole('link', { name: 'Show Everything' }).getAttribute('href'),
      '/workflows/customized?all=shown'
    );
    assert.equal(
      screen.getByRole('link', { name: 'Back to Workflows' }).getAttribute('href'),
      '/workflows'
    );
  });

  it('shows every workflow when asked, marking those that run as built', () => {
    view(true);
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
      ['Flow', 'Other']
    );
    assert.deepEqual(outlineOf(within(panel('Flow')).getAllByRole('list')[0] as Element), [
      'Flow *',
      '  Build *',
      '    Rates *',
      '    Codes',
      '    Agency Charges *',
      '  Price'
    ]);
    assert.ok(within(panel('Other')).getByText('Runs as built.'));
    assert.equal(
      screen.getByRole('link', { name: 'Show Only Changes' }).getAttribute('href'),
      '/workflows/customized'
    );
  });

  it('says nothing is customized yet', () => {
    view(false, { graphs: map.graphs.filter((g) => g.scope === 'system'), tables: [] });
    assert.ok(screen.getByRole('heading', { name: 'Nothing Customized Yet' }));
    assert.ok(
      screen.getByText(
        'Every workflow runs as built. Override a subworkflow or a table to see it here.'
      )
    );
  });
});

describe('CustomizationMapPage', () => {
  const fakeClient = (reply: () => Promise<CustomizationMap>) => {
    const calls: number[] = [];
    const client = {
      map: () => {
        calls.push(calls.length);
        return reply();
      }
    } as unknown as WorkflowsClient;
    return { client, calls };
  };

  const page = (client: WorkflowsClient, live: Live = idleLive) =>
    render(createElement(CustomizationMapPage, { client, live, showAll: false }));

  it('waits for the map, then shows it', async () => {
    let resolve: (m: CustomizationMap) => void = () => undefined;
    const { client, calls } = fakeClient(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    page(client);
    assert.ok(screen.getByLabelText('Loading'));
    resolve(map);
    assert.ok(await screen.findByRole('region', { name: 'Flow' }));
    assert.equal(calls.length, 1);
  });

  it('says why the map could not load', async () => {
    const { client } = fakeClient(() => Promise.reject(new Error('Map is down')));
    page(client);
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Map is down'));
  });

  it('reloads after the live connection comes back', async () => {
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    const { client, calls } = fakeClient(async () => map);
    page(client, live);
    await screen.findByRole('region', { name: 'Flow' });
    for (const listener of listeners) listener(null);
    await waitFor(() => assert.equal(calls.length, 2));
  });
});
