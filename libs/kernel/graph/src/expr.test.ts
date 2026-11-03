import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEvaluator, evaluateExpr, exprProblem, freeIdentifiers, parseExpr } from './expr.ts';

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
    assert.equal(ev('a?.5:1', { a: true }), 0.5);
    assert.equal(ev('1 + a ? 2 : 3', { a: -1 }), 3);
    assert.equal(ev('"b" > "a" && 2 >= 2 && 1 != 2'), true);
    assert.equal(ev('[1, { a: 2 }] == [1, { a: 2 }]'), true);
    assert.equal(ev('-x.n', { x: { n: 2 } }), -2);
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
    assert.equal(ev('claim.lines[5]', vars), null);
    assert.throws(() => ev('claim.lines.code', vars), /Cannot read "code" of list/);
    assert.throws(() => ev('claim["lines"][0][0]', vars), /Cannot read "0" of object/);
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
    assert.equal(ev('map([1, 2], x => map([10], y => x * y + k)[0])[1]', { k: 1 }), 21);
    assert.equal(ev('map([1], () => 7)[0]'), 7);
    assert.equal(ev('map([1], (x) => x)[0]'), 1);
  });

  it('rejects unsafe or invalid expressions', () => {
    assert.throws(() => parseExpr('process.exit()'), /Unexpected "\("/);
    assert.throws(() => parseExpr('eval("1")'), /Unknown function "eval"/);
    assert.throws(() => parseExpr('1 +'), /Unexpected end/);
    assert.throws(() => parseExpr('"open'), /Unterminated string/);
    assert.throws(() => parseExpr('a # b'), /Unexpected "#"/);
    assert.equal(ev('"\\u00e9"'), 'é');
    assert.throws(() => parseExpr('"\\u12"'), /Invalid unicode escape at 1/);
    assert.throws(() => parseExpr('"\\uzzzz"'), /Invalid unicode escape/);
    assert.throws(() => ev('missing'), /Unknown name "missing"/);
    assert.throws(() => ev('1 / 0'), /Division by zero/);
    assert.throws(() => ev('"a" - 1'), /needs numbers/);
    assert.throws(() => ev('x => x'), /function cannot be used/);
    assert.throws(() => ev('-"a"'), /Unary "-" needs a number/);
    assert.throws(() => ev('1 < "2"'), /needs two numbers or two strings/);
    assert.throws(() => ev('5 % 0'), /Division by zero/);
    assert.throws(() => ev('constructor'), /Unknown name "constructor"/);
    assert.throws(() => parseExpr('[1, 2'), /Expected "," at 5/);
    assert.throws(() => parseExpr('(1'), /Expected "\)" at 2/);
    assert.throws(() => parseExpr('1 2'), /Unexpected "2" at 2/);
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

  it('shares one budget across every call of an evaluator', () => {
    const run = createEvaluator({ maxOps: 50 });
    for (let i = 0; i < 5; i++) run('1 + 2', {});
    assert.throws(() => {
      for (let i = 0; i < 50; i++) run('1 + 2', {});
    }, /evaluation budget/);
  });

  it('keeps recently used parses when the cache is full', () => {
    const hot = parseExpr('hot + 1');
    const cold = parseExpr('cold + 1');
    for (let i = 0; i < 3000; i++) {
      parseExpr(`x + ${i}`);
      assert.equal(parseExpr('hot + 1'), hot);
    }
    assert.notEqual(parseExpr('cold + 1'), cold);
  });

  it('lists free identifiers excluding lambda params and functions', () => {
    assert.deepEqual(freeIdentifiers('map(items, x => x.price * qty) + tax'), [
      'items',
      'qty',
      'tax'
    ]);
    assert.deepEqual(freeIdentifiers('a.b + c["d"]'), ['a', 'c']);
    assert.deepEqual(freeIdentifiers('{ x, y: 1 }'), ['x']);
  });

  it('describes why an expression cannot run', () => {
    assert.equal(exprProblem('len(items) > 0'), null);
    assert.equal(exprProblem('nope(1)'), 'Unknown function "nope"');
    assert.equal(exprProblem('1 +'), 'Unexpected end of expression');
  });
});
