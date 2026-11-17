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
  FieldEditor,
  fieldOptions,
  GraphInputEditor,
  RuleEditor,
  RuleTestEditor,
  ruleOptions,
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

const nodes: PublishedNode[] = [
  published('billing.claim', 'Claim Cycle', 1, 'workflow'),
  published('billing.claim', 'Claim Cycle', 2, 'workflow'),
  published('billing.intake', 'Intake', 1, 'workflow'),
  published('acme.rule', 'Rule', 1, 'node'),
  {
    ...published('acme.line', 'Line Modifiers', 2, 'node'),
    role: 'rule',
    signature: {
      execIn: [],
      execOut: [],
      inputs: [
        { name: 'line', type: 'string', label: 'Service Line' },
        { name: 'facts', type: 'any' }
      ],
      outputs: [
        { name: 'modifiers', type: { list: 'string' } },
        { name: 'billable', type: 'boolean' }
      ]
    }
  }
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

describe('RuleEditor', () => {
  it('picks a rule, the input each item goes to and the output that keeps it', () => {
    assert.deepEqual(ruleOptions(nodes, ''), [{ value: 'acme.line', label: 'Line Modifiers' }]);
    const map = render(RuleEditor, { rule: 'acme.line', version: 2, item: 'line' });
    assert.ok(map.includes('>Each Item Goes To</label>') && map.includes('>Service Line</span>'));
    assert.ok(!map.includes('>Keep When</label>'));
    const filter = render(RuleTestEditor, {
      rule: 'acme.line',
      version: 2,
      item: 'line',
      test: 'billable'
    });
    assert.match(filter, /aria-selected="true" data-value="billable"/);
    assert.ok(!render(RuleEditor, {}).includes('>Each Item Goes To</label>'));
  });
});

describe('FieldEditor', () => {
  it('lists the fields of the record wired in, else asks for the path', () => {
    const record = { object: { trip: { object: { state: 'string' } }, miles: 'number' } };
    assert.deepEqual(fieldOptions(record as never, ''), [
      { value: 'trip', label: 'Trip' },
      { value: 'trip.state', label: 'Trip › State' },
      { value: 'miles', label: 'Miles' }
    ]);
    const html = render(FieldEditor, { record, path: 'trip.state' });
    assert.match(html, /aria-selected="true" data-value="trip.state"/);
    assert.ok(render(FieldEditor, {}).includes('Wire a record in to choose from its fields'));
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
