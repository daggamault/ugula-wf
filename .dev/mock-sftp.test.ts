import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ssh2 from 'ssh2';
import { createMockFiles } from './mock-files.ts';
import { createSftpHandlers } from './mock-sftp.ts';

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

  it('answers missing files, bad handles and existing targets', () => {
    const { sftp, fs, last } = setup();
    sftp.stat(1, '/nope');
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.NO_SUCH_FILE]);
    sftp.read(2, Buffer.alloc(4), 0, 1);
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.FAILURE, 'Bad handle']);
    sftp.open(3, '/download', OPEN_MODE.READ);
    assert.deepEqual(last(), ['status', 3, STATUS_CODE.FAILURE, 'Is a directory']);
    fs.put('/download/A', 'a');
    sftp.open(4, '/download/A', WRITE | OPEN_MODE.EXCL);
    assert.deepEqual(last(), ['status', 4, STATUS_CODE.FAILURE, 'File exists']);
    sftp.open(5, '/missing/A', WRITE);
    assert.deepEqual(last(), ['status', 5, STATUS_CODE.NO_SUCH_FILE]);
  });

  it('renames a finished upload into place and reports it', () => {
    const { sftp, fs, written, last } = setup();
    fs.put('/upload/B1.CLP.part', 'x');
    sftp.rename(1, '/upload/B1.CLP.part', '/upload/B1.CLP');
    assert.deepEqual(last(), ['status', 1, STATUS_CODE.OK]);
    assert.ok(fs.files.has('/upload/B1.CLP') && !fs.files.has('/upload/B1.CLP.part'));
    assert.deepEqual(written, ['/upload/B1.CLP']);
  });

  it('makes and removes only empty folders', () => {
    const { sftp, fs, last } = setup();
    sftp.mkdir(1, '/download/old');
    assert.ok(fs.dirs.has('/download/old'));
    sftp.mkdir(2, '/download/old');
    assert.deepEqual(last(), ['status', 2, STATUS_CODE.FAILURE, 'Already exists']);
    sftp.rmdir(3, '/download');
    assert.deepEqual(last(), ['status', 3, STATUS_CODE.FAILURE, 'Directory not empty']);
    sftp.rmdir(4, '/download/old');
    assert.equal(fs.dirs.has('/download/old'), false);
    fs.put('/download/A', 'a');
    sftp.remove(5, '/download/A');
    assert.deepEqual(last(), ['status', 5, STATUS_CODE.OK]);
    sftp.remove(6, '/download/A');
    assert.deepEqual(last(), ['status', 6, STATUS_CODE.NO_SUCH_FILE]);
  });
});
