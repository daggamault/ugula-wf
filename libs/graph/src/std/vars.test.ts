import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { GraphDef, Json } from '../types.ts';
import { appendVarNode, getVarNode, incrementVarNode, setVarNode } from './vars.ts';

const graph: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [
    { name: 'count', type: 'number', default: 0 },
    { name: 'codes', type: { list: 'string' }, default: [] }
  ],
  nodes: [],
  edges: []
};

describe('variable nodes', () => {
  it('types pins from the graph variable', async () => {
    const vars: Record<string, Json> = { count: 2, codes: [] };
    const get = await invokeNode(getVarNode, { graph, vars, config: { name: 'count' } });
    assert.equal(get.signature.outputs[0]?.type, 'number');
    assert.deepEqual(get.outputs, { value: 2 });
    const append = await invokeNode(appendVarNode, {
      graph,
      vars,
      config: { name: 'codes' },
      inputs: { item: 'A0427' }
    });
    assert.equal(append.signature.inputs[0]?.type, 'string');
    assert.deepEqual(vars.codes, ['A0427']);
  });

  it('sets and increments', async () => {
    const vars: Record<string, Json> = { count: 1 };
    const config = { name: 'count' };
    await invokeNode(setVarNode, { graph, vars, config, inputs: { value: 10 } });
    const inc = await invokeNode(incrementVarNode, { graph, vars, config });
    assert.deepEqual(inc.outputs, { value: 11 });
    assert.equal(vars.count, 11);
  });
});
