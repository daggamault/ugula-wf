import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, RETURN_TYPE } from '@ugula/graph';
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
  edges: [{ from: 'entry', fromPin: 'exec', to: 'return1', toPin: 'exec' }]
};

const link = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  source,
  sourceHandle,
  target,
  targetHandle
});

describe('toFlow', () => {
  it('marks customized nodes and wires and adds removed base nodes as ghosts', () => {
    const wire = def.edges[0];
    assert.ok(wire);
    const { nodes, edges } = toFlow(def, catalog, {
      changes: { add1: 'changed' },
      changedEdges: new Set([edgeId(wire)]),
      removed: [{ id: 'old1', type: 'std.math.add', version: 1, position: { x: 5, y: 6 } }]
    });
    assert.equal(nodes.find((n) => n.id === 'add1')?.data.change, 'changed');
    assert.equal(nodes.find((n) => n.id === 'up1')?.data.change, null);
    const ghost = nodes.find((n) => n.id === 'removed:old1');
    assert.equal(ghost?.data.ghost, true);
    assert.equal(ghost?.selectable, false);
    assert.deepEqual(ghost?.position, { x: 5, y: 6 });
    assert.ok(String(edges[0]?.className).includes('stroke-custom'));
  });

  it('maps nodes with signatures, decorations and default positions', () => {
    const { nodes, edges } = toFlow(def, catalog, {
      status: { add1: 'error' },
      issues: { add1: ['Input "b" is required'] }
    });
    const add = nodes.find((n) => n.id === 'add1');
    assert.equal(add?.data.title, 'Add');
    assert.equal(add?.data.status, 'error');
    assert.deepEqual(add?.data.issues, ['Input "b" is required']);
    assert.ok(add?.position);
    assert.equal(nodes[0]?.deletable, false);
    assert.deepEqual(nodes.find((n) => n.id === 'return1')?.data.connected, ['exec']);
    assert.equal(
      edges[0]?.id,
      edgeId({ from: 'entry', fromPin: 'exec', to: 'return1', toPin: 'exec' })
    );
    assert.ok(edges[0]?.className?.includes('stroke-[3]'));
    assert.equal(edges[0]?.animated, false);
    assert.equal(toFlow(def, catalog, { status: { return1: 'waiting' } }).edges[0]?.animated, true);
  });
});

describe('arranging', () => {
  it('fills in missing positions once, then arranges every node on request', () => {
    const filled = placed(def, catalog);
    assert.ok(filled.nodes.every((n) => n.position));
    assert.deepEqual(filled.nodes[0]?.position, def.nodes[0]?.position);
    assert.equal(placed(filled, catalog), filled);
    const moved = moveNodes(filled, { entry: { x: 900, y: 900 } });
    assert.deepEqual(
      arranged(moved, catalog).nodes[0]?.position,
      arranged(filled, catalog).nodes[0]?.position
    );
  });
});

describe('connections', () => {
  it('only allow matching exec pins and assignable data types', () => {
    assert.equal(connectionKind(def, catalog, link('entry', 'exec', 'return1', 'exec')), 'exec');
    assert.equal(connectionKind(def, catalog, link('entry', 'x', 'add1', 'b')), 'data');
    assert.equal(connectionKind(def, catalog, link('entry', 'x', 'up1', 'text')), null);
    assert.equal(connectionKind(def, catalog, link('entry', 'exec', 'add1', 'a')), null);
    assert.equal(connectionKind(def, catalog, link('add1', 'result', 'add1', 'a')), null);
  });

  it('replace existing links and literal bindings on the same input', () => {
    const wired = connect(def, catalog, link('entry', 'x', 'add1', 'a'));
    assert.equal(wired.nodes.find((n) => n.id === 'add1')?.inputs?.a, undefined);
    const rewired = connect(wired, catalog, link('add1', 'result', 'return1', 'y'));
    const again = connect(rewired, catalog, link('entry', 'x', 'return1', 'y'));
    assert.deepEqual(
      again.edges.filter((e) => e.to === 'return1' && e.toPin === 'y').map((e) => e.from),
      ['entry']
    );
    assert.equal(connect(def, catalog, link('entry', 'x', 'up1', 'text')), def);
  });

  it('move an exec wire when its output is connected again', () => {
    const twoReturns: GraphDef = {
      ...def,
      nodes: [...def.nodes, { id: 'return2', type: RETURN_TYPE, version: 1 }]
    };
    const moved = connect(twoReturns, catalog, link('entry', 'exec', 'return2', 'exec'));
    assert.deepEqual(moved.edges, [
      { from: 'entry', fromPin: 'exec', to: 'return2', toPin: 'exec' }
    ]);
  });
});

describe('editing', () => {
  it('adds nodes with unique ids and removes nodes with their edges but never the entry', () => {
    const { id, def: added } = addNode(def, { type: 'std.math.add', version: 1 }, { x: 5, y: 5 });
    assert.equal(id, 'add2');
    const removed = removeNodes(added, ['entry', 'return1']);
    assert.ok(removed.nodes.some((n) => n.id === 'entry'));
    assert.equal(removed.edges.length, 0);
    assert.equal(removeEdges(def, ['entry:exec->return1:exec']).edges.length, 0);
  });

  it('disconnects every wire on one side of a pin and nothing else', () => {
    assert.equal(disconnectPin(def, 'entry', 'exec', 'out').edges.length, 0);
    assert.equal(disconnectPin(def, 'return1', 'exec', 'in').edges.length, 0);
    assert.equal(disconnectPin(def, 'entry', 'exec', 'in').edges.length, def.edges.length);
  });

  it('moves, updates and refreshes nodes immutably', () => {
    const moved = moveNodes(def, { add1: { x: 10.4, y: 20.6 } });
    assert.deepEqual(moved.nodes[1]?.position, { x: 10, y: 21 });
    const updated = updateNode(def, 'add1', {
      id: 'add1',
      type: 'std.math.add',
      version: 1,
      label: 'Sum'
    });
    assert.equal(updated.nodes[1]?.label, 'Sum');
    const refreshed = withSignature(def, {
      variables: [{ name: 'v', type: 'number', default: 0 }]
    });
    assert.notEqual(refreshed.nodes[0], def.nodes[0]);
    assert.equal(refreshed.variables.length, 1);
  });
});

describe('node look', () => {
  it('passes kind, summary and exit docs to the node', () => {
    const add = toFlow(def, catalog).nodes.find((n) => n.id === 'add1');
    assert.equal(add?.data.kind, 'pure');
    assert.equal(toFlow(def, catalog).nodes.find((n) => n.id === 'entry')?.data.kind, 'entry');
    assert.equal(add?.data.fold, null);
  });

  it('folds the fields of break and make nodes down to the used ones', () => {
    assert.equal(foldedSide('nemsis.pcr.break'), 'out');
    assert.equal(foldedSide('std.object.make'), 'in');
    assert.equal(foldedSide('std.list.make'), null);
    assert.equal(foldedSide('std.math.add'), null);
    const pcr: GraphDef = {
      ...def,
      nodes: [...def.nodes, { id: 'pcr1', type: 'nemsis.pcr.break', version: 1 }]
    };
    const fold = () => toFlow(pcr, catalog).nodes.find((n) => n.id === 'pcr1')?.data.fold;
    assert.deepEqual(fold(), { side: 'out', shown: [] });
    const out = catalog.signatureOf({ id: 'p', type: 'nemsis.pcr.break', version: 1 }, pcr)
      ?.outputs[0]?.name;
    assert.ok(out);
    const revealed = revealPin(pcr, 'pcr1', out);
    assert.deepEqual(
      toFlow(revealed, catalog).nodes.find((n) => n.id === 'pcr1')?.data.fold?.shown,
      [out]
    );
    assert.deepEqual(revealPin(revealed, 'pcr1', out).nodes.at(-1)?.shown, [out]);
  });
});

describe('context-sensitive add', () => {
  it('offers only palette nodes with a pin that fits the dragged one', () => {
    const fromNumber = compatibleEntries(def, catalog, { node: 'entry', pin: 'x', side: 'out' });
    const types = fromNumber.map((e) => e.type);
    assert.ok(types.includes('std.math.add'));
    assert.ok(!types.includes('std.text.upper'));
    const intoText = compatibleEntries(def, catalog, { node: 'up1', pin: 'text', side: 'in' });
    assert.ok(intoText.some((e) => e.type === 'std.text.upper'));
    assert.ok(!intoText.some((e) => e.type === 'std.math.add'));
    const fromExec = compatibleEntries(def, catalog, { node: 'entry', pin: 'exec', side: 'out' });
    assert.ok(fromExec.some((e) => e.type === 'std.flow.delay'));
    assert.ok(!fromExec.some((e) => e.type === 'std.math.add'));
    assert.deepEqual(compatibleEntries(def, catalog, { node: 'nope', pin: 'x', side: 'out' }), []);
  });

  it('places the picked node at the drop point and wires it', () => {
    const add = { type: 'std.math.add', version: 1 };
    const out = addWired(
      def,
      catalog,
      add,
      { x: 300.4, y: 40 },
      {
        node: 'entry',
        pin: 'x',
        side: 'out'
      }
    );
    assert.deepEqual(out.def.nodes.at(-1)?.position, { x: 300, y: 40 });
    assert.ok(out.def.edges.some((e) => e.from === 'entry' && e.to === out.id && e.toPin === 'a'));
    const back = addWired(
      def,
      catalog,
      add,
      { x: 600, y: 0 },
      {
        node: 'return1',
        pin: 'y',
        side: 'in'
      }
    );
    assert.ok(back.def.edges.some((e) => e.from === back.id && e.fromPin === 'result'));
    assert.ok((back.def.nodes.at(-1)?.position?.x ?? 0) < 600, 'placed left of the input');
    const loose = addWired(def, catalog, add, { x: 0, y: 0 }, null);
    assert.equal(loose.def.edges.length, def.edges.length);
  });
});

describe('reroute', () => {
  it('splits a data wire with a knot typed like its source', () => {
    const wired = connect(def, catalog, link('entry', 'x', 'add1', 'a'));
    const wire = wired.edges.find((e) => e.to === 'add1');
    assert.ok(wire);
    const knot = insertReroute(wired, catalog, edgeId(wire), { x: 108, y: 58 });
    assert.ok(knot);
    const node = knot.def.nodes.at(-1);
    assert.deepEqual(
      [node?.type, node?.config, node?.position],
      [REROUTE.type, { type: 'number' }, { x: 100, y: 50 }]
    );
    assert.deepEqual(
      knot.def.edges.filter((e) => e.from === knot.id || e.to === knot.id).map(edgeId),
      [`entry:x->${knot.id}:value`, `${knot.id}:value->add1:a`]
    );
    assert.ok(!knot.def.edges.includes(wire));
    assert.equal(insertReroute(def, catalog, 'entry:exec->return1:exec', { x: 0, y: 0 }), null);
  });
});
