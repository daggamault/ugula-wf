import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dollars, toCsv } from './csv.ts';

describe('toCsv', () => {
  it('quotes only cells that need it and leaves blanks for missing values', () => {
    assert.equal(
      toCsv([
        ['Payer', 'Paid'],
        ['Blue, Inc', 'say "hi"'],
        [null, 3]
      ]),
      'Payer,Paid\r\n"Blue, Inc","say ""hi"""\r\n,3'
    );
  });

  it('writes cents as plain dollar amounts', () => {
    assert.equal(dollars(114_220), '1142.20');
    assert.equal(dollars(5), '0.05');
  });
});
