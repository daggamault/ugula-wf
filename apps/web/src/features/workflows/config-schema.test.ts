import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jsonSchema, optionsSchema, valueTypeSchema } from '@ugula/graph';
import * as v from 'valibot';
import { asValueType, blankOf, recordOf, shapeOf, singular, withEntry } from './config-schema.ts';

describe('shapeOf', () => {
  it('reads scalars, choices, bounds and defaults from a settings schema', () => {
    const shape = shapeOf(
      v.object({
        title: v.pipe(v.string(), v.nonEmpty()),
        count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(32)), 2),
        ratio: v.number(),
        startClosed: v.optional(v.boolean(), false),
        method: v.optional(v.picklist(['GET', 'POST']), 'GET'),
        mode: v.union([v.literal('a'), v.literal('b')]),
        prefill: v.optional(v.picklist(['current']))
      })
    );
    assert.equal(shape.kind, 'object');
    const entries = shape.kind === 'object' ? shape.entries : [];
    assert.deepEqual(
      entries.map((e) => [e.name, e.shape, e.isOptional, e.fallback]),
      [
        ['title', { kind: 'text' }, false, undefined],
        ['count', { kind: 'number', isInteger: true, min: 1, max: 32 }, true, 2],
        ['ratio', { kind: 'number', isInteger: false }, false, undefined],
        ['startClosed', { kind: 'boolean' }, true, false],
        ['method', { kind: 'choice', options: ['GET', 'POST'] }, true, 'GET'],
        ['mode', { kind: 'choice', options: ['a', 'b'] }, false, undefined],
        ['prefill', { kind: 'choice', options: ['current'] }, true, undefined]
      ]
    );
  });

  it('reads lists, nested records and the shared value, type and choice schemas', () => {
    assert.deepEqual(shapeOf(v.pipe(v.array(v.string()), v.minLength(1))), {
      kind: 'list',
      item: { kind: 'text' }
    });
    assert.deepEqual(shapeOf(v.optional(valueTypeSchema, 'any')), { kind: 'type' });
    assert.deepEqual(shapeOf(v.optional(jsonSchema)), { kind: 'value' });
    assert.deepEqual(shapeOf(v.exactOptional(optionsSchema)), { kind: 'options' });
    const nested = shapeOf(
      v.array(v.strictObject({ name: v.string(), from: v.exactOptional(v.string()) }))
    );
    assert.equal(nested.kind === 'list' && nested.item.kind, 'object');
  });

  it('falls back to JSON for shapes it has no form for', () => {
    assert.deepEqual(shapeOf(v.record(v.string(), v.string())), { kind: 'json' });
    assert.deepEqual(shapeOf(v.union([v.string(), v.number()])), { kind: 'json' });
  });
});

describe('blankOf', () => {
  it('starts new rows with a value of the right shape', () => {
    assert.equal(blankOf({ kind: 'text' }), '');
    assert.equal(blankOf({ kind: 'number', isInteger: true, min: 1 }), 1);
    assert.equal(blankOf({ kind: 'choice', options: ['a'] }), 'a');
    assert.equal(blankOf({ kind: 'type' }), 'string');
    assert.equal(blankOf({ kind: 'value' }), null);
    assert.deepEqual(
      blankOf({
        kind: 'object',
        entries: [
          { name: 'name', shape: { kind: 'text' }, isOptional: false, fallback: undefined },
          { name: 'from', shape: { kind: 'text' }, isOptional: true, fallback: undefined }
        ]
      }),
      { name: '' }
    );
  });
});

describe('settings records', () => {
  it('reads settings as a record and sets or drops one entry', () => {
    assert.deepEqual(recordOf(undefined), {});
    assert.deepEqual(recordOf([1]), {});
    assert.deepEqual(withEntry({ a: 1, b: 2 }, 'a', undefined), { b: 2 });
    assert.deepEqual(withEntry({ a: 1 }, 'b', 'x'), { a: 1, b: 'x' });
    assert.equal(singular('Cases'), 'Case');
    assert.equal(singular('Address'), 'Address');
    assert.deepEqual(asValueType({ list: 'string' }), { list: 'string' });
    assert.equal(asValueType(3), 'any');
  });
});
