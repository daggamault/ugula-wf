import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepEqual, findKey, getPath, groupBy, isRecord, kindOf, setPath, toText } from './json.ts';

describe('json helpers', () => {
  it('classifies and compares values deeply', () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord([]), false);
    assert.deepEqual([null, [], {}, 1, 'a'].map(kindOf), [
      'null',
      'list',
      'object',
      'number',
      'string'
    ]);
    assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
    assert.equal(deepEqual({ a: 1 }, { a: 1, b: null }), false);
    assert.equal(deepEqual([1, 2], [2, 1]), false);
  });

  it('formats text and groups items', () => {
    assert.equal(toText(null), '');
    assert.equal(toText({ a: 1 }), '{"a":1}');
    assert.deepEqual(
      groupBy(['ab', 'ac', 'b'], (x) => String(x).charAt(0)),
      {
        a: ['ab', 'ac'],
        b: ['b']
      }
    );
  });

  it('finds the first value for a key anywhere in nested data', () => {
    const report = {
      ePatient: { 'ePatient.PatientNameGroup': { 'ePatient.02': 'Doe' } },
      list: [{ x: 1 }, { x: 2 }]
    };
    assert.equal(findKey(report, 'ePatient.02'), 'Doe');
    assert.equal(findKey(report, 'x'), 1);
    assert.equal(findKey(report, 'missing'), null);
  });

  it('reads and writes dotted paths immutably', () => {
    const src = { a: { list: [{ v: 1 }] } };
    assert.equal(getPath(src, 'a.list.0.v'), 1);
    assert.equal(getPath(src, 'a.nope.v'), null);
    const out = setPath(src, 'a.list.0.v', 2);
    assert.deepEqual(out, { a: { list: [{ v: 2 }] } });
    assert.deepEqual(src, { a: { list: [{ v: 1 }] } });
    assert.deepEqual(setPath(null, 'x.y', 1), { x: { y: 1 } });
    assert.deepEqual(setPath([], '2', 'c'), [null, null, 'c']);
  });
});
