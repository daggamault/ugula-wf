import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { zipOf } from './testing.ts';

describe('zipOf', () => {
  it('ends with a directory record that counts and locates every entry', () => {
    const zip = zipOf({ 'a.txt': 'a', 'b.txt': 'b' });
    const end = zip.length - 22;
    assert.equal(zip.readUInt32LE(end), 0x06054b50);
    assert.equal(zip.readUInt16LE(end + 10), 2);
    assert.equal(zip.readUInt32LE(zip.readUInt32LE(end + 16)), 0x02014b50);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
  });
});
