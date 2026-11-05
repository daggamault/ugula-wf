import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileGraph,
  contractOf,
  ENTRY_TYPE,
  graphRefs,
  portKey,
  RETURN_TYPE,
  refKey,
  retargetRefs,
  WORKFLOW_CALL_TYPES,
  workflowRefs
} from './compile.ts';
import type { GraphDef, Signature } from './types.ts';

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

const calls: GraphDef = {
  ...def,
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    {
      id: 'run',
      type: 'std.flow.run-workflow',
      version: 1,
      config: { workflow: 'w.a', version: 2 }
    },
    {
      id: 'again',
      type: 'std.flow.map-workflow',
      version: 1,
      config: { workflow: 'w.a', version: 2 }
    },
    {
      id: 'start',
      type: 'std.flow.start-workflow',
      version: 1,
      config: { workflow: 'w.b', version: 1 }
    },
    { id: 'spawn', type: 'std.flow.spawn-workflows', version: 1, config: { workflow: 'w.c' } },
    { id: 'odd', type: 'std.flow.run-workflow', version: 1, config: ['w.d', 1] },
    { id: 'other', type: 'std.math.add', version: 1, config: { workflow: 'w.e', version: 1 } }
  ]
};

describe('workflowRefs', () => {
  it('lists the distinct workflows the workflow-calling nodes name', () => {
    assert.equal(WORKFLOW_CALL_TYPES.size, 4);
    assert.deepEqual(workflowRefs(calls), [
      { type: 'w.a', version: 2 },
      { type: 'w.b', version: 1 }
    ]);
    assert.deepEqual(workflowRefs(def), []);
  });
});

describe('retargetRefs', () => {
  it('moves node versions and called workflow versions to the ones given, leaving the rest', () => {
    const versions: Record<string, number> = { 'std.flow.run-workflow': 3, 'w.a': 5 };
    const moved = retargetRefs(calls, (key) => versions[key]);
    assert.deepEqual(moved.nodes[1], {
      id: 'run',
      type: 'std.flow.run-workflow',
      version: 3,
      config: { workflow: 'w.a', version: 5 }
    });
    assert.deepEqual(moved.nodes[2]?.config, { workflow: 'w.a', version: 5 });
    assert.deepEqual(moved.nodes[3], calls.nodes[3]);
    assert.deepEqual(moved.nodes[4], calls.nodes[4]);
    assert.deepEqual(moved.nodes[6], calls.nodes[6]);
    assert.deepEqual(moved.edges, calls.edges);
    assert.deepEqual(calls.nodes[1]?.config, { workflow: 'w.a', version: 2 });
  });
});

describe('contractOf', () => {
  const signature: Signature = {
    execIn: ['exec'],
    execOut: ['done', 'failed'],
    inputs: [{ name: 'claim', type: 'string', label: 'Claim', description: 'The claim' }],
    outputs: [{ name: 'total', type: 'number', optional: true }],
    exits: { done: { label: 'Done' } }
  };

  it('ignores labels, descriptions, default values and exit docs', () => {
    assert.equal(
      contractOf(signature),
      contractOf({
        execIn: ['exec'],
        execOut: ['done', 'failed'],
        inputs: [{ name: 'claim', type: 'string', optional: false }],
        outputs: [{ name: 'total', type: 'number', optional: true, label: 'Total' }]
      })
    );
    const defaulted = (value: string) => ({
      ...signature,
      inputs: [{ name: 'claim', type: 'string' as const, default: value }]
    });
    assert.equal(contractOf(defaulted('x')), contractOf(defaulted('y')));
  });

  it('changes with exec pins, pin names, types, optionality, defaults and order', () => {
    const variants: Signature[] = [
      { ...signature, execOut: ['done'] },
      { ...signature, execIn: [] },
      { ...signature, inputs: [{ name: 'id', type: 'string' }] },
      { ...signature, inputs: [{ name: 'claim', type: 'number' }] },
      { ...signature, inputs: [{ name: 'claim', type: 'string', default: 'x' }] },
      { ...signature, outputs: [{ name: 'total', type: 'number' }] },
      { ...signature, execOut: ['failed', 'done'] }
    ];
    for (const v of variants) assert.notEqual(contractOf(v), contractOf(signature));
  });
});
