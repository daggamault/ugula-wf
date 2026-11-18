import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valueKinds } from '@ugula/catalog';
import type { GraphDef, Json } from '@ugula/graph';
import { type ComponentType, createElement, useState } from 'react';
import { createCatalog, type PublishedNode } from '../../shared/graph/catalog.ts';
import { ValueKindsContext } from '../../shared/graph/pins.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
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

const lineRule = (version: number, inputs: string, test: string): PublishedNode => ({
  ...published('acme.line', 'Line Modifiers', version, 'node'),
  role: 'rule',
  signature: {
    execIn: [],
    execOut: [],
    inputs: [
      { name: inputs, type: 'string', label: 'Service Line' },
      { name: 'facts', type: 'any' }
    ],
    outputs: [
      { name: 'modifiers', type: { list: 'string' } },
      { name: test, type: 'boolean' },
      { name: 'flagged', type: 'boolean' }
    ]
  }
});

const nodes: PublishedNode[] = [
  published('billing.claim', 'Claim Cycle', 1, 'workflow'),
  published('billing.claim', 'Claim Cycle', 2, 'workflow'),
  published('billing.intake', 'Intake', 1, 'workflow'),
  published('acme.rule', 'Rule', 1, 'node'),
  lineRule(2, 'line', 'billable'),
  lineRule(1, 'item', 'kept'),
  {
    ...published('acme.age', 'Age Check', 1, 'node'),
    signature: { execIn: [], execOut: [], inputs: [], outputs: [] }
  }
];

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [
      { name: 'claimId', type: 'string' },
      { name: 'tripDate', type: 'string' }
    ],
    outputs: []
  },
  variables: [
    { name: 'total', type: 'number', default: 0 },
    { name: 'count', type: 'integer', default: 0 }
  ],
  nodes: [],
  edges: []
};

const Harness = ({
  editor,
  initial,
  sent,
  editable
}: {
  editor: ComponentType<SettingsEditorProps>;
  initial: Json;
  sent: (Json | undefined)[];
  editable: boolean;
}) => {
  const [config, setConfig] = useState<Json | undefined>(initial);
  return createElement(
    ValueKindsContext.Provider,
    { value: valueKinds },
    createElement(editor, {
      nodeId: 'n',
      config,
      editable,
      onConfig: (next) => {
        sent.push(next);
        setConfig(next);
      },
      def,
      catalog: createCatalog(testNodes, { published: nodes })
    })
  );
};

const show = (editor: ComponentType<SettingsEditorProps>, initial: Json, editable = true) => {
  const sent: (Json | undefined)[] = [];
  render(createElement(Harness, { editor, initial, sent, editable }));
  return { sent, last: () => sent.at(-1), user: userEvent.setup() };
};

const shown = (name: string) => screen.getByRole('button', { name }).textContent;

const option = (list: string, name: string) =>
  within(screen.getByRole('listbox', { name: list })).getByRole('option', { name });

const optionsIn = (list: string) =>
  within(screen.getByRole('listbox', { name: list }))
    .getAllByRole('option')
    .map((o) => o.textContent);

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

const hintOf = (el: HTMLElement) =>
  document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent;

describe('workflowOptions', () => {
  it('lists each published workflow once, by name', () => {
    assert.deepEqual(workflowOptions(nodes, ''), [
      { value: 'billing.claim', label: 'Claim Cycle' },
      { value: 'billing.intake', label: 'Intake' }
    ]);
  });

  it('keeps a chosen workflow that is no longer published', () => {
    assert.deepEqual(workflowOptions(nodes, 'gone').at(-1), { value: 'gone', label: 'gone' });
    assert.equal(workflowOptions(nodes, 'billing.claim').length, 2);
  });
});

describe('versionsOf', () => {
  it('lists the published versions newest first', () => {
    assert.deepEqual(versionsOf(nodes, 'billing.claim'), [2, 1]);
    assert.deepEqual(versionsOf(nodes, 'gone'), []);
  });
});

describe('WorkflowEditor', () => {
  it('shows the chosen workflow and its versions', () => {
    show(WorkflowEditor, { workflow: 'billing.claim', version: 1 });
    assert.equal(shown('Workflow'), 'Claim Cycle');
    assert.equal(shown('Version'), 'Version 1');
    assert.deepEqual(optionsIn('Version'), ['Version 2', 'Version 1']);
  });

  it('asks for a workflow before a version', () => {
    show(WorkflowEditor, {});
    assert.equal(shown('Workflow'), 'Choose a Workflow');
    assert.ok(!screen.queryByRole('button', { name: 'Version' }));
  });

  it('runs the latest version of a newly chosen workflow', async () => {
    const { last, user } = show(WorkflowEditor, { workflow: 'billing.intake', version: 1 });
    await user.click(option('Workflow', 'Claim Cycle'));
    assert.deepEqual(last(), { workflow: 'billing.claim', version: 2 });
  });

  it('pins an older version', async () => {
    const { last, user } = show(WorkflowEditor, { workflow: 'billing.claim', version: 2 });
    await user.click(option('Version', 'Version 1'));
    assert.deepEqual(last(), { workflow: 'billing.claim', version: 1 });
  });

  it('keeps a version that is no longer published', () => {
    show(WorkflowEditor, { workflow: 'billing.claim', version: 7 });
    assert.deepEqual(optionsIn('Version'), ['Version 2', 'Version 1', '7']);
  });
});

describe('ruleOptions', () => {
  it('lists published nodes without flow pins as rules', () => {
    assert.deepEqual(ruleOptions(nodes, ''), [
      { value: 'acme.age', label: 'Age Check' },
      { value: 'acme.line', label: 'Line Modifiers' }
    ]);
  });
});

describe('RuleEditor', () => {
  it('picks the input each item goes to', () => {
    show(RuleEditor, { rule: 'acme.line', version: 2, item: 'line' });
    assert.equal(shown('Rule'), 'Line Modifiers');
    assert.equal(shown('Version'), 'Version 2');
    assert.equal(shown('Each Item Goes To'), 'Service Line');
    assert.deepEqual(optionsIn('Each Item Goes To'), ['Service Line', 'Facts']);
    assert.ok(!screen.queryByRole('button', { name: 'Keep When' }));
  });

  it('asks for a rule before anything else', () => {
    show(RuleEditor, {});
    assert.equal(shown('Rule'), 'Choose a Rule');
    assert.ok(!screen.queryByRole('button', { name: 'Version' }));
    assert.ok(!screen.queryByRole('button', { name: 'Each Item Goes To' }));
  });

  it('sends items to the first input of a newly chosen rule', async () => {
    const { last, user } = show(RuleEditor, {});
    await user.click(option('Rule', 'Line Modifiers'));
    assert.deepEqual(last(), { rule: 'acme.line', version: 2, item: 'line' });
  });

  it('follows the first input of another version', async () => {
    const { last, user } = show(RuleEditor, { rule: 'acme.line', version: 2, item: 'facts' });
    await user.click(option('Version', 'Version 1'));
    assert.deepEqual(last(), { rule: 'acme.line', version: 1, item: 'item' });
  });

  it('clears the input when the new rule has none', async () => {
    const { last, user } = show(RuleEditor, { rule: 'acme.line', version: 2, item: 'line' });
    await user.click(option('Rule', 'Age Check'));
    assert.deepEqual(last(), { rule: 'acme.age', version: 1, item: '' });
  });

  it('sends items to another input', async () => {
    const { last, user } = show(RuleEditor, { rule: 'acme.line', version: 2, item: 'line' });
    await user.click(option('Each Item Goes To', 'Facts'));
    assert.deepEqual(last(), { rule: 'acme.line', version: 2, item: 'facts' });
  });
});

describe('RuleTestEditor', () => {
  it('keeps items by one of the true or false outputs', () => {
    show(RuleTestEditor, { rule: 'acme.line', version: 2, item: 'line', test: 'billable' });
    assert.equal(shown('Keep When'), 'Billable');
    assert.deepEqual(optionsIn('Keep When'), ['Billable', 'Flagged']);
  });

  it('keeps by the first true or false output of a newly chosen rule', async () => {
    const { last, user } = show(RuleTestEditor, {});
    await user.click(option('Rule', 'Line Modifiers'));
    assert.deepEqual(last(), { rule: 'acme.line', version: 2, item: 'line', test: 'billable' });
  });

  it('clears the input and the test when the new rule has neither', async () => {
    const { last, user } = show(RuleTestEditor, {
      rule: 'acme.line',
      version: 2,
      item: 'line',
      test: 'billable'
    });
    await user.click(option('Rule', 'Age Check'));
    assert.deepEqual(last(), { rule: 'acme.age', version: 1, item: '', test: '' });
  });

  it('keeps items by another output', async () => {
    const { last, user } = show(RuleTestEditor, {
      rule: 'acme.line',
      version: 2,
      item: 'line',
      test: 'billable'
    });
    await user.click(option('Keep When', 'Flagged'));
    assert.deepEqual(last(), { rule: 'acme.line', version: 2, item: 'line', test: 'flagged' });
  });
});

describe('fieldOptions', () => {
  it('lists every field of a record, nested ones by their path', () => {
    const record = { object: { trip: { object: { state: 'string' } }, miles: 'number' } };
    assert.deepEqual(fieldOptions(record as never, ''), [
      { value: 'trip', label: 'Trip' },
      { value: 'trip.state', label: 'Trip › State' },
      { value: 'miles', label: 'Miles' }
    ]);
  });

  it('keeps a typed path the record does not have', () => {
    assert.deepEqual(fieldOptions({ object: { miles: 'number' } }, 'gone'), [
      { value: 'miles', label: 'Miles' },
      { value: 'gone', label: 'gone' }
    ]);
  });
});

describe('FieldEditor', () => {
  const record = { object: { trip: { object: { state: 'string' } }, miles: 'number' } };

  it('lists the fields of the record wired in', async () => {
    const { last, user } = show(FieldEditor, { record, path: 'trip.state' });
    assert.equal(shown('Field'), 'Trip › State');
    assert.equal(shown('Record'), 'Custom Record');
    await user.click(option('Field', 'Miles'));
    assert.deepEqual(last(), { record, path: 'miles' });
  });

  it('asks for the path when no record is wired in', async () => {
    const { last, user } = show(FieldEditor, {});
    const path = textbox('Field');
    assert.equal(
      hintOf(path),
      "Wire a record in to choose from its fields, or type the field's path."
    );
    await user.type(path, 'a');
    assert.deepEqual(last(), { path: 'a' });
  });

  it('changes the type of the record', async () => {
    const { last, user } = show(FieldEditor, { path: 'a' });
    await user.click(screen.getByRole('checkbox', { name: 'List' }));
    assert.deepEqual(last(), { path: 'a', record: { list: 'any' } });
  });
});

describe('ConstantEditor', () => {
  it('shows the type and value', () => {
    show(ConstantEditor, { type: 'integer', value: 4 });
    assert.equal(shown('Type'), 'Whole Number');
    assert.equal((screen.getByLabelText('Value') as HTMLInputElement).value, '4');
  });

  it('clears the value when the type changes', async () => {
    const { last, user } = show(ConstantEditor, { type: 'integer', value: 4 });
    await user.click(option('Type', 'Text'));
    assert.deepEqual(last(), { type: 'string', value: null });
  });

  it('sends the typed value', async () => {
    const { last, user } = show(ConstantEditor, { type: 'string', value: null });
    await user.type(screen.getByLabelText('Value'), 'hi');
    assert.deepEqual(last(), { type: 'string', value: 'hi' });
  });
});

describe('CodeSetEditor', () => {
  it('picks one of the known code sets', async () => {
    const { last, user } = show(CodeSetEditor, {});
    assert.equal(shown('Code Set'), 'Choose a Code Set');
    await user.click(option('Code Set', valueKinds.code.hcpcs ?? 'hcpcs'));
    assert.deepEqual(last(), { kind: 'hcpcs' });
  });
});

describe('VariableEditor', () => {
  it('picks one of the variables of the workflow', async () => {
    const { last, user } = show(VariableEditor, { name: 'total' });
    assert.equal(shown('Variable'), 'total');
    assert.deepEqual(optionsIn('Variable'), ['total', 'count']);
    await user.click(option('Variable', 'count'));
    assert.deepEqual(last(), { name: 'count' });
  });

  it('keeps a variable that no longer exists', () => {
    show(VariableEditor, { name: 'gone' });
    assert.equal(shown('Variable'), 'gone');
  });
});

describe('GraphInputEditor', () => {
  it('picks one of the inputs of the workflow by its label', async () => {
    const { last, user } = show(GraphInputEditor, { pin: 'claimId' });
    assert.equal(shown('Input'), 'Claim ID');
    await user.click(option('Input', 'Trip Date'));
    assert.deepEqual(last(), { pin: 'tripDate' });
  });

  it('asks for an input when none is chosen', () => {
    show(GraphInputEditor, {});
    assert.equal(shown('Input'), 'Choose an input');
  });
});
