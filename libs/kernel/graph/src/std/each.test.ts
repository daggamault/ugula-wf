import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, RETURN_TYPE, refKey } from '../compile.ts';
import { pin } from '../define.ts';
import { createRegistry } from '../registry.ts';
import { runRule } from '../rules.ts';
import type { GraphDef, Json, NodeRef } from '../types.ts';
import { validateGraph } from '../validate.ts';
import { eachNodes } from './each.ts';
import { logicNodes } from './logic.ts';
import { mathNodes } from './math.ts';

const pure = (
  inputs: GraphDef['signature']['inputs'],
  outputs: GraphDef['signature']['outputs'],
  nodes: GraphDef['nodes'],
  edges: [string, string, string, string][]
): GraphDef => ({
  signature: { execIn: [], execOut: [], inputs, outputs },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    ...nodes,
    { id: 'return', type: RETURN_TYPE, version: 1 }
  ],
  edges: edges.map(([from, fromPin, to, toPin]) => ({ from, fromPin, to, toPin }))
});

const SCALE: NodeRef = { type: 'test.scale', version: 1 };

const scale = pure(
  [pin('miles', 'number'), pin('factor', 'number')],
  [pin('scaled', 'number'), pin('long', 'boolean', { label: 'Long Trip' })],
  [
    { id: 'times', type: 'std.math.multiply', version: 1 },
    { id: 'over', type: 'std.logic.greater', version: 1, inputs: { b: { value: 10 } } }
  ],
  [
    ['entry', 'miles', 'times', 'a'],
    ['entry', 'factor', 'times', 'b'],
    ['times', 'result', 'return', 'scaled'],
    ['times', 'result', 'over', 'a'],
    ['over', 'result', 'return', 'long']
  ]
);

const host = (type: string, config: Json, outputs: GraphDef['signature']['outputs']) =>
  pure(
    [pin('trips', { list: 'number' }), pin('factor', 'number')],
    outputs,
    [{ id: 'each', type, version: 1, config }],
    [
      ['entry', 'trips', 'each', 'list'],
      ['entry', 'factor', 'each', 'factor'],
      ...outputs.map((p): [string, string, string, string] => ['each', p.name, 'return', p.name])
    ]
  );

const HOST: NodeRef = { type: 'test.host', version: 1 };
const nodes = [...eachNodes, ...mathNodes, ...logicNodes];

const run = (def: GraphDef, trips: Json[]) => {
  const graphs = (ref: NodeRef) =>
    refKey(ref) === refKey(SCALE) ? scale : refKey(ref) === refKey(HOST) ? def : undefined;
  return runRule({ nodes, graphs }, HOST, { trips, factor: 3 }, new Date(0));
};

const ref = { rule: SCALE.type, version: 1, item: 'miles' };

describe('rule per item nodes', () => {
  it('runs a rule for each item and gives each output as a list', async () => {
    const def = host('std.list.map-rule', ref, [
      pin('scaled', { list: 'number' }),
      pin('long', { list: 'boolean' })
    ]);
    assert.deepEqual(await run(def, [1, 5, 2]), { scaled: [3, 15, 6], long: [false, true, false] });
    assert.deepEqual(await run(def, []), { scaled: [], long: [] });
  });

  it('keeps the items a rule says true for', async () => {
    const def = host('std.list.filter-rule', { ...ref, test: 'long' }, [
      pin('list', { list: 'number' }),
      pin('count', 'integer')
    ]);
    assert.deepEqual(await run(def, [1, 5, 2, 9]), { list: [5, 9], count: 2 });
  });

  it('finds the first item a rule says true for', async () => {
    const def = host('std.list.find-rule', { ...ref, test: 'long' }, [
      pin('item', 'number', { optional: true }),
      pin('found', 'boolean'),
      pin('index', 'integer', { optional: true })
    ]);
    assert.deepEqual(await run(def, [1, 5, 9]), { item: 5, found: true, index: 1 });
    assert.deepEqual(await run(def, [1, 2]), { item: null, found: false, index: null });
  });

  it('types its pins from the rule', () => {
    const registry = createRegistry(nodes, (r) =>
      refKey(r) === refKey(SCALE) ? scale : undefined
    );
    const inst = { id: 'each', type: 'std.list.map-rule', version: 1, config: ref };
    const sig = registry.signature(inst, scale);
    assert.deepEqual(
      sig.inputs.map((p) => [p.name, p.type]),
      [
        ['list', { list: 'number' }],
        ['factor', 'number']
      ]
    );
    assert.deepEqual(
      sig.outputs.map((p) => [p.name, p.type, p.label]),
      [
        ['scaled', { list: 'number' }, undefined],
        ['long', { list: 'boolean' }, 'Long Trip']
      ]
    );
  });

  it('reports a rule that does not fit', () => {
    const registry = createRegistry(nodes, (r) =>
      refKey(r) === refKey(SCALE) ? scale : undefined
    );
    const check = (type: string, config: Json) =>
      validateGraph(host(type, config, []), registry).map((i) => i.message);
    assert.deepEqual(check('std.list.map-rule', { ...ref, item: 'speed' }), [
      'Invalid config: test.scale has no input "speed"'
    ]);
    assert.deepEqual(check('std.list.filter-rule', { ...ref, test: 'scaled' }), [
      'Invalid config: "scaled" of test.scale is not true or false'
    ]);
    assert.deepEqual(check('std.list.find-rule', { ...ref, rule: 'test.gone', test: 'long' }), [
      'Invalid config: Unknown rule test.gone@1'
    ]);
  });
});
