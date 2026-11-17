import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ssh2 from 'ssh2';
import { createMockFiles } from './files.ts';
import { createSftpHandlers } from './sftp.ts';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;

const setup = () => {
  const calls: unknown[][] = [];
  const written: string[] = [];
  const reply = {
    status: (...a: unknown[]) => calls.push(['status', ...a]),
    handle: (...a: unknown[]) => calls.push(['handle', ...a]),
    data: (...a: unknown[]) => calls.push(['data', ...a]),
    attrs: (...a: unknown[]) => calls.push(['attrs', ...a]),
    name: (...a: unknown[]) => calls.push(['name', ...a])
  };
  const fs = createMockFiles('ugula', () => 1_700_000_000, ['/upload', '/download']);
  const sftp = createSftpHandlers(reply, fs, (p) => written.push(p));
  const last = () => calls.at(-1) ?? [];
  const handleOf = () => {
    const [kind, , buf] = last();
    assert.equal(kind, 'handle');
    return buf as Buffer;
  };
  return { calls, written, fs, sftp, last, handleOf };
};

const WRITE = OPEN_MODE.WRITE | OPEN_MODE.CREAT | OPEN_MODE.TRUNC;

describe('createSftpHandlers', () => {
  it('takes an upload and reports it once the handle closes', () => {
    const { sftp, fs, written, handleOf, last } = setup();
    sftp.open(1, 'upload/B1.CLP', WRITE);
    const h = handleOf();
    sftp.write(2, h, 0, Buffer.from('ISA*'));
    sftp.write(3, h, 4, Buffer.from('00'));
    assert.deepEqual(written, []);
    sftp.close(4, h);
    assert.deepEqual(last(), ['status', 4, STATUS_CODE.OK]);
    assert.equal(fs.files.get('/upload/B1.CLP')?.data.toString(), 'ISA*00');
    assert.deepEqual(written, ['/upload/B1.CLP']);
  });

  it('keeps the upload folder write-only', () => {
    const { sftp, fs, last } = setup();
    fs.put('/upload/B1.CLP', 'x');
    sftp.open(1, '/upload/B1.CLP', OPEN_MODE.READ);
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.PERMISSION_DENIED, 'Write-only folder']);
    sftp.opendir(2, '/upload');
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.PERMISSION_DENIED, 'Write-only folder']);
  });

  it('lists and reads the download folder to the end', () => {
    const { sftp, fs, last, handleOf } = setup();
    fs.put('/download/R1.999', 'ack');
    sftp.opendir(1, '/download');
    const dir = handleOf();
    sftp.readdir(2, dir);
    const [, , names] = last();
    assert.deepEqual(
      (names as { filename: string }[]).map((n) => n.filename),
      ['.', '..', 'R1.999']
    );
    sftp.readdir(3, dir);
    assert.deepEqual(last(), ['status', 3, STATUS_CODE.EOF]);
    sftp.open(4, '/download/R1.999', OPEN_MODE.READ);
    const file = handleOf();
    sftp.read(5, file, 1, 10);
    assert.deepEqual(last(), ['data', 5, Buffer.from('ck')]);
    sftp.read(6, file, 3, 10);
    assert.deepEqual(last(), ['status', 6, STATUS_CODE.EOF]);
  });

  it('resolves paths from the root and reports their attributes', () => {
    const { sftp, fs, last, handleOf } = setup();
    sftp.realpath(1, 'download/../download/.');
    assert.deepEqual(last(), [
      'name',
      1,
      [{ filename: '/download', longname: '/download', attrs: {} }]
    ]);
    fs.put('/download/R1.999', 'ack');
    sftp.stat(2, 'download/R1.999');
    assert.deepEqual(last(), ['attrs', 2, fs.attrsOf('/download/R1.999')]);
    assert.equal(fs.attrsOf('/download/R1.999')?.size, 3);
    sftp.stat(3, '/nope');
    assert.deepEqual(last(), ['status', 3, STATUS_CODE.NO_SUCH_FILE]);
    sftp.open(4, '/download/R1.999', OPEN_MODE.READ);
    sftp.fstat(5, handleOf());
    assert.deepEqual(last(), ['attrs', 5, fs.attrsOf('/download/R1.999')]);
    sftp.fstat(6, Buffer.alloc(4, 9));
    assert.deepEqual(last(), ['status', 6, STATUS_CODE.FAILURE, 'Bad handle']);
    sftp.setstat(7);
    assert.deepEqual(last(), ['status', 7, STATUS_CODE.OK]);
  });

  it('opens only what exists unless asked to create it', () => {
    const { sftp, fs, last } = setup();
    sftp.open(1, '/download', OPEN_MODE.READ);
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.FAILURE, 'Is a directory']);
    sftp.open(2, '/download/none', OPEN_MODE.READ);
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.NO_SUCH_FILE]);
    sftp.open(3, '/download/none', OPEN_MODE.WRITE);
    assert.deepEqual(last(), ['status', 3, STATUS_CODE.NO_SUCH_FILE]);
    sftp.open(4, '/missing/A', WRITE);
    assert.deepEqual(last(), ['status', 4, STATUS_CODE.NO_SUCH_FILE]);
    fs.put('/download/A', 'a');
    sftp.open(5, '/download/A', WRITE | OPEN_MODE.EXCL);
    assert.deepEqual(last(), ['status', 5, STATUS_CODE.FAILURE, 'File exists']);
    assert.deepEqual(fs.files.get('/download/A')?.data, Buffer.from('a'));
  });

  it('appends to an existing file unless told to truncate it', () => {
    const { sftp, fs, handleOf } = setup();
    fs.put('/download/A', 'abc');
    sftp.open(1, '/download/A', OPEN_MODE.APPEND);
    sftp.write(2, handleOf(), 5, Buffer.from('de'));
    assert.deepEqual(fs.files.get('/download/A')?.data, Buffer.from('abc\0\0de'));
    sftp.open(3, '/download/A', WRITE);
    assert.deepEqual(fs.files.get('/download/A')?.data, Buffer.alloc(0));
  });

  it('refuses unknown, closed and mismatched handles', () => {
    const { sftp, fs, last, handleOf, written } = setup();
    fs.put('/download/A', 'a');
    sftp.read(1, Buffer.alloc(4), 0, 1);
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.FAILURE, 'Bad handle']);
    sftp.close(2, Buffer.alloc(2));
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.FAILURE, 'Bad handle']);
    sftp.opendir(3, '/download');
    const dir = handleOf();
    sftp.write(4, dir, 0, Buffer.from('x'));
    assert.deepEqual(last(), ['status', 4, STATUS_CODE.FAILURE, 'Bad handle']);
    sftp.open(5, '/download/A', OPEN_MODE.READ);
    const file = handleOf();
    sftp.readdir(6, file);
    assert.deepEqual(last(), ['status', 6, STATUS_CODE.FAILURE, 'Bad handle']);
    sftp.close(7, file);
    assert.deepEqual(last(), ['status', 7, STATUS_CODE.OK]);
    sftp.read(8, file, 0, 1);
    assert.deepEqual(last(), ['status', 8, STATUS_CODE.FAILURE, 'Bad handle']);
    sftp.close(9, dir);
    assert.deepEqual(last(), ['status', 9, STATUS_CODE.OK]);
    assert.deepEqual(written, []);
  });

  it('does not report a file closed without being written', () => {
    const { sftp, written, handleOf, last } = setup();
    sftp.open(1, '/upload/B1.CLP', WRITE);
    sftp.close(2, handleOf());
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.OK]);
    assert.deepEqual(written, []);
  });

  it('renames a finished upload into place and reports it', () => {
    const { sftp, fs, written, last } = setup();
    fs.put('/upload/B1.CLP.part', 'x');
    sftp.rename(1, '/upload/B1.CLP.part', '/upload/B1.CLP');
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.OK]);
    assert.deepEqual([...fs.files.keys()], ['/upload/B1.CLP']);
    assert.deepEqual(written, ['/upload/B1.CLP']);
  });

  it('renames nothing that is missing, taken or has no target folder', () => {
    const { sftp, fs, written, last } = setup();
    sftp.rename(1, '/upload/none', '/upload/B1.CLP');
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.NO_SUCH_FILE]);
    fs.put('/upload/A', 'a');
    fs.put('/upload/B', 'b');
    sftp.rename(2, '/upload/A', '/upload/B');
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.FAILURE, 'Target exists']);
    sftp.rename(3, '/upload/A', '/download');
    assert.deepEqual(last(), ['status', 3, STATUS_CODE.FAILURE, 'Target exists']);
    sftp.rename(4, '/upload/A', '/missing/A');
    assert.deepEqual(last(), ['status', 4, STATUS_CODE.NO_SUCH_FILE]);
    assert.deepEqual([...fs.files.keys()], ['/upload/A', '/upload/B']);
    assert.deepEqual(written, []);
  });

  it('makes and removes only empty folders under existing ones', () => {
    const { sftp, fs, last } = setup();
    sftp.mkdir(1, '/download/old');
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.OK]);
    assert.equal(fs.dirs.has('/download/old'), true);
    sftp.mkdir(2, '/download/old');
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.FAILURE, 'Already exists']);
    sftp.mkdir(3, '/missing/old');
    assert.deepEqual(last(), ['status', 3, STATUS_CODE.NO_SUCH_FILE]);
    sftp.opendir(4, '/missing');
    assert.deepEqual(last(), ['status', 4, STATUS_CODE.NO_SUCH_FILE]);
    sftp.rmdir(5, '/download');
    assert.deepEqual(last(), ['status', 5, STATUS_CODE.FAILURE, 'Directory not empty']);
    sftp.rmdir(6, '/download/old');
    assert.deepEqual(last(), ['status', 6, STATUS_CODE.OK]);
    assert.equal(fs.dirs.has('/download/old'), false);
    sftp.rmdir(7, '/download/old');
    assert.deepEqual(last(), ['status', 7, STATUS_CODE.NO_SUCH_FILE]);
  });

  it('removes files', () => {
    const { sftp, fs, last } = setup();
    fs.put('/download/A', 'a');
    sftp.remove(1, '/download/A');
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.OK]);
    assert.equal(fs.files.has('/download/A'), false);
    sftp.remove(2, '/download/A');
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.NO_SUCH_FILE]);
  });
});
