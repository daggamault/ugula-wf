import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, type RunState } from '@ugula/graph';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { testNodes } from '../../shared/testing.ts';
import type { RunDetail, RunStep, RunSummary } from './client.ts';
import {
  cursorsOf,
  graphAt,
  parseAt,
  pathOf,
  runPath,
  runsStartedBy,
  statusAt
} from './inspect.ts';

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
  scopes: { s1: { path: '' }, s2: { path: 'sub/' }, s3: { path: 'sub/inner/' } },
  suspension: { id: '9', kind: 'task', data: null, cursor: cursor('s2', 'review'), retry: false },
  fault: null
} as unknown as RunState;

const faulted = {
  ...state,
  fault: { cursor: cursor('s1', 'post'), error: { message: 'boom' } }
} as unknown as RunState;

describe('graphAt', () => {
  const catalog = createCatalog(testNodes, {
    graphs: [{ type: 'acme.child', version: 1, definition: child }]
  });

  it('returns the root graph when nothing is opened', () => {
    assert.equal(graphAt(root, [], catalog), root);
  });

  it('opens the graph behind a composite node', () => {
    assert.equal(graphAt(root, ['sub'], catalog), child);
  });

  it('finds nothing for unknown nodes or nodes that are not graphs', () => {
    assert.equal(graphAt(root, ['missing'], catalog), undefined);
    assert.equal(graphAt(root, ['entry'], catalog), undefined);
    assert.equal(graphAt(root, ['missing', 'sub'], catalog), undefined);
  });
});

describe('cursorsOf', () => {
  it('has no cursors without a run state', () => {
    assert.deepEqual(cursorsOf(null), []);
  });

  it('marks the node a suspended run waits on', () => {
    assert.deepEqual(cursorsOf(state), [{ path: 'sub/', node: 'review', status: 'waiting' }]);
  });

  it('marks the faulted node as an error after the node it waits on', () => {
    assert.deepEqual(cursorsOf(faulted), [
      { path: 'sub/', node: 'review', status: 'waiting' },
      { path: '', node: 'post', status: 'error' }
    ]);
  });

  it('drops cursors whose scope is gone', () => {
    assert.deepEqual(cursorsOf({ ...faulted, scopes: {} } as RunState), []);
  });
});

describe('statusAt', () => {
  it('marks nodes run at this path as done or failed, keeping the latest step', () => {
    const steps = [step('', 'a'), step('', 'b', true), step('', 'b'), step('', 'c', true)];
    assert.deepEqual(statusAt(steps, null, ''), { a: 'done', b: 'done', c: 'error' });
  });

  it('ignores steps from other paths', () => {
    assert.deepEqual(statusAt([step('sub/', 'x'), step('', 'a')], null, 'sub/'), { x: 'done' });
  });

  it('bubbles a wait inside a composite up to the composite node', () => {
    const deep = {
      ...state,
      suspension: { ...state.suspension, cursor: cursor('s3', 'review') }
    } as RunState;
    assert.deepEqual(statusAt([step('', 'sub')], deep, ''), { sub: 'waiting' });
    assert.deepEqual(statusAt([], deep, 'sub/'), { inner: 'waiting' });
    assert.deepEqual(statusAt([], deep, 'sub/inner/'), { review: 'waiting' });
  });

  it('lets cursors override the recorded steps', () => {
    assert.deepEqual(statusAt([step('sub/', 'review'), step('sub/', 'x', true)], state, 'sub/'), {
      review: 'waiting',
      x: 'error'
    });
    assert.deepEqual(statusAt([], faulted, ''), { sub: 'waiting', post: 'error' });
  });

  it('ignores cursors outside the opened path', () => {
    assert.deepEqual(statusAt([], faulted, 'other/'), {});
  });
});

describe('runsStartedBy', () => {
  const summary = (id: string, wait: string | null) =>
    ({ id, name: 'Child', status: 'running', parent_index: 0, parent_wait: wait }) as RunSummary;
  const children = [summary('c1', '9'), summary('c2', '3'), summary('c3', '9')];
  const detail = { run: { state }, children } as unknown as RunDetail;

  it('lists the run a node recorded, even when it is not a known child', () => {
    const done = { ...step('', 'start'), outputs: { runId: 'd1' } };
    assert.deepEqual(runsStartedBy(detail, [done], '', 'start'), [{ id: 'd1' }]);
  });

  it('lists the known children a node recorded, skipping ids that are not text', () => {
    const mapped = { ...step('', 'each'), outputs: { runIds: ['c2', 7], runId: 3 } };
    assert.deepEqual(runsStartedBy(detail, [mapped], '', 'each'), [children[1]]);
  });

  it('ignores runs recorded by the same node at another path', () => {
    const elsewhere = { ...step('sub/', 'each'), outputs: { runId: 'c2' } };
    assert.deepEqual(runsStartedBy(detail, [elsewhere], '', 'each'), []);
  });

  it('lists the children the node waits on', () => {
    assert.deepEqual(runsStartedBy(detail, [], 'sub/', 'review'), [children[0], children[2]]);
  });

  it('lists a run once when it is both recorded and waited on', () => {
    const recorded = { ...step('sub/', 'review'), outputs: { runIds: ['c3', 'c3'] } };
    assert.deepEqual(runsStartedBy(detail, [recorded], 'sub/', 'review'), [
      children[2],
      children[0]
    ]);
  });

  it('lists nothing for the same node id waited on at another path', () => {
    assert.deepEqual(runsStartedBy(detail, [], '', 'review'), []);
  });
});

describe('run paths', () => {
  it('joins opened sub-graphs into a step path', () => {
    assert.equal(pathOf([]), '');
    assert.equal(pathOf(['sub', 'inner']), 'sub/inner/');
  });

  it('links to a run with the opened sub-graphs', () => {
    assert.equal(runPath('r1'), '/runs/r1');
    assert.equal(runPath('r1', ['payers', 'each']), '/runs/r1?at=payers/each');
  });

  it('reads the opened sub-graphs back, skipping empty segments', () => {
    assert.deepEqual(parseAt(null), []);
    assert.deepEqual(parseAt(''), []);
    assert.deepEqual(parseAt('/payers//each/'), ['payers', 'each']);
  });

  it('keeps node ids intact through the query string', () => {
    const href = runPath('r1', ['each payer', 'a&b']);
    assert.equal(href, '/runs/r1?at=each%20payer/a%26b');
    assert.deepEqual(parseAt(new URL(href, 'http://x').searchParams.get('at')), [
      'each payer',
      'a&b'
    ]);
  });
});
