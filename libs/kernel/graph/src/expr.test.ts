import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateExpr, freeIdentifiers, parseExpr } from './expr.ts';

const ev = (src: string, vars = {}) =>
  evaluateExpr(src, vars, { now: new Date('2026-03-01T00:00:00Z') });

describe('expressions', () => {
  it('evaluates arithmetic with precedence, unary, and ternaries', () => {
    assert.equal(ev('1 + 2 * 3 - -4 / 2'), 9);
    assert.equal(ev('(1 + 2) * 3 % 4'), 1);
    assert.equal(ev('a > 1 ? "big" : a == 1 ? "one" : "small"', { a: 1 }), 'one');
    assert.equal(ev('!a && b || c', { a: false, b: true, c: false }), true);
    assert.equal(ev('x ?? 5', { x: null }), 5);
    assert.equal(ev('"n=" + 2 + true'), 'n=2true');
    assert.equal(ev('1.5e2 + .5'), 150.5);
  });

  it('reads members safely and builds literals', () => {
    const vars = { claim: { lines: [{ code: 'A0427', units: 2 }] } };
    assert.equal(ev('claim.lines[0].code', vars), 'A0427');
    assert.equal(ev('claim.missing', vars), null);
    assert.equal(ev('claim.missing?.deep', vars), null);
    assert.equal(ev('claim.missing?.deep.deeper[0].code', vars), null);
    assert.equal(ev('claim?.lines[0].code', vars), 'A0427');
    assert.equal(ev('claim.constructor', vars), null);
    assert.deepEqual(ev('{ a: 1, "b c": [x, 2], x }', { x: 3 }), { a: 1, 'b c': [3, 2], x: 3 });
    assert.equal(ev("'it\\'s\\n'"), "it's\n");
    assert.throws(() => ev('claim.missing.deep', vars), /Cannot read "deep" of null/);
  });

  it('supports lambdas through list functions', () => {
    const lines = [
      { code: 'A', amount: 10 },
      { code: 'B', amount: 0 },
      { code: 'C', amount: 5 }
    ];
    assert.deepEqual(ev('map(filter(lines, l => l.amount > 0), l => l.code)', { lines }), [
      'A',
      'C'
    ]);
    assert.equal(ev('reduce(lines, (acc, l) => acc + l.amount, 0)', { lines }), 15);
    assert.deepEqual(ev('map(sort(lines, l => l.amount), (l, i) => i + l.code)', { lines }), [
      '0B',
      '1C',
      '2A'
    ]);
  });

  it('rejects unsafe or invalid expressions', () => {
    assert.throws(() => parseExpr('process.exit()'), /Unexpected "\("/);
    assert.throws(() => parseExpr('eval("1")'), /Unknown function "eval"/);
    assert.throws(() => parseExpr('1 +'), /Unexpected end/);
    assert.throws(() => parseExpr('"open'), /Unterminated string/);
    assert.throws(() => parseExpr('a # b'), /Unexpected "#"/);
    assert.throws(() => ev('missing'), /Unknown name "missing"/);
    assert.throws(() => ev('1 / 0'), /Division by zero/);
    assert.throws(() => ev('"a" - 1'), /needs numbers/);
    assert.throws(() => ev('x => x'), /function cannot be used/);
    assert.throws(
      () => evaluateExpr('map(range(1000), i => i)', {}, { maxOps: 100 }),
      /evaluation budget/
    );
  });

  it('never produces numbers that JSON cannot hold', () => {
    assert.throws(() => evaluateExpr('1e400', {}), /too large/);
    assert.throws(() => evaluateExpr('round(1.5, 400)', {}), /not a finite number/);
    assert.throws(() => evaluateExpr('sum([1e308, 1e308])', {}), /not a finite number/);
  });

  it('charges the work functions and string building do to the same budget', () => {
    const over = (src: string) =>
      assert.throws(() => evaluateExpr(src, { s: 'ab' }), /evaluation budget/);
    over('len(map(range(1000), i => range(100000)))');
    over('padStart("", 400000000)');
    over('replace(padStart("", 50000), "", padStart("", 50000))');
    over('reduce(range(40), (acc, i) => acc + acc, s)');
    assert.equal(evaluateExpr('len(unique(map(range(20000), i => i % 7)))', {}), 7);
    assert.equal(evaluateExpr('len(padStart("", 1000))', {}), 1000);
  });

  it('lists free identifiers excluding lambda params and functions', () => {
    assert.deepEqual(freeIdentifiers('map(items, x => x.price * qty) + tax'), [
      'items',
      'qty',
      'tax'
    ]);
    assert.deepEqual(freeIdentifiers('a.b + c["d"]'), ['a', 'c']);
  });
});
