import { type Edge, ENTRY_TYPE, type GraphDef, type NodeInstance, RETURN_TYPE } from '@ugula/graph';
import type { SeedGraph } from './graphs.ts';

const node = (
  id: string,
  type: string,
  extra: Partial<Omit<NodeInstance, 'id' | 'type'>> = {}
) => ({
  id,
  type,
  version: 1,
  ...extra
});

const edge = (from: string, fromPin: string, to: string, toPin: string): Edge => ({
  from,
  fromPin,
  to,
  toPin
});

const LINE = { object: { units: 'number', charge: 'number' } } as const;

const lineTotalGraph: GraphDef = {
  signature: {
    execIn: [],
    execOut: [],
    inputs: [{ name: 'lines', type: { list: LINE } }],
    outputs: [{ name: 'total', type: 'number' }]
  },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('amounts', 'std.list.map', { config: { expression: 'item.units * item.charge' } }),
    node('sum', 'std.math.sum'),
    node('round', 'std.math.round', { inputs: { digits: { value: 2 } } }),
    node('return', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'lines', 'amounts', 'list'),
    edge('amounts', 'list', 'sum', 'values'),
    edge('sum', 'result', 'round', 'value'),
    edge('round', 'result', 'return', 'total')
  ]
};

const processItemGraph: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'item', type: { object: { id: 'string', lines: { list: LINE } } } }],
    outputs: [{ name: 'total', type: 'number' }]
  },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('lines', 'std.object.get', { inputs: { path: { value: 'lines' } } }),
    node('total', 'demo.line-total'),
    node('settle', 'std.flow.delay', { inputs: { ms: { value: 250 } } }),
    node('large', 'std.logic.greater', { inputs: { b: { value: 1000 } } }),
    node('branch', 'std.flow.branch'),
    node('review', 'std.human.task', {
      config: {
        title: 'Approve large item',
        queue: 'review',
        fields: [{ name: 'note', type: 'string' }],
        outcomes: ['approve']
      }
    }),
    node('done', RETURN_TYPE),
    node('approved', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'exec', 'settle', 'exec'),
    edge('settle', 'then', 'branch', 'exec'),
    edge('entry', 'item', 'lines', 'object'),
    edge('lines', 'value', 'total', 'lines'),
    edge('total', 'total', 'large', 'a'),
    edge('large', 'result', 'branch', 'condition'),
    edge('branch', 'false', 'done', 'exec'),
    edge('branch', 'true', 'review', 'exec'),
    edge('entry', 'item', 'review', 'context'),
    edge('review', 'approve', 'approved', 'exec'),
    edge('total', 'total', 'done', 'total'),
    edge('total', 'total', 'approved', 'total')
  ]
};

const processBatchGraph: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'items', type: { list: { object: {} } } }],
    outputs: [{ name: 'total', type: 'number' }]
  },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('wrap', 'std.list.map', { config: { expression: '{ item }' } }),
    node('each', 'std.flow.map-workflow', {
      config: { workflow: 'demo.process-item', version: 1 }
    }),
    node('grand', 'std.expr', { config: { expression: 'sum(map(results, r => r.total))' } }),
    node('return', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'exec', 'each', 'exec'),
    edge('entry', 'items', 'wrap', 'list'),
    edge('wrap', 'list', 'each', 'items'),
    edge('each', 'then', 'return', 'exec'),
    edge('each', 'results', 'grand', 'results'),
    edge('grand', 'result', 'return', 'total')
  ]
};

export const demoGraphs: SeedGraph[] = [
  {
    key: 'demo.line-total',
    name: 'Line Total',
    kind: 'node',
    role: 'rule',
    description: 'Sums units × charge across lines, rounded to cents.',
    version: 1,
    definition: lineTotalGraph
  },
  {
    key: 'demo.process-item',
    name: 'Process Item',
    kind: 'workflow',
    role: 'workflow',
    description: 'Totals one item and asks a reviewer to approve large ones.',
    version: 1,
    definition: processItemGraph
  },
  {
    key: 'demo.process-batch',
    name: 'Process Batch',
    kind: 'workflow',
    role: 'workflow',
    description: 'Processes every item as a parallel child run and sums the totals.',
    version: 1,
    definition: processBatchGraph
  }
];
