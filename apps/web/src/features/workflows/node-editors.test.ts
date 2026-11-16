import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valueKinds } from '@ugula/catalog';
import type { GraphDef, Json } from '@ugula/graph';
import { type ComponentType, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalog, type PublishedNode } from '../../shared/graph/catalog.ts';
import { ValueKindsContext } from '../../shared/graph/pins.ts';
import { testNodes } from '../../shared/testing.ts';
import {
  CodeSetEditor,
  ConstantEditor,
  GraphInputEditor,
  VariableEditor,
  versionsOf,
  WorkflowEditor,
  workflowOptions
} from './node-editors.tsx';
import type { SettingsEditorProps } from './settings-editor.ts';

const published = (key: string, name: string, version: number, kind: 'workflow' | 'node') =>
  ({
    graph_id: key,
    key,
    name,
    kind,
    role: 'workflow',
    description: '',
    version,
    overridden: false,
    signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] }
  }) satisfies PublishedNode;

const nodes = [
  published('billing.claim', 'Claim Cycle', 1, 'workflow'),
  published('billing.claim', 'Claim Cycle', 2, 'workflow'),
  published('billing.intake', 'Intake', 1, 'workflow'),
  published('acme.rule', 'Rule', 1, 'node')
];

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'claimId', type: 'string' }],
    outputs: []
  },
  variables: [{ name: 'total', type: 'number', default: 0 }],
  nodes: [],
  edges: []
};

const render = (editor: ComponentType<SettingsEditorProps>, config: Json) =>
  renderToStaticMarkup(
    createElement(
      ValueKindsContext.Provider,
      { value: valueKinds },
      createElement(editor, {
        nodeId: 'n',
        config,
        editable: true,
        onConfig: () => undefined,
        def,
        catalog: createCatalog(testNodes, { published: nodes })
      })
    )
  );

describe('WorkflowEditor', () => {
  it('picks a published workflow and one of its versions', () => {
    assert.deepEqual(workflowOptions(nodes, ''), [
      { value: 'billing.claim', label: 'Claim Cycle' },
      { value: 'billing.intake', label: 'Intake' }
    ]);
    assert.deepEqual(workflowOptions(nodes, 'gone').at(-1), { value: 'gone', label: 'gone' });
    assert.deepEqual(versionsOf(nodes, 'billing.claim'), [2, 1]);
    const html = render(WorkflowEditor, { workflow: 'billing.claim', version: 1 });
    assert.ok(html.includes('>Claim Cycle</span>') && html.includes('>Version 1</span>'));
    assert.ok(html.includes('>Version 2</span>'));
    assert.ok(!render(WorkflowEditor, {}).includes('>Version</label>'));
  });
});

describe('small editors', () => {
  it('picks a constant type and value, a code set, a variable and an input', () => {
    const constant = render(ConstantEditor, { type: 'integer', value: 4 });
    assert.ok(constant.includes('>Whole Number</span>') && constant.includes('value="4"'));
    const code = render(CodeSetEditor, { kind: 'hcpcs' });
    assert.ok(code.includes('>Code Set</label>') && code.includes('data-value="hcpcs"'));
    const variable = render(VariableEditor, { name: 'total' });
    assert.match(variable, /aria-selected="true" data-value="total"/);
    const input = render(GraphInputEditor, { pin: 'claimId' });
    assert.ok(input.includes('>Claim ID</span>'));
  });
});
