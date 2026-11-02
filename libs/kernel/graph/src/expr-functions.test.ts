import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ageAt, type ExprValue, exprFunctions, parseNumber, roundTo } from './expr-functions.ts';

const cx = {
  call: (fn: ExprValue, args: ExprValue[]) => (typeof fn === 'function' ? fn(args) : null),
  charge: () => undefined,
  now: new Date('2026-03-01T12:00:00Z')
};

const f = (name: string, ...args: ExprValue[]) => {
  const fn = exprFunctions[name];
  if (!fn) throw new Error(`missing ${name}`);
  return fn(args, cx);
};

describe('expression functions', () => {
  it('computes math and money rounding', () => {
    assert.equal(roundTo(1.005, 2), 1.01);
    assert.equal(f('round', 2.5), 3);
    assert.equal(f('min', [3, 1, 2]), 1);
    assert.equal(f('max', 3, 9), 9);
    assert.equal(f('sum', [1, 2, 3]), 6);
    assert.equal(f('avg', []), null);
    assert.equal(f('clamp', 12, 0, 10), 10);
    assert.throws(() => f('sqrt', -1), /not a finite/);
  });

  it('handles text and conversion', () => {
    assert.equal(f('upper', 'ab'), 'AB');
    assert.equal(f('len', { a: 1, b: 2 }), 2);
    assert.equal(f('contains', 'hello', 'ell'), true);
    assert.equal(f('contains', [{ a: 1 }], { a: 1 }), true);
    assert.equal(f('replace', 'a-b-c', '-', '/'), 'a/b/c');
    assert.equal(f('padStart', 7, 3, '0'), '007');
    assert.equal(f('join', [1, null, 'x'], ','), '1,,x');
    assert.equal(parseNumber(' 12.5 '), 12.5);
    assert.throws(() => parseNumber('abc'), /Cannot convert/);
    assert.throws(() => f('upper', 1), /upper: expected string, got number/);
  });

  it('handles lists and objects', () => {
    const double: ExprValue = (args) => (args[0] as number) * 2;
    assert.deepEqual(f('map', [1, 2], double), [2, 4]);
    assert.deepEqual(f('unique', [1, 1, { a: 1 }, { a: 1 }]), [1, { a: 1 }]);
    assert.deepEqual(
      f('groupBy', [1, 2, 3], (args) => ((args[0] as number) % 2 ? 'odd' : 'even')),
      {
        odd: [1, 3],
        even: [2]
      }
    );
    assert.deepEqual(f('range', 2, 5), [2, 3, 4]);
    assert.throws(() => f('range', 1_000_000), /at most/);
    assert.equal(f('get', { a: { b: [5] } }, 'a.b.0'), 5);
    assert.equal(f('findKey', { a: [{ 'eRecord.01': 'P1' }] }, 'eRecord.01'), 'P1');
    assert.deepEqual(f('pick', { a: 1, b: 2 }, ['b', 'z']), { b: 2 });
    assert.deepEqual(f('omit', { a: 1, b: 2 }, ['a']), { b: 2 });
    assert.deepEqual(f('fromEntries', f('entries', { a: 1 })), { a: 1 });
    assert.equal(f('coalesce', null, null, 3), 3);
    assert.equal(f('type', [1]), 'list');
  });

  it('handles dates in UTC', () => {
    assert.equal(f('now'), '2026-03-01T12:00:00.000Z');
    assert.equal(f('addDays', '2026-02-27', 2), '2026-03-01');
    assert.equal(f('daysBetween', '2026-01-01', '2026-03-01'), 59);
    assert.equal(f('year', '2026-03-01'), 2026);
    assert.equal(f('age', '1990-03-02'), 35);
    assert.equal(ageAt(new Date('2000-02-29'), new Date('2026-03-01')), 26);
    assert.throws(() => f('date', 'nope'), /invalid date/);
  });
});
