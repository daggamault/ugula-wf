import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  fieldsSchema,
  graphDefSchema,
  jsonSchema,
  MAX_RETRY_DELAY_MS,
  optionsSchema,
  valuesSchema,
  valueTypeSchema
} from './schemas.ts';
import { clampGraph } from './std/composites.ts';

const messages = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

const parses = (schema: v.GenericSchema, input: unknown) => v.safeParse(schema, input).success;

const withFirstNode = (patch: Record<string, unknown>) => ({
  ...clampGraph,
  nodes: clampGraph.nodes.map((n, i) => (i === 0 ? { ...n, ...patch } : n))
});

const COMMENT = {
  id: 'c1',
  text: 'Pricing',
  position: { x: 0, y: 10 },
  size: { width: 300, height: 200 },
  color: 'info'
};

describe('jsonSchema', () => {
  it('accepts null, booleans, finite numbers, text, lists and records', () => {
    const value = { a: [null, true, 1.5, 'x', { b: [] }] };
    assert.deepEqual(v.parse(jsonSchema, value), value);
  });

  it('rejects non-finite numbers and values JSON cannot hold', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, () => 1]) {
      assert.equal(parses(jsonSchema, bad), false, String(bad));
    }
  });

  it('reads values as a record of JSON', () => {
    assert.deepEqual(v.parse(valuesSchema, { a: 1, b: null }), { a: 1, b: null });
    assert.equal(parses(valuesSchema, 'x'), false);
  });
});

describe('valueTypeSchema', () => {
  it('accepts scalars and nested lists of objects', () => {
    assert.deepEqual(v.parse(valueTypeSchema, { list: { object: { a: 'string' } } }), {
      list: { object: { a: 'string' } }
    });
  });

  it('accepts id and code kinds named in camelCase', () => {
    assert.deepEqual(v.parse(valueTypeSchema, { list: { id: 'claim' } }), {
      list: { id: 'claim' }
    });
    assert.deepEqual(v.parse(valueTypeSchema, { code: 'zipCode' }), { code: 'zipCode' });
    assert.equal(parses(valueTypeSchema, { code: 'Zip Code' }), false);
  });

  it('rejects unknown scalars and a type that is two kinds at once', () => {
    assert.equal(parses(valueTypeSchema, 'money'), false);
    assert.equal(parses(valueTypeSchema, { id: 'claim', code: 'hcpcs' }), false);
  });

  it('rejects object fields that are not identifiers or are reserved', () => {
    assert.equal(parses(valueTypeSchema, { object: { 'a-b': 'string' } }), false);
    assert.equal(parses(valueTypeSchema, { object: { toString: 'string' } }), false);
  });
});

describe('graphDefSchema', () => {
  it('accepts a well-formed graph', () => {
    assert.deepEqual(v.parse(graphDefSchema, clampGraph), clampGraph);
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
  });

  it('rejects unknown keys on an exit and on the graph', () => {
    const badExit = {
      ...clampGraph,
      signature: { ...clampGraph.signature, exits: { exec: { colour: 'red' } } }
    };
    assert.equal(parses(graphDefSchema, badExit), false);
    assert.equal(parses(graphDefSchema, { ...clampGraph, extra: 1 }), false);
  });

  it('accepts the pins a node shows on the canvas when they are identifiers', () => {
    const shown = { ...clampGraph, nodes: clampGraph.nodes.map((n) => ({ ...n, shown: ['a'] })) };
    assert.deepEqual(v.parse(graphDefSchema, shown), shown);
    assert.deepEqual(messages(graphDefSchema, withFirstNode({ shown: ['1x'] })), [
      'Names must be identifiers'
    ]);
  });

  it('rejects node ids that are reserved or over 64 characters and versions below 1', () => {
    assert.deepEqual(messages(graphDefSchema, withFirstNode({ id: 'constructor' })), [
      'This name is reserved'
    ]);
    assert.deepEqual(messages(graphDefSchema, withFirstNode({ id: 'x'.repeat(65) })), [
      'Invalid length: Expected <=64 but received 65'
    ]);
    assert.deepEqual(messages(graphDefSchema, withFirstNode({ version: 0 })), [
      'Invalid value: Expected >=1 but received 0'
    ]);
  });

  it('takes literal or expression node inputs, not both and not non-finite', () => {
    assert.equal(parses(graphDefSchema, withFirstNode({ inputs: { a: { expr: 'x + 1' } } })), true);
    assert.equal(
      parses(graphDefSchema, withFirstNode({ inputs: { a: { value: Number.NaN } } })),
      false
    );
    assert.equal(
      parses(graphDefSchema, withFirstNode({ inputs: { a: { value: 1, expr: '1' } } })),
      false
    );
  });

  it('bounds retries to 1..100 attempts, delays to 30 days and backoff to 1..10', () => {
    const retry = (r: Record<string, number>) =>
      parses(graphDefSchema, withFirstNode({ retry: r }));
    assert.equal(retry({ max: 3, delayMs: 1000, factor: 2 }), true);
    assert.equal(retry({ max: 100, delayMs: MAX_RETRY_DELAY_MS, factor: 10 }), true);
    assert.equal(retry({ max: 1, delayMs: 0, factor: 1 }), true);
    for (const bad of [
      { max: 101, delayMs: 1 },
      { max: 0, delayMs: 1 },
      { max: 3, delayMs: MAX_RETRY_DELAY_MS + 1 },
      { max: 3, delayMs: -1 },
      { max: 3, delayMs: 1.5 },
      { max: 3, delayMs: 1, factor: 0.5 },
      { max: 3, delayMs: 1, factor: 11 }
    ]) {
      assert.equal(retry(bad), false, JSON.stringify(bad));
    }
    assert.equal(MAX_RETRY_DELAY_MS, 2_592_000_000);
  });

  it('rejects edges between pins that are not identifiers', () => {
    assert.deepEqual(
      messages(graphDefSchema, {
        ...clampGraph,
        edges: [{ from: 'a', fromPin: '1x', to: 'b', toPin: 'c' }]
      }),
      ['Names must be identifiers']
    );
  });

  it('accepts comment boxes', () => {
    const commented = { ...clampGraph, comments: [COMMENT] };
    assert.deepEqual(v.parse(graphDefSchema, commented), commented);
  });

  it('rejects comment boxes with unknown colors, empty sizes, long text or extra keys', () => {
    for (const bad of [
      { color: 'pink' },
      { size: { width: 0, height: 1 } },
      { text: 'x'.repeat(2001) },
      { extra: 1 }
    ]) {
      const c = { ...clampGraph, comments: [{ ...COMMENT, ...bad }] };
      assert.equal(parses(graphDefSchema, c), false, JSON.stringify(bad));
    }
  });
});

describe('optionsSchema', () => {
  it('expands bare strings into labelled options and keeps labelled ones', () => {
    assert.deepEqual(v.parse(optionsSchema, ['x', { value: 'y', label: 'Why' }]), [
      { value: 'x', label: 'x' },
      { value: 'y', label: 'Why' }
    ]);
  });

  it('needs at least one option', () => {
    assert.deepEqual(messages(optionsSchema, []), ['Invalid length: Expected >=1 but received 0']);
  });
});

describe('fieldsSchema', () => {
  it('expands bare option strings into labelled options', () => {
    assert.deepEqual(v.parse(fieldsSchema, [{ name: 'a', type: 'string', options: ['x'] }]), [
      { name: 'a', type: 'string', options: [{ value: 'x', label: 'x' }] }
    ]);
  });

  it('names the code set and code list a field picks its codes from', () => {
    const field = {
      name: 'diagnoses',
      type: { list: 'string' },
      codeSet: 'icd10cm',
      codeList: 'cause-of-injury'
    };
    assert.deepEqual(v.parse(fieldsSchema, [field]), [field]);
    assert.deepEqual(messages(fieldsSchema, [{ ...field, codeSet: 'ICD 10' }]), [
      'Names must be identifiers'
    ]);
    assert.deepEqual(messages(fieldsSchema, [{ ...field, codeList: 'Impressions' }]), [
      'Code lists are kebab-case names'
    ]);
  });

  it('keeps required outcomes, date format and number bounds', () => {
    const field = { name: 'd', type: 'number', required: ['save'], min: 0, max: 5 };
    assert.deepEqual(v.parse(fieldsSchema, [field]), [field]);
    assert.equal(parses(fieldsSchema, [{ name: 'd', type: 'string', format: 'time' }]), false);
  });

  it('needs unique field names', () => {
    assert.deepEqual(
      messages(fieldsSchema, [
        { name: 'a', type: 'string' },
        { name: 'a', type: 'number' }
      ]),
      ['Field names must be unique']
    );
  });
});
