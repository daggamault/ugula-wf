import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Edge, ENTRY_TYPE, type GraphDef, pin, RETURN_TYPE } from '@ugula/graph';
import { layout, NODE_WIDTH, type Shape, shapeOf } from './layout.ts';

const action = shapeOf(
  { execIn: ['exec'], execOut: ['then', 'again'], inputs: [pin('a', 'number')], outputs: [] },
  false
);
const pure = shapeOf(
  { execIn: [], execOut: [], inputs: [pin('a', 'number')], outputs: [pin('b', 'number')] },
  true
);
const source = shapeOf(
  { execIn: [], execOut: [], inputs: [], outputs: [pin('b', 'number')] },
  false
);
const start = shapeOf(
  { execIn: [], execOut: ['exec'], inputs: [], outputs: [pin('n', 'number')] },
  false
);

const e = (from: string, fromPin: string, to: string, toPin: string): Edge => ({
  from,
  fromPin,
  to,
  toPin
});

const def = (ids: string[], edges: Edge[]): GraphDef => ({
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: ids.map((id) => ({ id, type: id === 'entry' ? ENTRY_TYPE : RETURN_TYPE, version: 1 })),
  edges
});

const column = (x: number) => x / (NODE_WIDTH + 110);

const overlaps = (
  positions: Record<string, { x: number; y: number }>,
  shapes: Map<string, Shape>
) =>
  Object.entries(positions).some(([a, p]) =>
    Object.entries(positions).some(
      ([b, q]) =>
        a < b &&
        p.x === q.x &&
        p.y < q.y + (shapes.get(b)?.height ?? 0) &&
        q.y < p.y + (shapes.get(a)?.height ?? 0)
    )
  );

describe('shapeOf', () => {
  it('lists the input and output pins, exec pins first', () => {
    assert.deepEqual(
      [action.ins, action.outs, action.execOuts],
      [['exec', 'a'], ['then', 'again'], 2]
    );
  });

  it('sizes a node by its title, its pin rows and room for a description', () => {
    assert.deepEqual([action.top, action.height], [34, 94]);
    assert.deepEqual([pure.top, pure.height], [68, 104]);
  });

  it('makes room for the codes and the note a node shows above its pins', () => {
    const sig = { execIn: ['exec'], execOut: ['then'], inputs: [], outputs: [] };
    assert.deepEqual(
      [
        shapeOf(sig, false, { codeRows: 2 }).top,
        shapeOf(sig, false, { note: 'short' }).top,
        shapeOf(sig, false, { note: 'x'.repeat(500) }).top,
        shapeOf(sig, false, { codeRows: 7, note: 'a\nb' }).height
      ],
      [34 + 13 + 32 + 2, 34 + 13 + 16, 34 + 13 + 48, 34 + 13 + 112 + 12 + 13 + 32 + 12 + 24]
    );
  });

  it('marks a node without exec pins as pure', () => {
    assert.equal(action.pure, false);
    assert.equal(pure.pure, true);
    assert.equal(source.pure, true);
  });

  it('gives an unknown node one empty pin row', () => {
    assert.deepEqual(shapeOf(null, false), {
      top: 34,
      height: 70,
      ins: [],
      outs: [],
      execOuts: 0,
      pure: false
    });
  });
});

describe('layout', () => {
  it('keeps loops from pushing nodes right, so a back wire never widens the graph', () => {
    const shapes = new Map([
      ['entry', start],
      ['a', action],
      ['b', action],
      ['c', action]
    ]);
    const positions = layout(
      def(
        ['entry', 'a', 'b', 'c'],
        [
          e('entry', 'exec', 'a', 'exec'),
          e('a', 'then', 'b', 'exec'),
          e('b', 'then', 'c', 'exec'),
          e('c', 'again', 'a', 'exec'),
          e('b', 'again', 'a', 'exec')
        ]
      ),
      shapes
    );
    assert.deepEqual(
      ['entry', 'a', 'b', 'c'].map((id) => column(positions[id]?.x ?? -1)),
      [0, 1, 2, 3]
    );
  });

  it('places pure nodes beside the nodes that use them, not at the far left', () => {
    const shapes = new Map([
      ['entry', start],
      ['a', action],
      ['b', action],
      ['c', action],
      ['getter', source]
    ]);
    const positions = layout(
      def(
        ['entry', 'getter', 'a', 'b', 'c'],
        [
          e('entry', 'exec', 'a', 'exec'),
          e('a', 'then', 'b', 'exec'),
          e('b', 'then', 'c', 'exec'),
          e('getter', 'b', 'c', 'a')
        ]
      ),
      shapes
    );
    assert.equal(column(positions.getter?.x ?? 0), 2);
  });

  it('keeps a pure node near the side most of its wires come from', () => {
    const shapes = new Map([
      ['entry', start],
      ['a', action],
      ['b', action],
      ['c', action],
      ['d', action],
      ['maker', pure]
    ]);
    const positions = layout(
      def(
        ['entry', 'a', 'b', 'c', 'd', 'maker'],
        [
          e('entry', 'exec', 'a', 'exec'),
          e('a', 'then', 'b', 'exec'),
          e('b', 'then', 'c', 'exec'),
          e('c', 'then', 'd', 'exec'),
          e('entry', 'n', 'maker', 'a'),
          e('entry', 'n', 'maker', 'a'),
          e('entry', 'n', 'maker', 'a'),
          e('maker', 'b', 'd', 'a')
        ]
      ),
      shapes
    );
    assert.equal(column(positions.maker?.x ?? 0), 1);
  });

  it('stacks a column without overlaps and lines exec chains up on one row', () => {
    const shapes = new Map<string, Shape>([
      ['entry', start],
      ...['a', 'b', 'c', 'd', 'e'].map((id) => [id, action] as const)
    ]);
    const positions = layout(
      def(
        ['entry', 'a', 'b', 'c', 'd', 'e'],
        [
          e('entry', 'exec', 'a', 'exec'),
          e('a', 'then', 'b', 'exec'),
          e('a', 'again', 'c', 'exec'),
          e('b', 'then', 'd', 'exec'),
          e('c', 'then', 'e', 'exec')
        ]
      ),
      shapes
    );
    assert.equal(overlaps(positions, shapes), false);
    assert.equal(positions.b?.x, positions.c?.x);
    assert.equal(positions.b?.y, positions.d?.y);
    assert.equal(positions.c?.y, positions.e?.y);
    assert.equal(Math.min(...Object.values(positions).map((p) => p.y)), 0);
  });

  it('lays out a graph without edges in one column from the top', () => {
    assert.deepEqual(layout(def(['a'], [])), { a: { x: 0, y: 0 } });
  });

  it('starts a graph without an entry from the nodes nothing wires into', () => {
    const shapes = new Map([
      ['a', action],
      ['b', action]
    ]);
    const positions = layout(def(['b', 'a'], [e('a', 'then', 'b', 'exec')]), shapes);
    assert.deepEqual([column(positions.a?.x ?? -1), column(positions.b?.x ?? -1)], [0, 1]);
  });

  it('ignores wires from a node to itself or to nodes not on the graph', () => {
    const shapes = new Map([
      ['entry', start],
      ['a', action]
    ]);
    const graph = def(['entry', 'a'], [e('entry', 'exec', 'a', 'exec')]);
    assert.deepEqual(
      layout(
        {
          ...graph,
          edges: [...graph.edges, e('a', 'then', 'a', 'exec'), e('a', 'again', 'gone', 'exec')]
        },
        shapes
      ),
      layout(graph, shapes)
    );
  });
});
