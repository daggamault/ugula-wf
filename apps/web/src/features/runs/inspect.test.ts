import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, type RunState } from '@ugula/graph';
import { createCatalog } from '../../shared/graph/catalog.ts';
import type { RunStep } from './client.ts';
import { cursorsOf, graphAt, pathOf, statusAt } from './inspect.ts';

const child: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const root: GraphDef = {
  ...child,
  nodes: [...child.nodes, { id: 'sub', type: 'acme.child', version: 1 }]
};

const step = (path: string, node: string, error = false): RunStep => ({
  seq: 1,
  path,
  node,
  node_type: 'x',
  event: 'exec',
  inputs: {},
  outputs: {},
  pin: null,
  error: error ? { message: 'boom', path, node } : null,
  started_at: '2026-01-01T00:00:00Z',
  duration_ms: 1
});

const cursor = (scope: string, node: string) => ({
  scope,
  node,
  event: { type: 'exec' as const, pin: 'exec' }
});

const state = {
  status: 'suspended',
  scopes: { s1: { path: '' }, s2: { path: 'sub/' } },
  suspension: { id: '9', kind: 'task', data: null, cursor: cursor('s2', 'review'), retry: false },
  fault: null
} as unknown as RunState;

describe('run inspection', () => {
  it('builds drill-down paths and resolves nested graphs', () => {
    const catalog = createCatalog({
      graphs: [{ type: 'acme.child', version: 1, definition: child }]
    });
    assert.equal(pathOf(['sub', 'inner']), 'sub/inner/');
    assert.equal(graphAt(root, [], catalog), root);
    assert.equal(graphAt(root, ['sub'], catalog), child);
    assert.equal(graphAt(root, ['missing'], catalog), undefined);
  });

  it('marks executed, failed and waiting nodes, bubbling waits up to their composite', () => {
    assert.deepEqual(cursorsOf(state), [{ path: 'sub/', node: 'review', status: 'waiting' }]);
    const steps = [step('', 'a'), step('', 'b', true), step('', 'b'), step('sub/', 'x', true)];
    assert.deepEqual(statusAt(steps, state, ''), { a: 'done', b: 'done', sub: 'waiting' });
    assert.deepEqual(statusAt(steps, state, 'sub/'), { x: 'error', review: 'waiting' });
    assert.deepEqual(cursorsOf(null), []);
  });
});
