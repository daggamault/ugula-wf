import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphDef } from '@ugula/graph';
import { COALESCE_MS, emptyHistory, HISTORY_LIMIT, recorded, redone, undone } from './history.ts';

const graph = (n: number): GraphDef => ({
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [{ name: `v${n}`, type: 'number', default: n }],
  nodes: [],
  edges: []
});

describe('history', () => {
  it('undoes and redoes snapshots, clearing redo on a new edit', () => {
    const h1 = recorded(emptyHistory, graph(0), 1000);
    const h2 = recorded(h1, graph(1), 5000);
    const back = undone(h2, graph(2));
    assert.ok(back);
    assert.deepEqual(back.def, graph(1));
    const forward = redone(back.history, back.def);
    assert.deepEqual(forward?.def, graph(2));
    assert.equal(recorded(back.history, graph(1), 9000).future.length, 0);
    assert.equal(undone(emptyHistory, graph(0)), null);
    assert.equal(redone(emptyHistory, graph(0)), null);
  });

  it('coalesces quick edits such as typing into one step', () => {
    const h1 = recorded(emptyHistory, graph(0), 1000);
    const h2 = recorded(h1, graph(1), 1000 + COALESCE_MS - 1);
    assert.equal(h2.past.length, 1);
    assert.equal(recorded(h2, graph(2), 1000 + 3 * COALESCE_MS).past.length, 2);
  });

  it('keeps a capped number of steps', () => {
    let h = emptyHistory;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recorded(h, graph(i), i * COALESCE_MS * 2);
    assert.equal(h.past.length, HISTORY_LIMIT);
    assert.deepEqual(h.past[0], graph(5));
  });
});
