import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, RETURN_TYPE, type ValueType } from '@ugula/graph';
import { testNodes } from '../testing.ts';
import { createCatalog } from './catalog.ts';
import {
  addNode,
  addWired,
  arranged,
  compatibleEntries,
  connect,
  connectionKind,
  disconnectPin,
  edgeId,
  foldedSide,
  insertReroute,
  moveNodes,
  NEW_PIN,
  placed,
  REROUTE,
  removeEdges,
  removeNodes,
  revealPin,
  toFlow,
  updateNode,
  withSignature
} from './flow.ts';

const catalog = createCatalog(testNodes);

const finish = { from: 'entry', fromPin: 'exec', to: 'return1', toPin: 'exec' };

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'x', type: 'number' }],
    outputs: [{ name: 'y', type: 'number' }]
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1, position: { x: 0, y: 0 } },
    { id: 'add1', type: 'std.math.add', version: 1, inputs: { a: { value: 1 } } },
    { id: 'up1', type: 'std.text.upper', version: 1 },
    { id: 'return1', type: RETURN_TYPE, version: 1 }
  ],
  edges: [finish]
};

const link = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  source,
  sourceHandle,
  target,
  targetHandle
});

const flowNode = (g: GraphDef, id: string, decorations = {}) =>
  toFlow(g, catalog, decorations).nodes.find((n) => n.id === id);

describe('edgeId', () => {
  it('names a wire by both of its ends', () => {
    assert.equal(edgeId(finish), 'entry:exec->return1:exec');
  });
});

describe('foldedSide', () => {
  it('folds the outputs of break nodes and the inputs of make nodes', () => {
    assert.equal(foldedSide('encounter.break'), 'out');
    assert.equal(foldedSide('std.object.make'), 'in');
  });

  it('folds neither list nodes nor other nodes', () => {
    assert.equal(foldedSide('std.list.make'), null);
    assert.equal(foldedSide('std.math.add'), null);
  });
});

describe('toFlow nodes', () => {
  it('describes each node from the catalog', () => {
    const add = flowNode(def, 'add1');
    assert.deepEqual(
      [
        add?.type,
        add?.data.title,
        add?.data.kind,
        add?.data.status,
        add?.data.change,
        add?.data.ghost
      ],
      ['graph', 'Add', 'pure', 'idle', null, false]
    );
    assert.deepEqual(add?.data.issues, []);
    assert.equal(add?.data.fold, null);
    assert.equal(add?.data.opens, null);
    assert.equal(flowNode(def, 'entry')?.data.kind, 'entry');
  });

  it('keeps stored positions and lays out nodes without one', () => {
    assert.deepEqual(flowNode(def, 'entry')?.position, { x: 0, y: 0 });
    const filled = placed(def, catalog);
    assert.deepEqual(flowNode(def, 'add1')?.position, filled.nodes[1]?.position);
  });

  it('never lets the entry be deleted', () => {
    assert.deepEqual(
      toFlow(def, catalog).nodes.map((n) => [n.id, n.deletable]),
      [
        ['entry', false],
        ['add1', true],
        ['up1', true],
        ['return1', true]
      ]
    );
  });

  it('lists the inputs each node has wired', () => {
    assert.deepEqual(flowNode(def, 'return1')?.data.connected, ['exec']);
    assert.deepEqual(flowNode(def, 'add1')?.data.connected, []);
  });

  it('shows the status, issues and change of each node', () => {
    const add = flowNode(def, 'add1', {
      status: { add1: 'error' },
      issues: { add1: ['Input "b" is required'] },
      changes: { add1: 'changed' }
    });
    assert.deepEqual(
      [add?.data.status, add?.data.issues, add?.data.change],
      ['error', ['Input "b" is required'], 'changed']
    );
  });

  it('adds removed base nodes as ghosts behind the graph that cannot be touched', () => {
    const { nodes } = toFlow(def, catalog, {
      removed: [{ id: 'old1', type: 'std.math.add', version: 1, position: { x: 5, y: 6 } }]
    });
    const [ghost] = nodes;
    assert.deepEqual(
      [
        ghost?.id,
        ghost?.position,
        ghost?.deletable,
        ghost?.draggable,
        ghost?.selectable,
        ghost?.connectable,
        ghost?.zIndex,
        ghost?.data.ghost,
        ghost?.data.opens
      ],
      ['removed:old1', { x: 5, y: 6 }, false, false, false, false, -1, true, null]
    );
    assert.equal(nodes.length, def.nodes.length + 1);
  });
});

describe('toFlow edges', () => {
  it('maps each wire to its handles, drawing exec wires thick', () => {
    assert.deepEqual(toFlow(def, catalog).edges, [
      {
        id: 'entry:exec->return1:exec',
        source: 'entry',
        sourceHandle: 'exec',
        target: 'return1',
        targetHandle: 'exec',
        className:
          '[&_.react-flow__edge-path]:stroke-surface-fg [&_.react-flow__edge-path]:stroke-[3]',
        animated: false
      }
    ]);
  });

  it('colors a data wire by the type of its source pin', () => {
    const wired = connect(def, catalog, link('entry', 'x', 'add1', 'b'));
    assert.equal(
      toFlow(wired, catalog).edges.at(-1)?.className,
      '[&_.react-flow__edge-path]:stroke-pin-number'
    );
  });

  it('marks changed wires as customized', () => {
    assert.equal(
      toFlow(def, catalog, { changedEdges: new Set([edgeId(finish)]) }).edges[0]?.className,
      '[&_.react-flow__edge-path]:stroke-custom'
    );
  });

  it('animates wires into a waiting node', () => {
    assert.equal(toFlow(def, catalog, { status: { return1: 'waiting' } }).edges[0]?.animated, true);
  });
});

describe('placed and arranged', () => {
  it('fills in only the missing positions', () => {
    const filled = placed(def, catalog);
    assert.equal(
      filled.nodes.every((n) => n.position),
      true
    );
    assert.deepEqual(filled.nodes[0]?.position, def.nodes[0]?.position);
  });

  it('leaves a fully placed graph as it is', () => {
    const filled = placed(def, catalog);
    assert.ok(placed(filled, catalog) === filled);
  });

  it('rearranges every node on request', () => {
    const filled = placed(def, catalog);
    const moved = moveNodes(filled, { entry: { x: 900, y: 900 } });
    assert.deepEqual(
      arranged(moved, catalog).nodes.map((n) => n.position),
      arranged(filled, catalog).nodes.map((n) => n.position)
    );
  });
});

describe('connectionKind', () => {
  it('connects matching exec pins', () => {
    assert.equal(connectionKind(def, catalog, link('entry', 'exec', 'return1', 'exec')), 'exec');
  });

  it('connects data pins whose types are assignable', () => {
    assert.equal(connectionKind(def, catalog, link('entry', 'x', 'add1', 'b')), 'data');
    assert.equal(connectionKind(def, catalog, link('entry', 'x', 'up1', 'text')), null);
  });

  it('refuses exec to data, a node to itself, unknown pins and missing handles', () => {
    assert.equal(connectionKind(def, catalog, link('entry', 'exec', 'add1', 'a')), null);
    assert.equal(connectionKind(def, catalog, link('add1', 'result', 'add1', 'a')), null);
    assert.equal(connectionKind(def, catalog, link('entry', 'nope', 'add1', 'a')), null);
    assert.equal(
      connectionKind(def, catalog, {
        source: 'entry',
        sourceHandle: null,
        target: 'add1',
        targetHandle: 'a'
      }),
      null
    );
  });
});

describe('growing the signature from the canvas', () => {
  it('adds an output named and typed after the wire dropped on Return', () => {
    assert.equal(connectionKind(def, catalog, link('add1', 'result', 'return1', NEW_PIN)), 'data');
    const grown = connect(def, catalog, link('add1', 'result', 'return1', NEW_PIN));
    const added = grown.signature.outputs.at(-1);
    assert.deepEqual([added?.name, added?.type], ['result', 'number']);
    assert.deepEqual(grown.edges.at(-1), {
      from: 'add1',
      fromPin: 'result',
      to: 'return1',
      toPin: 'result'
    });
  });

  it('adds an input named and typed after the pin Entry is dragged onto', () => {
    const grown = connect(def, catalog, link('entry', NEW_PIN, 'up1', 'text'));
    const added = grown.signature.inputs.at(-1);
    assert.deepEqual([added?.name, added?.type], ['text', 'string']);
    assert.deepEqual(grown.edges.at(-1), {
      from: 'entry',
      fromPin: 'text',
      to: 'up1',
      toPin: 'text'
    });
  });

  it('keeps a new pin name unique', () => {
    const grown = connect(def, catalog, link('entry', 'x', 'return1', NEW_PIN));
    assert.equal(grown.signature.outputs.at(-1)?.name, 'x');
    const twice = connect(grown, catalog, link('entry', 'x', 'return1', NEW_PIN));
    assert.equal(twice.signature.outputs.at(-1)?.name, 'x2');
  });

  it('never names a new output like an exit', () => {
    const withExit: GraphDef = { ...def, signature: { ...def.signature, execOut: ['result'] } };
    const grown = connect(withExit, catalog, link('add1', 'result', 'return1', NEW_PIN));
    assert.equal(grown.signature.outputs.at(-1)?.name, 'result2');
  });

  it('grows only from Entry and Return, and never on exec pins', () => {
    assert.equal(connectionKind(def, catalog, link('add1', 'result', 'up1', NEW_PIN)), null);
    assert.equal(connectionKind(def, catalog, link('entry', 'exec', 'return1', NEW_PIN)), null);
    assert.equal(connect(def, catalog, link('add1', 'result', 'up1', NEW_PIN)), def);
  });
});

describe('connect', () => {
  it('wires a data input, dropping its literal value', () => {
    const wired = connect(def, catalog, link('entry', 'x', 'add1', 'a'));
    assert.deepEqual(wired.nodes[1], { id: 'add1', type: 'std.math.add', version: 1, inputs: {} });
    assert.deepEqual(wired.edges, [
      finish,
      { from: 'entry', fromPin: 'x', to: 'add1', toPin: 'a' }
    ]);
  });

  it('replaces the wire already on a data input', () => {
    const first = connect(def, catalog, link('add1', 'result', 'return1', 'y'));
    const again = connect(first, catalog, link('entry', 'x', 'return1', 'y'));
    assert.deepEqual(again.edges, [
      finish,
      { from: 'entry', fromPin: 'x', to: 'return1', toPin: 'y' }
    ]);
  });

  it('moves an exec wire when its output is connected again', () => {
    const twoReturns: GraphDef = {
      ...def,
      nodes: [...def.nodes, { id: 'return2', type: RETURN_TYPE, version: 1 }]
    };
    assert.deepEqual(connect(twoReturns, catalog, link('entry', 'exec', 'return2', 'exec')).edges, [
      { from: 'entry', fromPin: 'exec', to: 'return2', toPin: 'exec' }
    ]);
  });

  it('leaves the graph as it is for a connection that does not fit', () => {
    assert.ok(connect(def, catalog, link('entry', 'x', 'up1', 'text')) === def);
  });

  describe('open types', () => {
    const trip: ValueType = { object: { miles: 'number', state: 'string' } };
    const typed: GraphDef = {
      ...def,
      signature: {
        ...def.signature,
        inputs: [{ name: 'trip', type: trip }, ...def.signature.inputs]
      },
      nodes: [
        ...def.nodes,
        { id: 'get1', type: 'std.object.get-field', version: 1, config: { path: 'miles' } },
        { id: 'list1', type: 'std.list.make', version: 1 },
        { id: 'pick1', type: 'std.logic.choose', version: 1, config: { type: 'string' } }
      ]
    };
    const configOf = (g: GraphDef, id: string) => g.nodes.find((n) => n.id === id)?.config;

    it('take the record type of the wire into a field getter', () => {
      const got = connect(typed, catalog, link('entry', 'trip', 'get1', 'record'));
      assert.deepEqual(configOf(got, 'get1'), { path: 'miles', record: trip });
    });

    it('take the item type of the wire into a list', () => {
      const listed = connect(typed, catalog, link('entry', 'x', 'list1', 'item1'));
      assert.deepEqual(configOf(listed, 'list1'), { type: 'number' });
    });

    it('take the item type of a list wire into a list primitive', () => {
      const withContains: GraphDef = {
        ...typed,
        signature: {
          ...typed.signature,
          inputs: [{ name: 'codes', type: { list: 'string' } }, ...typed.signature.inputs]
        },
        nodes: [...typed.nodes, { id: 'has1', type: 'std.list.contains', version: 1 }]
      };
      const got = connect(withContains, catalog, link('entry', 'codes', 'has1', 'list'));
      assert.deepEqual(configOf(got, 'has1'), { type: 'string' });
    });

    it('take the value type of the wire into a comparison', () => {
      const withEqual: GraphDef = {
        ...typed,
        nodes: [...typed.nodes, { id: 'eq1', type: 'std.logic.equal', version: 1 }]
      };
      const got = connect(withEqual, catalog, link('entry', 'x', 'eq1', 'b'));
      assert.deepEqual(configOf(got, 'eq1'), { type: 'number' });
    });

    it('keep a type that was already chosen', () => {
      const kept = connect(typed, catalog, link('entry', 'x', 'pick1', 'option1'));
      assert.deepEqual(configOf(kept, 'pick1'), { type: 'string' });
    });
  });
});

describe('addNode', () => {
  it('adds a node at a position with the next free id for its type', () => {
    const { id, def: added } = addNode(def, { type: 'std.math.add', version: 1 }, { x: 5, y: 5 });
    assert.equal(id, 'add2');
    assert.deepEqual(added.nodes.at(-1), {
      id: 'add2',
      type: 'std.math.add',
      version: 1,
      position: { x: 5, y: 5 }
    });
  });

  it('keeps given settings and drops symbols from the id', () => {
    const { id, def: added } = addNode(
      def,
      { type: 'std.object.get-field', version: 1 },
      { x: 0, y: 0 },
      { path: 'a' }
    );
    assert.equal(id, 'getfield1');
    assert.deepEqual(added.nodes.at(-1)?.config, { path: 'a' });
  });
});

describe('removeNodes and removeEdges', () => {
  it('removes nodes with their wires but never the entry', () => {
    const removed = removeNodes(def, ['entry', 'return1']);
    assert.deepEqual(
      removed.nodes.map((n) => n.id),
      ['entry', 'add1', 'up1']
    );
    assert.deepEqual(removed.edges, []);
  });

  it('removes wires by id', () => {
    assert.deepEqual(removeEdges(def, ['entry:exec->return1:exec']).edges, []);
    assert.deepEqual(removeEdges(def, ['nope']).edges, [finish]);
  });
});

describe('disconnectPin', () => {
  it('removes every wire on one side of a pin', () => {
    assert.deepEqual(disconnectPin(def, 'entry', 'exec', 'out').edges, []);
    assert.deepEqual(disconnectPin(def, 'return1', 'exec', 'in').edges, []);
  });

  it('leaves the wires on the other side', () => {
    assert.deepEqual(disconnectPin(def, 'entry', 'exec', 'in').edges, [finish]);
  });
});

describe('moveNodes, updateNode and withSignature', () => {
  it('moves nodes to rounded positions', () => {
    assert.deepEqual(moveNodes(def, { add1: { x: 10.4, y: 20.6 } }).nodes[1]?.position, {
      x: 10,
      y: 21
    });
  });

  it('replaces one node', () => {
    const next = { id: 'add1', type: 'std.math.add', version: 1, label: 'Sum' };
    assert.deepEqual(updateNode(def, 'add1', next).nodes, [
      def.nodes[0],
      next,
      def.nodes[2],
      def.nodes[3]
    ]);
  });

  it('changes the signature or variables and refreshes every node', () => {
    const refreshed = withSignature(def, {
      variables: [{ name: 'v', type: 'number', default: 0 }]
    });
    assert.deepEqual(refreshed.variables, [{ name: 'v', type: 'number', default: 0 }]);
    assert.deepEqual(refreshed.nodes, def.nodes);
    assert.ok(refreshed.nodes[0] !== def.nodes[0]);
  });
});

describe('revealPin and folds', () => {
  const pcr: GraphDef = {
    ...def,
    nodes: [...def.nodes, { id: 'pcr1', type: 'encounter.break', version: 1 }]
  };
  const out =
    catalog.signatureOf({ id: 'p', type: 'encounter.break', version: 1 }, pcr)?.outputs[0]?.name ??
    '';

  it('folds a break node down to no outputs until one is used', () => {
    assert.deepEqual(flowNode(pcr, 'pcr1')?.data.fold, { side: 'out', shown: [] });
  });

  it('lays a folded node out by the pins it shows, not every pin it could', () => {
    const two: GraphDef = {
      ...def,
      nodes: [
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        { id: 'pcr1', type: 'encounter.break', version: 1, shown: [out] },
        { id: 'pcr2', type: 'encounter.break', version: 1 }
      ],
      edges: []
    };
    const at = (id: string) => flowNode(two, id)?.position.y ?? 0;
    assert.ok(Math.abs(at('pcr2') - at('pcr1')) < 200);
  });

  it('shows a revealed output, once', () => {
    const revealed = revealPin(revealPin(pcr, 'pcr1', out), 'pcr1', out);
    assert.deepEqual(revealed.nodes.at(-1)?.shown, [out]);
    assert.deepEqual(flowNode(revealed, 'pcr1')?.data.fold, { side: 'out', shown: [out] });
  });

  it('shows a wired output', () => {
    const wired = {
      ...pcr,
      edges: [...pcr.edges, { from: 'pcr1', fromPin: out, to: 'up1', toPin: 'text' }]
    };
    assert.deepEqual(flowNode(wired, 'pcr1')?.data.fold?.shown, [out]);
  });
});

describe('compatibleEntries', () => {
  const types = (from: Parameters<typeof compatibleEntries>[2]) =>
    compatibleEntries(def, catalog, from).map((e) => e.type);

  it('offers nodes with an input that takes a dragged output', () => {
    const fromNumber = types({ node: 'entry', pin: 'x', side: 'out' });
    assert.equal(fromNumber.includes('std.math.add'), true);
    assert.equal(fromNumber.includes('std.text.upper'), false);
  });

  it('offers nodes with an output that fits a dragged input', () => {
    const intoText = types({ node: 'up1', pin: 'text', side: 'in' });
    assert.equal(intoText.includes('std.text.upper'), true);
    assert.equal(intoText.includes('std.math.add'), false);
  });

  it('offers nodes that continue a dragged exec wire', () => {
    const fromExec = types({ node: 'entry', pin: 'exec', side: 'out' });
    assert.equal(fromExec.includes('std.flow.delay'), true);
    assert.equal(fromExec.includes('std.math.add'), false);
  });

  it('offers nothing from an unknown node', () => {
    assert.deepEqual(types({ node: 'nope', pin: 'x', side: 'out' }), []);
  });
});

describe('addWired', () => {
  const add = { type: 'std.math.add', version: 1 };

  it('places a node at the drop point and wires the dragged output into it', () => {
    const out = addWired(
      def,
      catalog,
      add,
      { x: 300.4, y: 40 },
      { node: 'entry', pin: 'x', side: 'out' }
    );
    assert.equal(out.id, 'add2');
    assert.deepEqual(out.def.nodes.at(-1)?.position, { x: 300, y: 40 });
    assert.deepEqual(out.def.edges.at(-1), { from: 'entry', fromPin: 'x', to: 'add2', toPin: 'a' });
  });

  it('places a node left of a dragged input and wires its output into it', () => {
    const back = addWired(
      def,
      catalog,
      add,
      { x: 600, y: 0 },
      { node: 'return1', pin: 'y', side: 'in' }
    );
    assert.deepEqual(back.def.nodes.at(-1)?.position, { x: 360, y: 0 });
    assert.deepEqual(back.def.edges.at(-1), {
      from: 'add2',
      fromPin: 'result',
      to: 'return1',
      toPin: 'y'
    });
  });

  it('adds a loose node without a dragged pin', () => {
    const loose = addWired(def, catalog, add, { x: 0, y: 0 }, null);
    assert.deepEqual(loose.def.edges, def.edges);
  });
});

describe('insertReroute', () => {
  it('splits a data wire with a knot centred on the point and typed like its source', () => {
    const wired = connect(def, catalog, link('entry', 'x', 'add1', 'a'));
    const knot = insertReroute(wired, catalog, 'entry:x->add1:a', { x: 108, y: 58 });
    assert.ok(knot);
    assert.equal(knot.id, 'reroute1');
    assert.deepEqual(knot.def.nodes.at(-1), {
      id: 'reroute1',
      type: REROUTE.type,
      version: REROUTE.version,
      position: { x: 100, y: 50 },
      config: { type: 'number' }
    });
    assert.deepEqual(knot.def.edges.map(edgeId), [
      'entry:exec->return1:exec',
      'entry:x->reroute1:value',
      'reroute1:value->add1:a'
    ]);
  });

  it('does not split exec wires or unknown wires', () => {
    assert.equal(insertReroute(def, catalog, 'entry:exec->return1:exec', { x: 0, y: 0 }), null);
    assert.equal(insertReroute(def, catalog, 'nope', { x: 0, y: 0 }), null);
  });
});
