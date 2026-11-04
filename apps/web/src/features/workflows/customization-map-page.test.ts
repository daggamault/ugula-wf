import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { CustomizationMap, WorkflowsClient } from './client.ts';
import { buildMap, CustomizationMapPage, CustomizationMapView } from './customization-map-page.tsx';

const map: CustomizationMap = {
  graphs: [
    {
      id: 'g-flow',
      key: 'billing.flow',
      name: 'Flow',
      kind: 'workflow',
      role: 'workflow',
      scope: 'system',
      children: ['billing.build', 'billing.price'],
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
      tables: ['billing.rates']
    },
    {
      id: 'g-charges',
      key: 'billing.charges',
      name: 'Agency Charges',
      kind: 'node',
      role: 'slot',
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
    },
    {
      id: 'g-other',
      key: 'billing.other',
      name: 'Other',
      kind: 'workflow',
      role: 'workflow',
      scope: 'system',
      children: [],
      tables: []
    }
  ],
  tables: [{ id: 't-rates', key: 'billing.rates', name: 'Rates', scope: 'organization' }]
};

describe('buildMap', () => {
  it('builds each workflow call tree without looping back up', () => {
    const [flow, other] = buildMap(map, false);
    assert.equal(flow?.name, 'Flow');
    assert.equal(other?.name, 'Other');
    const [build, price] = flow?.children ?? [];
    assert.deepEqual(
      build?.children.map((c) => c.key),
      ['billing.charges']
    );
    assert.equal(build?.tables[0]?.scope, 'organization');
    assert.equal(price?.customized, false);
  });

  it('keeps only branches that lead to a customized graph or table', () => {
    const roots = buildMap(map, true);
    assert.deepEqual(
      roots.map((r) => r.key),
      ['billing.flow']
    );
    assert.deepEqual(
      roots[0]?.children.map((c) => c.key),
      ['billing.build']
    );
  });
});

describe('CustomizationMapView', () => {
  it('highlights customized branches and links to each copy and table', () => {
    const html = renderToStaticMarkup(createElement(CustomizationMapView, { map, showAll: false }));
    assert.ok(html.includes('Customization Map') && html.includes('border-custom'));
    assert.ok(
      html.includes('href="/workflows/g-charges"') && html.includes('href="/tables/t-rates"')
    );
    assert.ok(html.includes('Agency Rule') && html.includes('>Organization<'));
    assert.ok(html.includes('href="/workflows/customized?all=shown"'));
    assert.ok(!html.includes('>Other<'));
    const all = renderToStaticMarkup(createElement(CustomizationMapView, { map, showAll: true }));
    assert.ok(all.includes('Other') && all.includes('Runs as built.'));
    const empty = renderToStaticMarkup(
      createElement(CustomizationMapView, { map: { graphs: [], tables: [] }, showAll: false })
    );
    assert.ok(empty.includes('Nothing Customized Yet'));
  });

  it('waits for the map', () => {
    const html = renderToStaticMarkup(
      createElement(CustomizationMapPage, {
        client: { map: () => new Promise(() => undefined) } as unknown as WorkflowsClient,
        live: idleLive,
        showAll: false
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
