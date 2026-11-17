import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, type NodeInstance } from '@ugula/graph';
import { createElement, useState } from 'react';
import { createCatalog, type PublishedNode } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { EffectiveTable } from './client.ts';
import { msOf, NodeInspector, secondsOf } from './node-inspector.tsx';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [{ name: 'wait', type: 'number', default: 1 }],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    {
      id: 'delay1',
      type: 'std.flow.delay',
      version: 1,
      inputs: { ms: { expr: 'wait * 1000' } },
      retry: { max: 3, delayMs: 500 }
    },
    { id: 'add1', type: 'std.math.add', version: 1, inputs: { a: { value: 2 } } },
    { id: 'round1', type: 'std.math.round', version: 1 },
    { id: 'expr1', type: 'std.expr', version: 1, config: { expression: 'a + 1' } },
    { id: 'branch1', type: 'std.flow.branch', version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'delay1', toPin: 'exec' },
    { from: 'add1', fromPin: 'result', to: 'round1', toPin: 'value' }
  ]
};

const rulePublished: PublishedNode = {
  graph_id: 'g1',
  key: 'acme.rule',
  name: 'Rule',
  kind: 'node',
  role: 'rule',
  overridden: false,
  description: '',
  version: 1,
  signature: {
    execIn: ['exec'],
    execOut: ['held'],
    inputs: [{ name: 'claim', type: 'any', description: 'The claim to check' }],
    outputs: [],
    exits: { held: { label: 'On Hold', description: 'A biller holds it' } }
  }
};

type Options = {
  graph?: GraphDef;
  editable?: boolean;
  onOpen?: () => void;
  base?: NodeInstance;
  table?: EffectiveTable;
  isWorkflow?: boolean;
};

const show = (id: string, { graph = def, editable = true, ...extra }: Options = {}) => {
  const calls: string[] = [];
  const changes: GraphDef[] = [];
  const Harness = () => {
    const [current, setCurrent] = useState(graph);
    const node = current.nodes.find((n) => n.id === id);
    assert.ok(node, id);
    return createElement(NodeInspector, {
      def: current,
      node,
      catalog: createCatalog(testNodes, { published: [rulePublished] }),
      editable,
      onChange: (next) => {
        changes.push(next);
        setCurrent(next);
      },
      onDelete: () => calls.push('delete'),
      onClose: () => calls.push('close'),
      ...extra
    });
  };
  render(createElement(Harness));
  const nodeOf = (n = changes.length - 1) => changes[n]?.nodes.find((x) => x.id === id);
  return { calls, changes, nodeOf, user: userEvent.setup() };
};

const withNode = (node: NodeInstance): GraphDef => ({
  ...def,
  nodes: [...def.nodes.filter((n) => n.id !== node.id), node]
});

const region = (name: string) => within(screen.getByRole('region', { name }));

const pin = (scope: ReturnType<typeof region>, label: string) => {
  const item = scope.getByText(label, { exact: true }).closest('li');
  assert.ok(item, label);
  return within(item as HTMLElement);
};

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe('NodeInspector', () => {
  it('names the step and explains what it does', () => {
    show('delay1');
    const panel = screen.getByRole('complementary', { name: 'Delay' });
    assert.match(
      within(panel).getAllByRole('paragraph')[0]?.textContent ?? '',
      /even across restarts/
    );
  });

  it('sets what starts a workflow on its start', () => {
    show('entry', { isWorkflow: true });
    assert.ok(screen.getByRole('heading', { name: 'Trigger' }));
    assert.equal(
      screen.getByRole('button', { name: 'Starts' }).textContent,
      'When Someone Runs It'
    );
  });

  it('has no trigger on the start of a subworkflow', () => {
    show('entry');
    assert.equal(screen.queryByRole('heading', { name: 'Trigger' }), null);
  });

  it('closes and deletes the step', async () => {
    const { calls, user } = show('delay1');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Delete Node' }));
    assert.deepEqual(calls, ['close', 'delete']);
  });

  it('offers to open the workflow a node starts only when it can be opened', async () => {
    const opened: string[] = [];
    show('delay1', { onOpen: () => opened.push('open') });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Workflow' }));
    assert.deepEqual(opened, ['open']);
  });

  it('has nothing to open when no opener is given', () => {
    show('delay1');
    assert.ok(!screen.queryByRole('button', { name: 'Open Workflow' }));
  });

  it('shows how an input is set by an expression', () => {
    show('delay1');
    const inputs = region('Inputs');
    const ms = pin(inputs, 'How long to wait, in milliseconds.');
    assert.ok(ms.getByText('Whole Number'));
    assert.equal(ms.getByRole('button', { name: 'Value' }).textContent, 'An Expression');
    assert.equal(
      (ms.getByRole('textbox', { name: /^Expression/ }) as HTMLInputElement).value,
      'wait * 1000'
    );
  });

  it('sends the graph with the edited expression', async () => {
    const { nodeOf, user } = show('delay1');
    const expr = screen.getByRole('textbox', { name: /^Expression/ });
    await user.type(expr, '0');
    assert.deepEqual(nodeOf()?.inputs, { ms: { expr: 'wait * 10000' } });
  });

  it('names where a connected input comes from', () => {
    show('round1');
    assert.ok(region('Inputs').getByText('From Add · Result'));
  });

  it('shows a fixed value and drops it once the input is unset', async () => {
    const { nodeOf, user } = show('add1');
    const a = pin(region('Inputs'), 'A');
    assert.equal(a.getByRole('button', { name: 'Value' }).textContent, 'A Fixed Value');
    assert.equal((a.getByLabelText(/^Fixed Value/) as HTMLInputElement).value, '2');
    await user.click(
      within(a.getByRole('listbox', { name: 'Value' })).getByRole('option', { name: 'Not Set' })
    );
    assert.deepEqual(nodeOf()?.inputs, {});
  });

  it('says what an unset input falls back to', () => {
    show('add1');
    assert.ok(pin(region('Inputs'), 'B').getByText('Left empty unless you set it.'));
  });

  it('says when an unset input needs a value', () => {
    show('branch1');
    assert.ok(
      region('Inputs').getByText('Needs a value: connect a pin on the canvas, or set one here.')
    );
  });

  it('lists who uses each output', () => {
    show('add1');
    assert.equal(pin(region('Outputs'), 'Result').getByText('Round').textContent, 'Round');
  });

  it('says when an output is not used yet', () => {
    show('round1');
    assert.ok(region('Outputs').getByText('Not used yet'));
  });

  it('lists where each exit goes, with its documentation', () => {
    show('branch1');
    const then = region('Then');
    assert.ok(pin(then, 'True').getByText('The condition is true.'));
    assert.equal(pin(then, 'True').getByText('Not connected').textContent, 'Not connected');
  });

  it('names the default exit Next and the steps it leads to', () => {
    show('entry');
    assert.ok(pin(region('Then'), 'Next').getByText('Delay'));
  });

  it('documents the pins and exits of a published node', () => {
    show('rule1', { graph: withNode({ id: 'rule1', type: 'acme.rule', version: 1 }) });
    assert.ok(pin(region('Inputs'), 'Claim').getByText('The claim to check'));
    assert.ok(pin(region('Then'), 'On Hold').getByText('A biller holds it'));
  });

  it('shows the settings as a form, before the outputs', () => {
    show('expr1');
    const settings = screen.getByRole('region', { name: 'Settings' });
    assert.equal(field('Formula').value, 'a + 1');
    assert.equal(
      settings.compareDocumentPosition(screen.getByRole('region', { name: 'Outputs' })),
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('sends the graph with the edited settings', async () => {
    const { nodeOf, user } = show('expr1');
    await user.type(field('Formula'), '0');
    assert.deepEqual(nodeOf()?.config, { expression: 'a + 10' });
  });

  it('offers the settings as JSON under Advanced', async () => {
    const { user } = show('expr1');
    await user.click(screen.getByText('Advanced'));
    await user.click(screen.getByText('Edit Settings as JSON'));
    assert.deepEqual(
      JSON.parse(
        (screen.getByRole('textbox', { name: 'Settings as JSON' }) as HTMLTextAreaElement).value
      ),
      { expression: 'a + 1' }
    );
  });

  it('has no settings for nodes that take none', () => {
    show('add1');
    assert.ok(!screen.queryByRole('region', { name: 'Settings' }));
  });

  it('shows the retry attempts and first wait in seconds', () => {
    show('delay1');
    assert.equal(field('Attempts').value, '3');
    assert.equal(field('First Wait (Seconds)').value, '0.5');
  });

  it('turns retries on with a one second first wait that doubles', async () => {
    const { nodeOf, user } = show('branch1');
    assert.equal(field('First Wait (Seconds)').disabled, true);
    await user.type(field('Attempts'), '2');
    assert.deepEqual(nodeOf()?.retry, { max: 2, delayMs: 1000, factor: 2 });
    assert.equal(field('First Wait (Seconds)').disabled, false);
  });

  it('sends the first wait in milliseconds', async () => {
    const { nodeOf, user } = show('delay1');
    await user.clear(field('First Wait (Seconds)'));
    await user.type(field('First Wait (Seconds)'), '1.5');
    assert.deepEqual(nodeOf()?.retry, { max: 3, delayMs: 1500 });
  });

  it('turns retries off at zero attempts', async () => {
    const { nodeOf, user } = show('delay1');
    await user.clear(field('Attempts'));
    assert.equal(nodeOf()?.retry, undefined);
    assert.equal(Object.hasOwn(nodeOf() ?? {}, 'retry'), false);
  });

  it('offers no retries or Advanced for steps that only compute values', () => {
    show('add1');
    assert.ok(!screen.queryByText('Advanced'));
    assert.ok(!screen.queryByLabelText('Attempts'));
  });

  it('renames a step and notes why it is there, last and collapsed', async () => {
    const { nodeOf, user } = show('branch1');
    const summary = screen.getByText('Rename and Note');
    assert.equal(summary.closest('details')?.open, false);
    assert.equal(
      screen.getByRole('region', { name: 'Then' }).compareDocumentPosition(summary),
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    await user.click(summary);
    assert.equal(field('Label').placeholder, 'Branch');
    await user.type(field('Label'), 'Paid?');
    await user.type(field(/^Note/ as unknown as string), 'Ask billing');
    assert.equal(nodeOf()?.label, 'Paid?');
    assert.equal(nodeOf()?.note, 'Ask billing');
  });

  it('drops the label and note once cleared', async () => {
    const { nodeOf, user } = show('rule1', {
      graph: withNode({ id: 'rule1', type: 'acme.rule', version: 1, label: 'X', note: 'Y' })
    });
    await user.click(screen.getByText('Rename and Note'));
    await user.clear(field('Label'));
    await user.clear(screen.getByRole('textbox', { name: /^Note/ }));
    assert.deepEqual(nodeOf(), { id: 'rule1', type: 'acme.rule', version: 1 });
  });

  it('shows the note as text and locks every field in a read-only graph', () => {
    show('rule1', {
      graph: withNode({ id: 'rule1', type: 'acme.rule', version: 1, note: 'Check with billing' }),
      editable: false
    });
    assert.ok(region('Note').getByText('Check with billing'));
    assert.ok(!screen.queryByRole('textbox', { name: /^Note/ }));
    assert.ok(!screen.queryByText('Rename and Note'));
    assert.ok(!screen.queryByRole('button', { name: 'Delete Node' }));
    const fieldsets = screen.getAllByRole('group').filter((g) => g.tagName === 'FIELDSET');
    assert.notEqual(fieldsets.length, 0);
    for (const set of fieldsets) assert.equal(set.hasAttribute('disabled'), true);
  });

  it('never deletes the start', () => {
    show('entry');
    assert.match(screen.getByRole('complementary').textContent ?? '', /Where this graph starts/);
    assert.ok(!screen.queryByRole('button', { name: 'Delete Node' }));
  });

  describe('overrides', () => {
    const node = { id: 'add1', type: 'std.math.add', version: 1, inputs: { a: { value: 5 } } };
    const base = { ...node, inputs: { a: { value: 2 } } };

    it('shows what an override changed, with the base value', () => {
      show('add1', { graph: withNode(node), base });
      const changed = region('Changed From Base');
      assert.deepEqual(
        changed.getAllByRole('listitem').map((li) => li.textContent),
        ['Input ABase: 2Reset to Base']
      );
      assert.equal(
        pin(region('Inputs'), 'A').getAllByRole('img', { name: 'Changed from the base' }).length,
        1
      );
    });

    it('resets a change to the base', async () => {
      const { nodeOf, user } = show('add1', { graph: withNode(node), base });
      await user.click(screen.getByRole('button', { name: 'Reset to Base' }));
      assert.deepEqual(nodeOf()?.inputs, { a: { value: 2 } });
    });

    it('shows no changes when the node matches its base', () => {
      show('add1', { graph: withNode(node), base: node });
      assert.ok(!screen.queryByRole('region', { name: 'Changed From Base' }));
    });

    it('offers no reset in a read-only graph', () => {
      show('add1', { graph: withNode(node), base, editable: false });
      assert.ok(screen.getByRole('region', { name: 'Changed From Base' }));
      assert.ok(!screen.queryByRole('button', { name: 'Reset to Base' }));
    });
  });

  describe('shared tables', () => {
    const rates = {
      id: 'rates',
      type: 'std.table.lookup',
      version: 1,
      config: { type: 'string', table: { key: 'billing.rates' } }
    };

    it('links a table node to its shared table and says when it is customized', () => {
      show('rates', {
        graph: withNode(rates),
        table: { id: 't1', key: 'billing.rates', name: 'Rates', scope: 'agency' }
      });
      const settings = region('Settings');
      assert.equal(
        settings.getByRole('link', { name: 'Open Table' }).getAttribute('href'),
        '/tables/t1'
      );
      assert.ok(settings.getByText('Customized for This Agency'));
      assert.ok(!screen.queryByRole('button', { name: 'Add Row' }));
      assert.ok(!screen.queryByText('Edit Settings as JSON'));
    });

    it('says when the shared table is not available', () => {
      show('rates', { graph: withNode(rates) });
      assert.ok(region('Settings').getByText('This table is not available to your agency.'));
    });

    it('keeps the settings of a node that tests items against a shared table', () => {
      show('known', {
        graph: withNode({
          id: 'known',
          type: 'std.list.where',
          version: 1,
          config: { field: 'code', op: 'listed', table: { key: 'billing.codes' } }
        })
      });
      assert.equal(screen.getByRole('button', { name: 'Test' }).textContent, 'Is Listed in Table');
      assert.equal(field('Table').value, 'billing.codes');
    });
  });
});

describe('retry waits', () => {
  it('converts between seconds and whole milliseconds, never below zero', () => {
    assert.equal(secondsOf(1500), 1.5);
    assert.equal(msOf(2.5), 2500);
    assert.equal(msOf(0.0004), 0);
    assert.equal(msOf(0.0016), 2);
    assert.equal(msOf(-1), 0);
  });
});
