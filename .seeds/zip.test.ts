import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { zipOf } from './testing.ts';
import { unzipTexts } from './zip.ts';

const isText = (name: string) => name.endsWith('.txt');

describe('unzipTexts', () => {
  it('reads the wanted text entries in order and skips the rest', () => {
    assert.deepEqual(
      unzipTexts(zipOf({ 'Text/a.txt': 'hello', 'b.jpg': 'x', 'c.txt': 'héllo' }), isText),
      ['hello', 'héllo']
    );
    assert.deepEqual(unzipTexts(zipOf({ 'a.jpg': 'x' }), isText), []);
  });

  it('refuses files that are not zips, corrupt directories and unknown compression', () => {
    assert.throws(() => unzipTexts(Buffer.from('nope'), () => true), /Not a zip file/);
    const corrupt = zipOf({ 'a.txt': 'a' });
    corrupt.writeUInt32LE(0, corrupt.readUInt32LE(corrupt.length - 6));
    assert.throws(() => unzipTexts(corrupt, isText), /Corrupt zip directory/);
    const odd = zipOf({ 'a.txt': 'a' });
    odd.writeUInt16LE(12, odd.readUInt32LE(odd.length - 6) + 10);
    assert.throws(() => unzipTexts(odd, isText), /Unsupported zip method 12/);
  });
});
