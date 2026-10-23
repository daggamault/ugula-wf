import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { fieldsSchema, graphDefSchema, valueTypeSchema } from './schemas.ts';
import { clampGraph } from './std/composites.ts';

describe('schemas', () => {
  it('accepts well-formed graphs and value types', () => {
    assert.deepEqual(v.parse(graphDefSchema, clampGraph), clampGraph);
    assert.deepEqual(v.parse(valueTypeSchema, { list: { object: { a: 'string' } } }), {
      list: { object: { a: 'string' } }
    });
  });

  it('rejects malformed input', () => {
    assert.equal(v.safeParse(valueTypeSchema, 'money').success, false);
    assert.equal(v.safeParse(graphDefSchema, { ...clampGraph, extra: 1 }).success, false);
    assert.equal(
      v.safeParse(graphDefSchema, {
        ...clampGraph,
        edges: [{ from: 'a', fromPin: '1x', to: 'b', toPin: 'c' }]
      }).success,
      false
    );
    assert.equal(
      v.safeParse(fieldsSchema, [
        { name: 'a', type: 'string' },
        { name: 'a', type: 'number' }
      ]).success,
      false
    );
    const withRetry = (retry: Record<string, number>) =>
      v.safeParse(graphDefSchema, {
        ...clampGraph,
        nodes: clampGraph.nodes.map((n, i) => (i === 0 ? { ...n, retry } : n))
      }).success;
    assert.equal(withRetry({ max: 3, delayMs: 1000, factor: 2 }), true);
    assert.equal(withRetry({ max: 3, delayMs: 1e16 }), false);
    assert.equal(withRetry({ max: 1000, delayMs: 1 }), false);
    assert.equal(withRetry({ max: 3, delayMs: 1, factor: 100 }), false);
  });
});
