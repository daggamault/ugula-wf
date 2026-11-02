import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileGraph, ENTRY_TYPE, graphRefs, portKey, RETURN_TYPE, refKey } from './compile.ts';
import type { GraphDef } from './types.ts';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [{ name: 'v', type: 'number', default: 0 }],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'a', type: 'std.math.add', version: 1 },
    { id: 'b', type: 'std.math.add', version: 1 },
    { id: 'ret', type: RETURN_TYPE, version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'ret', toPin: 'exec' },
    { from: 'a', fromPin: 'result', to: 'b', toPin: 'a' },
    { from: 'a', fromPin: 'result', to: 'b', toPin: 'b' }
  ]
};

describe('compileGraph', () => {
  it('indexes nodes, boundaries, edges and variables and caches by definition', () => {
    const g = compileGraph(def);
    assert.equal(g.entry?.id, 'entry');
    assert.deepEqual(
      g.returns.map((r) => r.id),
      ['ret']
    );
    assert.equal(g.out.get(portKey('a', 'result'))?.length, 2);
    assert.equal(g.in.get(portKey('ret', 'exec'))?.[0]?.from, 'entry');
    assert.equal(g.variables.get('v')?.default, 0);
    assert.equal(compileGraph(def), g);
  });

  it('lists distinct node refs', () => {
    assert.equal(refKey({ type: 'x', version: 2 }), 'x@2');
    assert.deepEqual(graphRefs(def).map(refKey), [
      `${ENTRY_TYPE}@1`,
      'std.math.add@1',
      `${RETURN_TYPE}@1`
    ]);
  });
});
