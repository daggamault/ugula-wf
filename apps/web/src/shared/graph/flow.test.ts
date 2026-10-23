import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, RETURN_TYPE } from '@ugula/graph';
import { createCatalog } from './catalog.ts';
import {
  addNode,
  connect,
  connectionKind,
  edgeId,
  layout,
  moveNodes,
  removeEdges,
  removeNodes,
  toFlow,
  updateNode,
  withSignature
} from './flow.ts';

const catalog = createCatalog();

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
  it('maps nodes with signatures, decorations and default positions', () => {
    const { nodes, edges } = toFlow(def, catalog, {
      status: { add1: 'error' },
      issues: { add1: ['Input "b" is required'] }
    });
    const add = nodes.find((n) => n.id === 'add1');
    assert.equal(add?.data.title, 'Add');
    assert.equal(add?.data.status, 'error');
    assert.deepEqual(add?.data.issues, ['Input "b" is required']);
    assert.deepEqual(add?.position, { x: 0, y: 200 });
    assert.equal(nodes[0]?.deletable, false);
    assert.deepEqual(nodes.find((n) => n.id === 'return1')?.data.connected, ['exec']);
    assert.equal(
      edges[0]?.id,
      edgeId({ from: 'entry', fromPin: 'exec', to: 'return1', toPin: 'exec' })
    );
    assert.ok(edges[0]?.className?.includes('stroke-[3]'));
  });
});

describe('layout', () => {
  it('places nodes in columns by their longest path from the start, tolerating loops', () => {
    const chain: GraphDef = {
      ...def,
      edges: [
        { from: 'entry', fromPin: 'exec', to: 'add1', toPin: 'exec' },
        { from: 'add1', fromPin: 'result', to: 'return1', toPin: 'y' },
        { from: 'entry', fromPin: 'exec', to: 'return1', toPin: 'exec' },
        { from: 'return1', fromPin: 'x', to: 'add1', toPin: 'a' }
      ]
    };
    const positions = layout(chain);
    assert.deepEqual(positions.entry, { x: 0, y: 0 });
    assert.ok((positions.return1?.x ?? 0) > (positions.entry?.x ?? 0));
    assert.deepEqual(positions.up1, { x: 0, y: 200 });
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
