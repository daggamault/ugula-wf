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
  it('sizes a node by its pin rows and description', () => {
    assert.equal(action.height - pure.height, 24 - 34);
    assert.deepEqual(action.ins, ['exec', 'a']);
    assert.deepEqual(action.outs, ['then', 'again']);
    assert.equal(action.execOuts, 2);
    assert.equal(action.pure, false);
    assert.equal(pure.pure, true);
    assert.equal(shapeOf(null, false).pure, false);
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

  it('lays out graphs without an entry or edges', () => {
    assert.deepEqual(layout(def(['a'], [])), { a: { x: 0, y: 0 } });
  });
});
