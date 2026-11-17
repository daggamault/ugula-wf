import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deepEqual,
  findKey,
  getPath,
  groupBy,
  isRecord,
  isTruthy,
  kindOf,
  setPath,
  toText
} from './json.ts';

describe('isRecord', () => {
  it('is true only for plain objects', () => {
    assert.deepEqual([{}, [], null, 'a', 1].map(isRecord), [true, false, false, false, false]);
  });
});

describe('kindOf', () => {
  it('names nulls, lists, objects and scalars', () => {
    assert.deepEqual([null, [], {}, 1, 'a', true].map(kindOf), [
      'null',
      'list',
      'object',
      'number',
      'string',
      'boolean'
    ]);
  });
});

describe('isTruthy', () => {
  it('treats null, false, zero and empty text as false and everything else as true', () => {
    assert.deepEqual([null, false, 0, '', [], {}, 'x', -1, true].map(isTruthy), [
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true
    ]);
  });
});

describe('deepEqual', () => {
  it('compares nested lists and objects by value', () => {
    assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
    assert.equal(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  });

  it('tells apart extra keys, other keys, list order and lengths', () => {
    assert.equal(deepEqual({ a: 1 }, { a: 1, b: null }), false);
    assert.equal(deepEqual({ a: null }, { b: null }), false);
    assert.equal(deepEqual([1, 2], [2, 1]), false);
    assert.equal(deepEqual([1], [1, null]), false);
  });

  it('tells apart lists from objects and scalars of other types', () => {
    assert.equal(deepEqual([], {}), false);
    assert.equal(deepEqual(1, '1'), false);
    assert.equal(deepEqual(null, null), true);
  });
});

describe('toText', () => {
  it('writes null as empty, text as itself, objects as JSON and scalars as strings', () => {
    assert.deepEqual([null, 'x', { a: 1 }, [1], true, 1.5].map(toText), [
      '',
      'x',
      '{"a":1}',
      '[1]',
      'true',
      '1.5'
    ]);
  });
});

describe('groupBy', () => {
  it('groups items by the text of their key in first-seen order', () => {
    assert.deepEqual(
      groupBy(['ab', 'ac', 'b'], (x) => String(x).charAt(0)),
      { a: ['ab', 'ac'], b: ['b'] }
    );
  });

  it('passes each item its index', () => {
    assert.deepEqual(
      groupBy(['x', 'y', 'z'], (_, i) => i % 2 === 0),
      { true: ['x', 'z'], false: ['y'] }
    );
  });

  it('groups null keys under empty text', () => {
    assert.deepEqual(
      groupBy([1, 2], () => null),
      { '': [1, 2] }
    );
  });
});

describe('findKey', () => {
  const report = {
    ePatient: { 'ePatient.PatientNameGroup': { 'ePatient.02': 'Doe' } },
    list: [{ x: 1 }, { x: 2 }]
  };

  it('finds the first value for a key anywhere in nested data', () => {
    assert.equal(findKey(report, 'ePatient.02'), 'Doe');
    assert.equal(findKey(report, 'x'), 1);
  });

  it('skips null matches for a later value', () => {
    assert.equal(findKey([{ k: null }, { k: 2 }], 'k'), 2);
  });

  it('finds nothing for missing or inherited keys', () => {
    assert.equal(findKey(report, 'missing'), null);
    assert.equal(findKey(report, 'toString'), null);
    assert.equal(findKey('text', 'length'), null);
  });
});

describe('getPath', () => {
  const src = { a: { list: [{ v: 1 }] } };

  it('reads object keys and list indexes along a dotted path', () => {
    assert.equal(getPath(src, 'a.list.0.v'), 1);
  });

  it('returns the value itself for an empty path', () => {
    assert.equal(getPath(src, ''), src);
  });

  it('returns null for missing keys, non-numeric indexes and inherited keys', () => {
    assert.equal(getPath(src, 'a.nope.v'), null);
    assert.equal(getPath(src, 'a.list.x'), null);
    assert.equal(getPath(src, 'a.list.5'), null);
    assert.equal(getPath(src, 'a.toString'), null);
  });
});

describe('setPath', () => {
  it('writes a dotted path without changing the original', () => {
    const src = { a: { list: [{ v: 1 }] } };
    assert.deepEqual(setPath(src, 'a.list.0.v', 2), { a: { list: [{ v: 2 }] } });
    assert.deepEqual(src, { a: { list: [{ v: 1 }] } });
  });

  it('replaces the whole value for an empty path', () => {
    assert.deepEqual(setPath({ a: 1 }, '', 2), 2);
  });

  it('creates objects along a missing path and over scalars', () => {
    assert.deepEqual(setPath(null, 'x.y', 1), { x: { y: 1 } });
    assert.deepEqual(setPath({ a: 1 }, 'a.b', 2), { a: { b: 2 } });
  });

  it('turns a list into an object for a non-numeric key', () => {
    assert.deepEqual(setPath({ a: [1] }, 'a.x', 2), { a: { x: 2 } });
  });

  it('fills the gaps with nulls when writing past the end of a list', () => {
    assert.deepEqual(setPath([], '2', 'c'), [null, null, 'c']);
  });
});
