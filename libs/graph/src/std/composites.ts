import { ENTRY_TYPE, RETURN_TYPE, refKey } from '../compile.ts';
import { pin } from '../define.ts';
import type { Edge, GraphDef, GraphSource } from '../types.ts';

const edge = (from: string, fromPin: string, to: string, toPin: string): Edge => ({
  from,
  fromPin,
  to,
  toPin
});

const boundary = [
  { id: 'entry', type: ENTRY_TYPE, version: 1 },
  { id: 'return', type: RETURN_TYPE, version: 1 }
];

export const clampGraph: GraphDef = {
  signature: {
    execIn: [],
    execOut: [],
    inputs: [pin('value', 'number'), pin('min', 'number'), pin('max', 'number')],
    outputs: [pin('result', 'number')]
  },
  variables: [],
  nodes: [
    ...boundary,
    { id: 'lower', type: 'std.math.max', version: 1 },
    { id: 'upper', type: 'std.math.min', version: 1 }
  ],
  edges: [
    edge('entry', 'value', 'lower', 'a'),
    edge('entry', 'min', 'lower', 'b'),
    edge('lower', 'result', 'upper', 'a'),
    edge('entry', 'max', 'upper', 'b'),
    edge('upper', 'result', 'return', 'result')
  ]
};

export const averageGraph: GraphDef = {
  signature: {
    execIn: [],
    execOut: [],
    inputs: [pin('values', { list: 'number' })],
    outputs: [pin('result', 'number')]
  },
  variables: [],
  nodes: [
    ...boundary,
    { id: 'sum', type: 'std.math.sum', version: 1 },
    { id: 'count', type: 'std.list.length', version: 1 },
    { id: 'divide', type: 'std.math.divide', version: 1 }
  ],
  edges: [
    edge('entry', 'values', 'sum', 'values'),
    edge('entry', 'values', 'count', 'list'),
    edge('sum', 'result', 'divide', 'a'),
    edge('count', 'length', 'divide', 'b'),
    edge('divide', 'result', 'return', 'result')
  ]
};

export const stdGraphs: Record<string, GraphDef> = {
  'std.math.clamp@1': clampGraph,
  'std.math.average@1': averageGraph
};

export const stdGraphSource: GraphSource = (ref) => stdGraphs[refKey(ref)];
