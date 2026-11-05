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
    assert.equal(roundTo(-2.5, 0), -3);
    assert.equal(roundTo(-1.005, 2), -1.01);
    assert.equal(f('round', 1.2345, 2), 1.23);
    assert.deepEqual(
      [f('abs', -2), f('ceil', 1.2), f('floor', -1.2), f('trunc', -1.7), f('pow', 2, 10)],
      [2, 2, -2, -1, 1024]
    );
    assert.equal(f('min'), null);
    assert.equal(f('avg', 1, 2), 1.5);
    assert.throws(() => f('pow', 10, 400), /pow: result is not a finite number/);
    assert.throws(() => f('min', 1, 'x'), /min: expected number, got string/);
  });

  it('handles text and conversion', () => {
    assert.equal(f('upper', 'ab'), 'AB');
    assert.equal(f('len', { a: 1, b: 2 }), 2);
    assert.equal(f('contains', 'hello', 'ell'), true);
    assert.equal(f('contains', [{ a: 1 }], { a: 1 }), true);
    assert.equal(f('replace', 'a-b-c', '-', '/'), 'a/b/c');
    assert.equal(f('padStart', 7, 3, '0'), '007');
    assert.equal(f('money', 123456789), '$1,234,567.89');
    assert.equal(f('money', -2850), '-$28.50');
    assert.throws(() => f('money', 'x'), /money: expected number/);
    assert.equal(f('join', [1, null, 'x'], ','), '1,,x');
    assert.equal(parseNumber(' 12.5 '), 12.5);
    assert.throws(() => parseNumber('abc'), /Cannot convert/);
    assert.throws(() => f('upper', 1), /upper: expected string, got number/);
    assert.equal(f('lower', 'AB'), 'ab');
    assert.equal(f('trim', ' a '), 'a');
    assert.equal(f('startsWith', 'abc', 'ab'), true);
    assert.equal(f('endsWith', 'abc', 'ab'), false);
    assert.deepEqual(f('split', 'a,b', ','), ['a', 'b']);
    assert.equal(f('substr', 'abcdef', 1, 3), 'bc');
    assert.equal(f('substr', 'abcdef', -2), 'ef');
    assert.equal(f('padEnd', 'a', 3), 'a  ');
    assert.equal(f('text', { a: 1 }), '{"a":1}');
    assert.equal(f('number', '42'), 42);
    assert.throws(() => parseNumber(''), /Cannot convert "" to a number/);
    assert.throws(() => parseNumber('1e400'), /Cannot convert/);
    assert.throws(() => f('len', 3), /len: expected string, list or object, got number/);
    assert.throws(() => f('text', () => null), /text: a function cannot be used as a value/);
  });

  it('parses and prints JSON without letting unrepresentable numbers through', () => {
    assert.deepEqual(f('parseJson', '{"a":[1,null]}'), { a: [1, null] });
    assert.equal(f('toJson', { a: [1, null] }), '{"a":[1,null]}');
    assert.throws(() => f('parseJson', '{'), /parseJson: invalid JSON/);
    assert.throws(() => f('parseJson', 1), /parseJson: expected string, got number/);
    assert.throws(() => f('parseJson', '[1, 1e400]'), /parseJson: \[1\]: not a finite number/);
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
    assert.equal(f('type', double), 'function');
  });

  it('runs lambdas over lists with each item and index', () => {
    const odd: ExprValue = (args) => (args[0] as number) % 2 === 1;
    const neg: ExprValue = (args) => -(args[0] as number);
    assert.deepEqual(f('filter', [1, 2, 3], odd), [1, 3]);
    assert.equal(f('find', [2, 3, 5], odd), 3);
    assert.equal(f('find', [2, 4], odd), null);
    assert.equal(f('some', [2, 4], odd), false);
    assert.equal(f('every', [1, 3], odd), true);
    assert.equal(f('count', [1, 2, 3], odd), 2);
    assert.equal(f('count', [1, 2, 3]), 3);
    assert.equal(
      f(
        'reduce',
        [1, 2, 3],
        (args) => (args[0] as number) + (args[1] as number) * (args[2] as number),
        0
      ),
      8
    );
    assert.deepEqual(f('sort', [2, 3, 1]), [1, 2, 3]);
    assert.deepEqual(f('sort', [2, 3, 1], neg), [3, 2, 1]);
    assert.throws(() => f('sort', [{ a: 1 }]), /sort: can only sort by numbers or strings/);
    assert.throws(() => f('map', [1], () => () => null), /map: a function cannot be used/);
  });

  it('slices, searches and reshapes lists and objects', () => {
    assert.deepEqual(f('flatten', [[1, [2]], 3]), [1, [2], 3]);
    assert.deepEqual([f('first', []), f('last', [1, 2]), f('at', [1, 2], -1)], [null, 2, 2]);
    assert.deepEqual(f('slice', [1, 2, 3], 1), [2, 3]);
    const xs = [1, 2];
    assert.deepEqual(f('reverse', xs), [2, 1]);
    assert.deepEqual(xs, [1, 2]);
    assert.deepEqual(f('concat', [1], [2, 3]), [1, 2, 3]);
    assert.throws(() => f('concat', [1], null), /concat: expected list, got null/);
    assert.equal(f('indexOf', [{ a: 1 }, { a: 2 }], { a: 2 }), 1);
    assert.equal(f('indexOf', 'abc', 'c'), 2);
    assert.deepEqual(f('range', 3), [0, 1, 2]);
    assert.deepEqual(f('range', 5, 2), []);
    assert.deepEqual(f('keys', { a: 1, b: 2 }), ['a', 'b']);
    assert.deepEqual(f('values', { a: 1, b: 2 }), [1, 2]);
    assert.equal(f('has', { a: null }, 'a'), true);
    assert.equal(f('has', {}, 'toString'), false);
    assert.deepEqual(f('merge', { a: 1, b: 1 }, { b: 2 }), { a: 1, b: 2 });
    assert.equal(f('isNull', null), true);
    assert.throws(() => f('keys', [1]), /keys: expected object, got list/);
  });

  it('handles dates in UTC', () => {
    assert.equal(f('now'), '2026-03-01T12:00:00.000Z');
    assert.equal(f('addDays', '2026-02-27', 2), '2026-03-01');
    assert.equal(f('daysBetween', '2026-01-01', '2026-03-01'), 59);
    assert.equal(f('year', '2026-03-01'), 2026);
    assert.equal(f('age', '1990-03-02'), 35);
    assert.equal(ageAt(new Date('2000-02-29'), new Date('2026-03-01')), 26);
    assert.throws(() => f('date', 'nope'), /invalid date/);
    assert.equal(f('date', '2026-03-01T23:30:00Z'), '2026-03-01');
    assert.equal(f('datetime', '2026-03-01'), '2026-03-01T00:00:00.000Z');
    assert.equal(f('addDays', '2026-03-01T06:00:00Z', -1), '2026-02-28T06:00:00.000Z');
    assert.deepEqual([f('month', '2026-03-09'), f('day', '2026-03-09')], [3, 9]);
    assert.equal(f('age', '1990-03-02', '2026-03-02'), 36);
    assert.equal(ageAt(new Date('2000-02-29'), new Date('2026-02-28')), 25);
    const clockless = { ...cx, now: undefined };
    assert.throws(() => exprFunctions.now?.([], clockless), /now: no clock available/);
    assert.throws(() => exprFunctions.age?.(['1990-01-01'], clockless), /age: no clock available/);
  });
});
