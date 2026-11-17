import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jsonSchema, optionsSchema, valueTypeSchema } from '@ugula/graph';
import * as v from 'valibot';
import {
  asValueType,
  blankOf,
  type FormEntry,
  recordOf,
  shapeOf,
  singular,
  withEntry
} from './config-schema.ts';

const entriesOf = (schema: unknown): FormEntry[] => {
  const shape = shapeOf(schema);
  assert.equal(shape.kind, 'object');
  return shape.kind === 'object' ? shape.entries : [];
};

describe('shapeOf', () => {
  it('reads scalars, choices, bounds and defaults from a settings schema', () => {
    const entries = entriesOf(
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

  it('reads a bound that sits inside a nested pipe', () => {
    assert.deepEqual(shapeOf(v.pipe(v.pipe(v.number(), v.minValue(0)), v.maxValue(9))), {
      kind: 'number',
      isInteger: false,
      min: 0,
      max: 9
    });
  });

  it('treats every kind of optional wrapper as optional', () => {
    const entries = entriesOf(
      v.looseObject({
        a: v.exactOptional(v.string()),
        b: v.nullish(v.string()),
        c: v.undefinedable(v.string(), 'x')
      })
    );
    assert.deepEqual(
      entries.map((e) => [e.name, e.shape, e.isOptional, e.fallback]),
      [
        ['a', { kind: 'text' }, true, undefined],
        ['b', { kind: 'text' }, true, undefined],
        ['c', { kind: 'text' }, true, 'x']
      ]
    );
  });

  it('reads lists of scalars and of nested records', () => {
    assert.deepEqual(shapeOf(v.pipe(v.array(v.string()), v.minLength(1))), {
      kind: 'list',
      item: { kind: 'text' }
    });
    assert.deepEqual(
      shapeOf(v.array(v.strictObject({ name: v.string(), from: v.exactOptional(v.string()) }))),
      {
        kind: 'list',
        item: {
          kind: 'object',
          entries: [
            { name: 'name', shape: { kind: 'text' }, isOptional: false, fallback: undefined },
            { name: 'from', shape: { kind: 'text' }, isOptional: true, fallback: undefined }
          ]
        }
      }
    );
  });

  it('recognizes the shared value, type and choice schemas, even when optional', () => {
    assert.deepEqual(shapeOf(valueTypeSchema), { kind: 'type' });
    assert.deepEqual(shapeOf(v.optional(valueTypeSchema, 'any')), { kind: 'type' });
    assert.deepEqual(shapeOf(v.optional(jsonSchema)), { kind: 'value' });
    assert.deepEqual(shapeOf(v.exactOptional(optionsSchema)), { kind: 'options' });
  });

  it('falls back to JSON for shapes it has no form for', () => {
    assert.deepEqual(shapeOf(v.record(v.string(), v.string())), { kind: 'json' });
    assert.deepEqual(shapeOf(v.union([v.string(), v.number()])), { kind: 'json' });
    assert.deepEqual(shapeOf(v.union([v.literal('a'), v.literal(1)])), { kind: 'json' });
    assert.deepEqual(shapeOf(v.picklist([1, 2])), { kind: 'json' });
    assert.deepEqual(shapeOf(v.date()), { kind: 'json' });
  });
});

describe('blankOf', () => {
  it('starts scalars at their empty value or lower bound', () => {
    assert.equal(blankOf({ kind: 'text' }), '');
    assert.equal(blankOf({ kind: 'number', isInteger: true, min: 1 }), 1);
    assert.equal(blankOf({ kind: 'number', isInteger: false }), 0);
    assert.equal(blankOf({ kind: 'boolean' }), false);
    assert.equal(blankOf({ kind: 'type' }), 'string');
    assert.equal(blankOf({ kind: 'value' }), null);
    assert.equal(blankOf({ kind: 'json' }), null);
  });

  it('starts a choice at its first option, or empty when there are none', () => {
    assert.equal(blankOf({ kind: 'choice', options: ['a', 'b'] }), 'a');
    assert.equal(blankOf({ kind: 'choice', options: [] }), '');
  });

  it('starts lists and choice lists empty', () => {
    assert.deepEqual(blankOf({ kind: 'list', item: { kind: 'text' } }), []);
    assert.deepEqual(blankOf({ kind: 'options' }), []);
  });

  it('starts a record with only its required entries', () => {
    assert.deepEqual(
      blankOf({
        kind: 'object',
        entries: [
          { name: 'name', shape: { kind: 'text' }, isOptional: false, fallback: undefined },
          { name: 'from', shape: { kind: 'text' }, isOptional: true, fallback: undefined },
          {
            name: 'size',
            shape: { kind: 'number', isInteger: true, min: 2 },
            isOptional: false,
            fallback: undefined
          }
        ]
      }),
      { name: '', size: 2 }
    );
  });
});

describe('recordOf', () => {
  it('reads settings as a record, or as empty when they are not one', () => {
    assert.deepEqual(recordOf({ a: 1 }), { a: 1 });
    assert.deepEqual(recordOf(undefined), {});
    assert.deepEqual(recordOf(null), {});
    assert.deepEqual(recordOf([1]), {});
    assert.deepEqual(recordOf('x'), {});
  });
});

describe('withEntry', () => {
  it('sets or replaces one entry without changing the original', () => {
    const before = { a: 1, b: 2 };
    assert.deepEqual(withEntry(before, 'c', 'x'), { a: 1, b: 2, c: 'x' });
    assert.deepEqual(withEntry(before, 'a', 3), { b: 2, a: 3 });
    assert.deepEqual(before, { a: 1, b: 2 });
  });

  it('drops the entry when the value is undefined', () => {
    assert.deepEqual(withEntry({ a: 1, b: 2 }, 'a', undefined), { b: 2 });
    assert.deepEqual(withEntry({ a: 1 }, 'z', undefined), { a: 1 });
  });
});

describe('singular', () => {
  it('drops a trailing s but keeps words ending in ss', () => {
    assert.equal(singular('Cases'), 'Case');
    assert.equal(singular('Address'), 'Address');
    assert.equal(singular('Header'), 'Header');
  });
});

describe('asValueType', () => {
  it('keeps named and structured types and falls back to any', () => {
    assert.equal(asValueType('number'), 'number');
    assert.deepEqual(asValueType({ list: 'string' }), { list: 'string' });
    assert.equal(asValueType(3), 'any');
    assert.equal(asValueType(undefined), 'any');
    assert.equal(asValueType(null), 'any');
  });
});
