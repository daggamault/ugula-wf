import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, INPUT_TYPE, type Json, type NodeInstance } from '@ugula/graph';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent } from '../../shared/testing-dom.ts';
import {
  ConfigEditor,
  NodeSettings,
  SETTINGS_EDITORS,
  TABLE_EDITORS,
  TableReference
} from './node-settings.tsx';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

const settings = (node: NodeInstance) =>
  renderToStaticMarkup(
    createElement(NodeSettings, {
      node,
      nodeId: node.id,
      config: node.config,
      editable: true,
      onConfig: () => undefined,
      def,
      catalog: createCatalog(testNodes)
    })
  );

describe('ConfigEditor', () => {
  it('shows node settings as formatted JSON, read-only when not editable', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigEditor, {
        node: { id: 'n1', type: 'std.expr', version: 1, config: { expression: '1' } },
        editable: false,
        onConfig: () => undefined
      })
    );
    assert.ok(html.includes('Settings as JSON') && html.includes('disabled=""'));
    assert.ok(html.includes('&quot;expression&quot;: &quot;1&quot;'));
  });

  it('sends the settings once the JSON parses, and clears them when emptied', async () => {
    const sent: unknown[] = [];
    const Harness = () => {
      const [config, setConfig] = useState<Json | undefined>({ expression: '1' });
      return createElement(ConfigEditor, {
        node: {
          id: 'n1',
          type: 'std.expr',
          version: 1,
          ...(config === undefined ? {} : { config })
        },
        editable: true,
        onConfig: (next) => {
          sent.push(next);
          setConfig(next);
        }
      });
    };
    render(createElement(Harness));
    const user = userEvent.setup();
    const json = screen.getByRole('textbox', { name: 'Settings as JSON' });
    await user.clear(json);
    assert.deepEqual(sent, [undefined]);
    await user.type(json, '{{"expression": "2"');
    assert.deepEqual(sent, [undefined]);
    await user.type(json, '}');
    assert.deepEqual(sent, [undefined, { expression: '2' }]);
  });
});

describe('NodeSettings', () => {
  it('uses a dedicated editor where there is one and a form from the settings schema otherwise', () => {
    const expr = settings({ id: 'e', type: 'std.expr', version: 1, config: { expression: 'a' } });
    assert.ok(expr.includes('>Formula</label>'));
    const http = settings({ id: 'h', type: 'std.http.request', version: 1 });
    assert.ok(http.includes('>Method</label>') && http.includes('Fail on Error'));
    const switched = settings({
      id: 's',
      type: 'std.flow.switch',
      version: 1,
      config: { cases: ['paid', 'denied'] }
    });
    assert.ok(switched.includes('value="denied"') && switched.includes('Add Case'));
    assert.ok(!switched.includes('<textarea'));
  });

  it('sends edits from the settings form for nodes without a dedicated editor', async () => {
    const sent: unknown[] = [];
    render(
      createElement(NodeSettings, {
        node: { id: 's', type: 'std.flow.switch', version: 1, config: { cases: ['paid'] } },
        nodeId: 's',
        config: { cases: ['paid'] },
        editable: true,
        onConfig: (config) => sent.push(config),
        def,
        catalog: createCatalog(testNodes)
      })
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add Case' }));
    assert.deepEqual(sent, [{ cases: ['paid', ''] }]);
  });

  it('registers dedicated editors only for node types that exist', () => {
    assert.deepEqual(Object.keys(TABLE_EDITORS), ['std.table.lookup', 'std.table.decide']);
    for (const type of [
      ...Object.keys(TABLE_EDITORS),
      'std.expr',
      'std.list.map',
      'std.human.task',
      'std.flow.run-workflow',
      'std.flow.spawn-workflows',
      'std.value',
      'std.var.set',
      INPUT_TYPE,
      ENTRY_TYPE
    ]) {
      assert.ok(Object.hasOwn(SETTINGS_EDITORS, type), type);
    }
    const types = new Set(testNodes.map((n) => n.type));
    for (const type of Object.keys(SETTINGS_EDITORS)) {
      assert.ok(types.has(type) || type === INPUT_TYPE || type === ENTRY_TYPE, type);
    }
  });
});

describe('TableReference', () => {
  it('links a shared table and says when it is customized or unavailable', () => {
    const custom = renderToStaticMarkup(
      createElement(TableReference, {
        tableKey: 'billing.classification',
        table: { id: 't1', key: 'billing.classification', name: 'Classification', scope: 'agency' }
      })
    );
    assert.ok(
      custom.includes('href="/tables/t1"') && custom.includes('Customized for This Agency')
    );
    const missing = renderToStaticMarkup(
      createElement(TableReference, { tableKey: 'x', table: undefined })
    );
    assert.ok(missing.includes('not available to your agency'));
  });
});
