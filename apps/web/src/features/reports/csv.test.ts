import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { downloadCsv, toCsv } from './csv.ts';

const original = {
  document: globalThis.document,
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL
};

afterEach(() => {
  Object.assign(globalThis, { document: original.document });
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    assert.equal(
      toCsv([
        ['Payer', 'Paid'],
        ['Medicare', 3]
      ]),
      'Payer,Paid\r\nMedicare,3'
    );
  });

  it('writes nothing for no rows', () => {
    assert.equal(toCsv([]), '');
  });

  it('leaves blanks for missing values and keeps zeros', () => {
    assert.equal(toCsv([[null, 0, '', 3]]), ',0,,3');
  });

  it('quotes cells with commas or quotes and doubles the quotes', () => {
    assert.equal(toCsv([['Blue, Inc', 'say "hi"']]), '"Blue, Inc","say ""hi"""');
  });

  it('quotes cells that span lines', () => {
    assert.equal(toCsv([['line one\nline two']]), '"line one\nline two"');
    assert.equal(toCsv([['a\r\nb']]), '"a\r\nb"');
  });

  it('keeps spreadsheets from running cells as formulas', () => {
    assert.equal(
      toCsv([['=HYPERLINK("x")', '+1+1', '-2+3', '@SUM(A1)']]),
      '"\'=HYPERLINK(""x"")",\'+1+1,\'-2+3,\'@SUM(A1)'
    );
  });

  it('escapes cells starting with a tab or carriage return', () => {
    assert.equal(toCsv([['\tcmd', '\r=1']]), '\'\tcmd,"\'\r=1"');
  });

  it('leaves signed numbers alone', () => {
    assert.equal(toCsv([['-25.00', '+5', -3, '-0.5']]), '-25.00,+5,-3,-0.5');
  });
});

describe('downloadCsv', () => {
  it('saves the rows as a UTF-8 CSV file and releases the URL', async () => {
    const clicked: { href: string; download: string }[] = [];
    const revoked: string[] = [];
    let blob: Blob | null = null;
    URL.createObjectURL = (b: Blob) => {
      blob = b;
      return 'blob:1';
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    Object.assign(globalThis, {
      document: {
        createElement: (tag: string) => {
          assert.equal(tag, 'a');
          const link = {
            href: '',
            download: '',
            click: () => clicked.push({ href: link.href, download: link.download })
          };
          return link;
        }
      }
    });
    downloadCsv('aging.csv', [
      ['Payer', 'Balance'],
      ['Medicare', '10.00']
    ]);
    assert.deepEqual(clicked, [{ href: 'blob:1', download: 'aging.csv' }]);
    assert.deepEqual(revoked, ['blob:1']);
    const file = blob as unknown as Blob;
    assert.equal(file.type, 'text/csv;charset=utf-8');
    assert.equal(await file.text(), 'Payer,Balance\r\nMedicare,10.00');
  });
});
