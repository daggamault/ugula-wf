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

describe('recorded', () => {
  it('keeps the graph from before an edit and when it was made', () => {
    assert.deepEqual(recorded(emptyHistory, graph(0), 1000), {
      past: [graph(0)],
      future: [],
      at: 1000
    });
  });

  it('keeps edits apart once the pause after the last one is long enough', () => {
    const first = recorded(emptyHistory, graph(0), 1000);
    assert.deepEqual(recorded(first, graph(1), 1000 + COALESCE_MS).past, [graph(0), graph(1)]);
  });

  it('folds quick edits such as typing into one step', () => {
    const first = recorded(emptyHistory, graph(0), 1000);
    assert.deepEqual(recorded(first, graph(1), 1000 + COALESCE_MS - 1), {
      past: [graph(0)],
      future: [],
      at: 1000 + COALESCE_MS - 1
    });
  });

  it('clears what could be redone', () => {
    const back = undone(recorded(emptyHistory, graph(0), 1000), graph(1));
    assert.ok(back);
    assert.deepEqual(recorded(back.history, graph(0), 9000).future, []);
  });

  it('keeps only the most recent steps', () => {
    let h = emptyHistory;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recorded(h, graph(i), i * COALESCE_MS * 2);
    assert.equal(h.past.length, HISTORY_LIMIT);
    assert.deepEqual(h.past[0], graph(5));
    assert.deepEqual(h.past.at(-1), graph(HISTORY_LIMIT + 4));
  });
});

describe('undone', () => {
  it('goes back to the last graph and lets the current one be redone', () => {
    const h = recorded(recorded(emptyHistory, graph(0), 1000), graph(1), 5000);
    assert.deepEqual(undone(h, graph(2)), {
      def: graph(1),
      history: { past: [graph(0)], future: [graph(2)], at: 0 }
    });
  });

  it('has nothing to undo without a past', () => {
    assert.equal(undone(emptyHistory, graph(0)), null);
  });
});

describe('redone', () => {
  it('goes forward to the graph that was undone', () => {
    const back = undone(recorded(emptyHistory, graph(0), 1000), graph(1));
    assert.ok(back);
    assert.deepEqual(redone(back.history, back.def), {
      def: graph(1),
      history: { past: [graph(0)], future: [], at: 0 }
    });
  });

  it('has nothing to redo without a future', () => {
    assert.equal(redone(emptyHistory, graph(0)), null);
  });
});
