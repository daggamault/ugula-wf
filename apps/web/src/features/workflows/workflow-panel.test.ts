import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { createElement, useState } from 'react';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { GraphKind } from './client.ts';
import {
  exitsOf,
  freeName,
  type VariableNode,
  WorkflowPanel,
  withDoc,
  withExits
} from './workflow-panel.tsx';

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
    assert.equal(
      within(panel).getByText(/^What this/).textContent,
      "What this workflow takes in, hands back and keeps while it runs, shown as its node's pins."
    );
    await user.click(screen.getByRole('button', { name: 'Close Inputs and Outputs' }));
    assert.equal(closes(), 1);
  });

  it('calls a node graph a subworkflow', () => {
    show({ kind: 'node' });
    assert.ok(screen.getByText(/^What this subworkflow takes in/));
  });

  it('lists the inputs, outputs, exits and variables by name', () => {
    show();
    assert.deepEqual(names('Inputs'), ['claim', 'payer']);
    assert.deepEqual(names('Outputs'), ['total']);
    assert.deepEqual(names('Exits'), ['ok', 'rejected']);
    assert.deepEqual(names('Variables'), ['lines']);
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

  it('adds an input with a free name, typed as text', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Input' }));
    assert.equal(changes.length, 1);
    assert.deepEqual(last(changes[0]?.signature.inputs ?? []), { name: 'field3', type: 'string' });
    assert.deepEqual(names('Inputs'), ['claim', 'payer', 'field3']);
  });

  it('removes and reorders outputs and inputs', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Move claim down' }));
    assert.deepEqual(names('Inputs'), ['payer', 'claim']);
    await user.click(screen.getByRole('button', { name: 'Remove total' }));
    assert.deepEqual(changes[1]?.signature.outputs, []);
    assert.deepEqual(
      changes[1]?.signature.inputs.map((p) => p.name),
      ['payer', 'claim']
    );
  });

  it('labels an input and drops the label once it is cleared', async () => {
    const { changes, user } = show();
    const label = within(section('Inputs')).getAllByRole('textbox', { name: 'Label' })[1];
    assert.ok(label);
    await user.type(label, 'P');
    assert.deepEqual(changes[0]?.signature.inputs[1], {
      name: 'payer',
      type: 'string',
      label: 'P'
    });
    await user.clear(label);
    assert.deepEqual(changes[1]?.signature.inputs[1], { name: 'payer', type: 'string' });
  });

  it('adds an exit named after the next free number', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Exit' }));
    assert.deepEqual(changes[0]?.signature.execOut, ['ok', 'rejected', 'exit3']);
    assert.deepEqual(changes[0]?.signature.exits, {
      rejected: { label: 'Rejected', description: 'The payer said no' }
    });
  });

  it('documents an exit and forgets its docs once both are cleared', async () => {
    const { changes, user } = show();
    const exits = within(section('Exits'));
    await user.type(exits.getAllByRole('textbox', { name: 'Label' })[0] as HTMLElement, 'O');
    assert.deepEqual(changes[0]?.signature.exits, {
      ok: { label: 'O' },
      rejected: { label: 'Rejected', description: 'The payer said no' }
    });
    await user.clear(exits.getAllByRole('textbox', { name: 'Label' })[1] as HTMLElement);
    await user.clear(exits.getAllByRole('textbox', { name: 'Description' })[1] as HTMLElement);
    assert.deepEqual(last(changes)?.signature.exits, { ok: { label: 'O' } });
    assert.deepEqual(last(changes)?.signature.execOut, ['ok', 'rejected']);
  });

  it('adds a number variable that starts at zero', async () => {
    const { changes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Variable' }));
    assert.deepEqual(changes[0]?.variables, [
      { name: 'lines', type: { list: 'string' }, default: [] },
      { name: 'var2', type: 'number', default: 0 }
    ]);
    assert.deepEqual(changes[0]?.signature, def.signature);
  });

  it('adds Get and Set nodes for a variable', async () => {
    const { changes, variableNodes, user } = show();
    await user.click(screen.getByRole('button', { name: 'Add Get lines' }));
    await user.click(screen.getByRole('button', { name: 'Add Set lines' }));
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
