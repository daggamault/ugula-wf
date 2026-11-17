import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dailyNumberOf, dollarsToCents, money } from './numbers.ts';

describe('dailyNumberOf', () => {
  it('reads numbers with or without a # or dash, ignoring surrounding space', () => {
    assert.deepEqual(
      [' 20261105-0001 ', '#20261105-0042', '202611050007', '#202611050008'].map(dailyNumberOf),
      ['20261105-0001', '20261105-0042', '20261105-0007', '20261105-0008']
    );
  });

  it('accepts a sequence of four to nine digits', () => {
    assert.deepEqual(['20261105-12345', '20261105-123456789'].map(dailyNumberOf), [
      '20261105-12345',
      '20261105-123456789'
    ]);
  });

  it('rejects anything else', () => {
    assert.deepEqual(
      [
        '',
        '1001',
        '2026-11-05',
        '20261105-01',
        '20261105-1234567890',
        'PCR-1',
        '20261105 0001',
        '##20261105-0001'
      ].map(dailyNumberOf),
      [null, null, null, null, null, null, null, null]
    );
  });
});

describe('money', () => {
  it('formats cents as dollars with thousands separators', () => {
    assert.equal(money(114_220), '$1,142.20');
    assert.equal(money(123_456_789), '$1,234,567.89');
  });

  it('pads small amounts to two decimals', () => {
    assert.equal(money(5), '$0.05');
    assert.equal(money(0), '$0.00');
  });

  it('puts the minus sign before the dollar sign', () => {
    assert.equal(money(-500), '-$5.00');
    assert.equal(money(-123_456), '-$1,234.56');
  });
});

describe('dollarsToCents', () => {
  it('converts dollars as written, without floating point drift', () => {
    assert.equal(dollarsToCents('1.005'), 101);
    assert.equal(dollarsToCents(1.005), 101);
    assert.equal(dollarsToCents('0.29'), 29);
    assert.equal(dollarsToCents(1_234.56), 123_456);
  });

  it('rounds half a cent away from zero', () => {
    assert.equal(dollarsToCents('2.675'), 268);
    assert.equal(dollarsToCents('-2.675'), -268);
    assert.equal(dollarsToCents('1.234'), 123);
  });

  it('reads padded text and exponents', () => {
    assert.equal(dollarsToCents(' 12 '), 1_200);
    assert.equal(dollarsToCents('1.5e3'), 150_000);
    assert.equal(dollarsToCents(1e-7), 0);
  });

  it('gives NaN for text that is not a number', () => {
    assert.equal(dollarsToCents('abc'), Number.NaN);
  });
});
