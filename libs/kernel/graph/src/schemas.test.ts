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

  it('accepts pin descriptions, exit docs and node notes', () => {
    const documented = {
      ...clampGraph,
      signature: {
        ...clampGraph.signature,
        inputs: clampGraph.signature.inputs.map((p) => ({ ...p, description: 'Value to clamp' })),
        exits: { exec: { label: 'Done', description: 'Clamped' } }
      },
      nodes: clampGraph.nodes.map((n) => ({ ...n, note: 'Why this is here' }))
    };
    assert.deepEqual(v.parse(graphDefSchema, documented), documented);
    const badExit = {
      ...clampGraph,
      signature: { ...clampGraph.signature, exits: { exec: { colour: 'red' } } }
    };
    assert.equal(v.safeParse(graphDefSchema, badExit).success, false);
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
    const withNode = (patch: Record<string, unknown>) =>
      v.safeParse(graphDefSchema, {
        ...clampGraph,
        nodes: clampGraph.nodes.map((n, i) => (i === 0 ? { ...n, ...patch } : n))
      }).success;
    assert.equal(withNode({ id: 'constructor' }), false);
    assert.equal(withNode({ id: 'x'.repeat(65) }), false);
    assert.equal(withNode({ version: 0 }), false);
    assert.equal(withNode({ inputs: { a: { value: Number.NaN } } }), false);
    assert.equal(withNode({ inputs: { a: { value: 1, expr: '1' } } }), false);
    assert.equal(v.safeParse(valueTypeSchema, { object: { toString: 'string' } }).success, false);
    assert.equal(v.safeParse(valueTypeSchema, { object: { 'a-b': 'string' } }).success, false);
  });

  it('expands bare option strings into labelled options', () => {
    assert.deepEqual(v.parse(fieldsSchema, [{ name: 'a', type: 'string', options: ['x'] }]), [
      { name: 'a', type: 'string', options: [{ value: 'x', label: 'x' }] }
    ]);
    assert.equal(
      v.safeParse(fieldsSchema, [{ name: 'a', type: 'string', options: [] }]).success,
      false
    );
  });
});
