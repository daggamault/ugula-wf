import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toCsv } from './csv.ts';

describe('toCsv', () => {
  it('writes a header and rows, quoting commas, quotes and line breaks', () => {
    assert.equal(
      toCsv(
        ['Payer', 'Amount', 'Note'],
        [
          ['Blue, Plan', 12, 'say "hi"'],
          [null, 0, 'two\nlines']
        ]
      ),
      'Payer,Amount,Note\r\n"Blue, Plan",12,"say ""hi"""\r\n,0,"two\nlines"'
    );
  });
});
