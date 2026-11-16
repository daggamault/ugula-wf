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

  it('quotes cells that span lines and keeps zeros', () => {
    assert.equal(toCsv([['line one\nline two', 0, '']]), '"line one\nline two",0,');
    assert.equal(toCsv([['a\r\nb']]), '"a\r\nb"');
    assert.equal(toCsv([]), '');
  });

  it('keeps spreadsheets from running cells as formulas, but not negative amounts', () => {
    assert.equal(
      toCsv([['=HYPERLINK("x")', '+1+1', '-2+3', '@SUM(A1)', '-25.00', -3]]),
      '"\'=HYPERLINK(""x"")",\'+1+1,\'-2+3,\'@SUM(A1),-25.00,-3'
    );
  });
});

describe('downloadCsv', () => {
  it('saves the rows as a UTF-8 CSV file', async () => {
    const saved: string[] = [];
    let blob: Blob | null = null;
    URL.createObjectURL = (b: Blob) => {
      blob = b;
      return 'blob:1';
    };
    URL.revokeObjectURL = () => undefined;
    Object.assign(globalThis, {
      document: {
        createElement: () => {
          const link = { href: '', download: '', click: () => saved.push(link.download) };
          return link;
        }
      }
    });
    downloadCsv('aging.csv', [
      ['Payer', 'Balance'],
      ['Medicare', '10.00']
    ]);
    assert.deepEqual(saved, ['aging.csv']);
    const file = blob as unknown as Blob;
    assert.equal(file.type, 'text/csv;charset=utf-8');
    assert.equal(await file.text(), 'Payer,Balance\r\nMedicare,10.00');
  });
});
