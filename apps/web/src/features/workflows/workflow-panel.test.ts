import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { createElement, useState } from 'react';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { exitsOf, withExits } from '../../shared/graph/signature-edits.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { GraphKind } from './client.ts';
import { freeName, type VariableNode, WorkflowPanel, withDoc } from './workflow-panel.tsx';

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: ['ok', 'rejected'],
    inputs: [
      { name: 'claim', type: { object: { id: 'string' } }, label: 'Claim' },
      { name: 'payer', type: 'string' }
    ],
    outputs: [{ name: 'total', type: 'number' }],
    exits: { rejected: { label: 'Rejected', description: 'The payer said no' } }
  },
  variables: [{ name: 'lines', type: { list: 'string' }, default: [] }],
  nodes: [],
  edges: []
};

type Options = {
  kind?: GraphKind;
  editable?: boolean;
  locked?: string | null;
  withVariableNodes?: boolean;
};

const show = ({
  kind = 'workflow',
  editable = true,
  locked = null,
  withVariableNodes = true
}: Options = {}) => {
  const changes: GraphDef[] = [];
  const variableNodes: [string, VariableNode][] = [];
  let closed = 0;
  const Harness = () => {
    const [current, setCurrent] = useState(def);
    return createElement(WorkflowPanel, {
      kind,
      def: current,
      catalog: createCatalog(testNodes),
      editable,
      locked,
      onChange: (next) => {
        changes.push(next);
        setCurrent(next);
      },
      onVariableNode: withVariableNodes
        ? (name, node) => void variableNodes.push([name, node])
        : undefined,
      onClose: () => {
        closed++;
      }
    });
  };
  render(createElement(Harness));
  return { changes, variableNodes, closes: () => closed, user: userEvent.setup() };
};

const section = (name: string) => screen.getByRole('region', { name });

const names = (name: string) =>
  within(section(name))
    .queryAllByRole('textbox', { name: 'Name' })
    .map((input) => (input as HTMLInputElement).value);

const last = <T>(items: readonly T[]) => items[items.length - 1];

describe('WorkflowPanel', () => {
  it('describes what a workflow takes in and hands back, and closes', async () => {
    const { closes, user } = show();
    const panel = screen.getByRole('complementary', { name: 'Inputs and Outputs' });
    assert.match(
      within(panel).getByText(/^What this/).textContent ?? '',
      /^What this workflow takes in, hands back and keeps while it runs, shown as its node's pins\. Tip: /
    );
    await user.click(screen.getByRole('button', { name: 'Close Inputs and Outputs' }));
    assert.equal(closes(), 1);
  });

  it('calls a node graph a subworkflow', () => {
    show({ kind: 'node' });
    assert.ok(screen.getByText(/^What this subworkflow takes in/));
  });

  it('lists the inputs, outputs, exits and variables by their friendly names', () => {
    show();
    assert.deepEqual(names('Inputs'), ['Claim', 'Payer']);
    assert.deepEqual(names('Outputs'), ['Total']);
    assert.deepEqual(names('Exits'), ['Ok', 'Rejected']);
    assert.deepEqual(names('Variables'), ['Lines']);
    const exits = within(section('Exits'));
    assert.deepEqual(
      exits
        .getAllByRole('textbox', { name: 'Description' })
        .map((i) => (i as HTMLInputElement).value),
      ['', 'The payer said no']
    );
  });

  it('turns running as a step off and on', async () => {
    const { changes, user } = show();
    const step = screen.getByRole('checkbox', { name: 'Runs as a Step' });
    assert.equal((step as HTMLInputElement).checked, true);
    await user.click(step);
    await user.click(step);
    assert.deepEqual(
      changes.map((c) => c.signature.execIn),
      [[], ['exec']]
    );
  });

  it('adds a text input with a free name', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Input' }));
    assert.deepEqual(last(changes[0]?.signature.inputs ?? []), {
      name: 'newInput',
      type: 'string'
    });
    assert.deepEqual(names('Inputs'), ['Claim', 'Payer', 'New Input']);
  });

  it('removes and reorders outputs and inputs', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Move Claim down' }));
    assert.deepEqual(names('Inputs'), ['Payer', 'Claim']);
    await user.click(screen.getByRole('button', { name: 'Remove Total' }));
    assert.deepEqual(changes[1]?.signature.outputs, []);
    assert.deepEqual(
      changes[1]?.signature.inputs.map((p) => p.name),
      ['payer', 'claim']
    );
  });

  it('renames an unused input by its friendly name once you leave the field', async () => {
    const { changes, user } = show();
    const name = within(section('Inputs')).getAllByRole('textbox', { name: 'Name' })[1];
    assert.ok(name);
    await user.clear(name);
    await user.type(name, 'Primary Payer');
    assert.equal(changes.length, 0);
    await user.tab();
    assert.deepEqual(changes[0]?.signature.inputs[1], { name: 'primaryPayer', type: 'string' });
    assert.deepEqual(names('Inputs'), ['Claim', 'Primary Payer']);
  });

  it('refuses a blank or duplicate name and puts the old one back', async () => {
    const { changes, user } = show();
    const name = within(section('Inputs')).getAllByRole('textbox', { name: 'Name' })[1];
    assert.ok(name);
    await user.clear(name);
    assert.ok(screen.getByText('Give it a name.'));
    await user.type(name, 'claim');
    assert.ok(screen.getByText('Another one already has this name.'));
    await user.keyboard('{Enter}');
    assert.equal(changes.length, 0);
    assert.equal((name as HTMLInputElement).value, 'Payer');
  });

  it('makes an input optional with a value to use when it is not given', async () => {
    const { changes, user } = show();
    const required = within(section('Inputs')).getAllByRole('checkbox', { name: 'Required' })[1];
    assert.ok(required);
    assert.equal((required as HTMLInputElement).checked, true);
    await user.click(required);
    assert.deepEqual(changes[0]?.signature.inputs[1], {
      name: 'payer',
      type: 'string',
      optional: true
    });
    await user.type(screen.getByRole('textbox', { name: 'When Not Given' }), 'X');
    assert.deepEqual(last(changes)?.signature.inputs[1], {
      name: 'payer',
      type: 'string',
      optional: true,
      default: 'X'
    });
    await user.click(required);
    assert.deepEqual(last(changes)?.signature.inputs[1], { name: 'payer', type: 'string' });
  });

  it('asks for no Required choice on outputs', () => {
    show();
    assert.equal(
      within(section('Outputs')).queryAllByRole('checkbox', { name: 'Required' }).length,
      0
    );
  });

  it('adds an exit named after the next free number', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Exit' }));
    assert.deepEqual(changes[0]?.signature.execOut, ['ok', 'rejected', 'exit3']);
    assert.deepEqual(changes[0]?.signature.exits, {
      rejected: { label: 'Rejected', description: 'The payer said no' }
    });
  });

  it('describes an exit and forgets its docs once cleared', async () => {
    const { changes, user } = show();
    const exits = within(section('Exits'));
    await user.type(exits.getAllByRole('textbox', { name: 'Description' })[0] as HTMLElement, 'O');
    assert.deepEqual(changes[0]?.signature.exits, {
      ok: { description: 'O' },
      rejected: { label: 'Rejected', description: 'The payer said no' }
    });
    await user.clear(exits.getAllByRole('textbox', { name: 'Description' })[1] as HTMLElement);
    assert.deepEqual(last(changes)?.signature.exits, {
      ok: { description: 'O' },
      rejected: { label: 'Rejected' }
    });
    assert.deepEqual(last(changes)?.signature.execOut, ['ok', 'rejected']);
  });

  it('adds a number variable that starts at zero', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Variable' }));
    assert.deepEqual(changes[0]?.variables, [
      { name: 'lines', type: { list: 'string' }, default: [] },
      { name: 'newVariable', type: 'number', default: 0 }
    ]);
    assert.deepEqual(changes[0]?.signature, def.signature);
  });

  it('adds Get and Set nodes for a variable', async () => {
    const { changes, variableNodes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Get Lines' }));
    await user.click(screen.getByRole('button', { name: 'Add Set Lines' }));
    assert.deepEqual(variableNodes, [
      ['lines', 'get'],
      ['lines', 'set']
    ]);
    assert.deepEqual(changes, []);
  });

  it('offers no Get or Set nodes when the editor cannot add them', () => {
    show({ withVariableNodes: false });
    assert.ok(!screen.queryByRole('button', { name: /^Add (Get|Set) / }));
    assert.ok(screen.getByRole('button', { name: 'Add Variable' }));
  });

  it('is read-only with the reason when the contract is fixed', () => {
    show({ editable: false, locked: 'A copy keeps the inputs and outputs of the standard.' });
    assert.ok(screen.getByText('A copy keeps the inputs and outputs of the standard.'));
    assert.ok(!screen.queryByText(/^What this/));
    const step = screen.getByRole('checkbox', { name: 'Runs as a Step' });
    assert.equal(step.closest('fieldset')?.disabled, true);
    assert.deepEqual(
      screen.queryAllByRole('button', { name: /^(Add|Remove|Move) / }).map((b) => b.textContent),
      []
    );
  });
});

describe('exitsOf', () => {
  it('lists every exit with its docs', () => {
    assert.deepEqual(exitsOf(def.signature), [
      { name: 'ok' },
      { name: 'rejected', label: 'Rejected', description: 'The payer said no' }
    ]);
  });

  it('lists bare exits when none are documented', () => {
    assert.deepEqual(exitsOf({ ...def.signature, exits: undefined as never }), [
      { name: 'ok' },
      { name: 'rejected' }
    ]);
  });
});

describe('withExits', () => {
  it('keeps the order of the exits and only the docs with text', () => {
    const next = withExits(def.signature, [
      { name: 'done', label: '' },
      { name: 'rejected', description: 'No' },
      { name: 'held', label: 'Held' }
    ]);
    assert.deepEqual(next.execOut, ['done', 'rejected', 'held']);
    assert.deepEqual(next.exits, { rejected: { description: 'No' }, held: { label: 'Held' } });
  });

  it('drops the docs entirely when no exit has any', () => {
    assert.deepEqual(withExits(def.signature, [{ name: 'ok' }]), {
      execIn: ['exec'],
      execOut: ['ok'],
      inputs: def.signature.inputs,
      outputs: def.signature.outputs
    });
  });
});

describe('withDoc', () => {
  it('sets a doc field', () => {
    assert.deepEqual(withDoc({ name: 'a', label: 'A' }, 'description', 'About a'), {
      name: 'a',
      label: 'A',
      description: 'About a'
    });
  });

  it('drops a doc field set to blank text', () => {
    assert.deepEqual(withDoc({ name: 'a', label: 'A' }, 'label', ' '), { name: 'a' });
  });
});

describe('freeName', () => {
  it('numbers after the names taken, skipping any already in use', () => {
    assert.equal(freeName('exit', []), 'exit1');
    assert.equal(freeName('exit', ['exit2']), 'exit3');
    assert.equal(freeName('var', ['var1', 'var2']), 'var3');
    assert.equal(freeName('var', ['a', 'var3', 'var4']), 'var5');
  });
});
