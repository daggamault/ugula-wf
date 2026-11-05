import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMockFiles, normalizePath } from './mock-files.ts';

describe('normalizePath', () => {
  it('resolves every path from the root', () => {
    assert.equal(normalizePath(''), '/');
    assert.equal(normalizePath('upload/../download/'), '/download');
    assert.equal(normalizePath('/upload/./B1.CLP'), '/upload/B1.CLP');
  });
});

describe('createMockFiles', () => {
  const at = 1_700_000_000;

  it('starts with the root and the given folders', () => {
    const fs = createMockFiles('ugula', () => at, ['/upload']);
    assert.deepEqual([...fs.dirs.keys()], ['/', '/upload']);
    assert.equal(fs.attrsOf('/upload')?.mode, 0o040755);
    assert.equal(fs.attrsOf('/missing'), null);
  });

  it('stores files with their size and time', () => {
    const fs = createMockFiles('ugula', () => at, []);
    fs.put('/a.txt', 'hello');
    assert.deepEqual(fs.attrsOf('/a.txt'), {
      mode: 0o100644,
      uid: 0,
      gid: 0,
      size: 5,
      atime: at,
      mtime: at
    });
  });

  it('lists a folder with its direct children only, like ls -l', () => {
    const fs = createMockFiles('ugula', () => at, ['/download', '/download/old']);
    fs.put('/download/R1.999', 'ack');
    fs.put('/download/old/R0.999', 'old');
    const entries = fs.entriesOf('/download');
    assert.deepEqual(
      entries.map((e) => e.filename),
      ['.', '..', 'old', 'R1.999']
    );
    const file = entries.find((e) => e.filename === 'R1.999');
    assert.match(
      file?.longname ?? '',
      /^-rw-r--r-- 1 ugula ugula {8}3 \w{3} [ \d]\d \d\d:\d\d R1\.999$/
    );
    assert.match(entries[2]?.longname ?? '', /^drwxr-xr-x /);
  });
});
