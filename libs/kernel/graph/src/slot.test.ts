import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, RETURN_TYPE } from './compile.ts';
import { pin } from './define.ts';
import { createEngine } from './engine.ts';
import { combineSources, createRegistry } from './registry.ts';
import { isPassThrough, slotGraph } from './slot.ts';
import { stdGraphSource } from './std/composites.ts';
import { createStdNodes } from './std/index.ts';
import type { GraphDef } from './types.ts';
import { validateGraph } from './validate.ts';

const lines = { list: { object: { code: 'string' } } } as const;

const pure = {
  execIn: [],
  execOut: [],
  inputs: [pin('lines', lines), pin('tripType', 'string', { optional: true })],
  outputs: [pin('lines', lines)]
};

const nodes = createStdNodes({ fetch });

describe('slotGraph', () => {
  it('builds a valid pass-through that returns its inputs as outputs', async () => {
    const def = slotGraph(pure);
    const registry = createRegistry(nodes, combineSources(stdGraphSource));
    assert.deepEqual(validateGraph(def, registry), []);
    assert.equal(isPassThrough(def), true);
    const parent: GraphDef = {
      signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [pin('lines', lines)] },
      variables: [],
      nodes: [
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        {
          id: 'slot',
          type: 'acme.slot',
          version: 1,
          inputs: { lines: { value: [{ code: 'A0428' }] }, tripType: { value: 'emergency' } }
        },
        { id: 'return', type: RETURN_TYPE, version: 1 }
      ],
      edges: [
        { from: 'entry', fromPin: 'exec', to: 'return', toPin: 'exec' },
        { from: 'slot', fromPin: 'lines', to: 'return', toPin: 'lines' }
      ]
    };
    const graphs: Record<string, GraphDef> = { 'acme.slot': def, 'acme.parent': parent };
    const engine = createEngine({
      nodes,
      graphs: combineSources(stdGraphSource, (ref) => graphs[ref.type])
    });
    const now = new Date('2026-01-01T00:00:00.000Z');
    const state = engine.start({ type: 'acme.parent', version: 1 }, {}, { now });
    await engine.drain(state, { runId: 'r1', now });
    assert.deepEqual(state.result?.outputs, { lines: [{ code: 'A0428' }] });
  });

  it('passes the exec flow through action slots', () => {
    const def = slotGraph({ ...pure, execIn: ['exec'], execOut: ['then'] });
    assert.ok(def.edges.some((e) => e.fromPin === 'exec' && e.toPin === 'exec'));
    assert.equal(isPassThrough(def), true);
  });

  it('refuses outputs that no input passes and more than one path', () => {
    assert.throws(
      () => slotGraph({ ...pure, outputs: [pin('total', 'number')] }),
      /same name and type/
    );
    assert.throws(() => slotGraph({ ...pure, execIn: ['a', 'b'] }), /one way in/);
  });
});

describe('isPassThrough', () => {
  it('is false once a slot does anything', () => {
    const def = slotGraph(pure);
    assert.equal(
      isPassThrough({
        ...def,
        nodes: [...def.nodes, { id: 'x', type: 'std.math.add', version: 1 }]
      }),
      false
    );
    assert.equal(isPassThrough({ ...def, edges: [] }), false);
    assert.equal(isPassThrough({ ...def, nodes: def.nodes.slice(0, 1) }), false);
  });
});
