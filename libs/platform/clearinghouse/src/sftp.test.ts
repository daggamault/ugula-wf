import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { posix } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import ssh2 from 'ssh2';
import { hostKeyFingerprint } from './host-key.ts';
import { collectFiles, type RemoteFile, uploadFile } from './sftp.ts';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;

const keys = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });

const parsed = ssh2.utils.parseKey(keys.private);
if (parsed instanceof Error) throw parsed;

const HOST_KEY = hostKeyFingerprint(parsed.getPublicSSH());

const files = new Map<string, Buffer>();

const FILE_MODE = 0o100644;

const DIR_MODE = 0o40755;

const attrs = (mode: number, size = 0) => ({ mode, uid: 0, gid: 0, size, atime: 0, mtime: 0 });

type Handle = { path: string; dir?: boolean; listed?: boolean };

const serve = (sftp: ssh2.SFTPWrapper) => {
  const handles = new Map<string, Handle>();
  const open = (h: Handle) => {
    const id = Buffer.from(String(handles.size + 1));
    handles.set(id.toString(), h);
    return id;
  };
  const handleOf = (b: Buffer) => handles.get(b.toString());
  sftp
    .on('OPEN', (id, path, flags) => {
      if (flags & OPEN_MODE.WRITE) files.set(path, Buffer.alloc(0));
      else if (!files.has(path)) return sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
      sftp.handle(id, open({ path }));
    })
    .on('WRITE', (id, handle, offset, data) => {
      const path = handleOf(handle)?.path ?? '';
      const now = files.get(path) ?? Buffer.alloc(0);
      files.set(path, Buffer.concat([now.subarray(0, offset), data]));
      sftp.status(id, STATUS_CODE.OK);
    })
    .on('READ', (id, handle, offset, length) => {
      const data = files.get(handleOf(handle)?.path ?? '') ?? Buffer.alloc(0);
      if (offset >= data.length) return sftp.status(id, STATUS_CODE.EOF);
      sftp.data(id, data.subarray(offset, offset + length));
    })
    .on('FSTAT', (id, handle) =>
      sftp.attrs(id, attrs(FILE_MODE, files.get(handleOf(handle)?.path ?? '')?.length ?? 0))
    )
    .on('OPENDIR', (id, path) => sftp.handle(id, open({ path, dir: true })))
    .on('READDIR', (id, handle) => {
      const h = handleOf(handle);
      if (!h || h.listed) return sftp.status(id, STATUS_CODE.EOF);
      h.listed = true;
      const entries = [...files.keys()]
        .filter((p) => posix.dirname(p) === h.path)
        .map((p) => ({
          filename: posix.basename(p),
          longname: posix.basename(p),
          attrs: attrs(FILE_MODE)
        }));
      sftp.name(id, [
        ...entries,
        { filename: 'archive', longname: 'archive', attrs: attrs(DIR_MODE) }
      ]);
    })
    .on('REMOVE', (id, path) => {
      files.delete(path);
      sftp.status(id, STATUS_CODE.OK);
    })
    .on('CLOSE', (id) => sftp.status(id, STATUS_CODE.OK));
};

const server = new ssh2.Server({ hostKeys: [keys.private] }, (client) => {
  client
    .on('authentication', (ctx) =>
      ctx.method === 'password' && ctx.username === 'ugula' && ctx.password === 'secret'
        ? ctx.accept()
        : ctx.reject()
    )
    .on('ready', () =>
      client.on('session', (accept) => accept().on('sftp', (acceptSftp) => serve(acceptSftp())))
    )
    .on('error', () => undefined);
});

let port = 0;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

after(() => server.close());

beforeEach(() => files.clear());

const account = () => ({
  host: '127.0.0.1',
  port,
  hostKey: HOST_KEY,
  username: 'ugula',
  password: 'secret'
});

describe('uploadFile', () => {
  it('writes the file on a server with the pinned host key', async () => {
    await uploadFile(account(), '/upload/C000000042.CLP', 'ISA*00~');
    assert.equal(files.get('/upload/C000000042.CLP')?.toString(), 'ISA*00~');
  });

  it('refuses a server whose host key is not the one pinned', async () => {
    await assert.rejects(
      uploadFile({ ...account(), hostKey: 'SHA256:other' }, '/upload/X.CLP', 'x'),
      /did not present the host key SHA256:other/
    );
  });

  it('says when the account is refused', async () => {
    await assert.rejects(
      uploadFile({ ...account(), password: 'wrong' }, '/upload/X.CLP', 'x'),
      /authentication/i
    );
  });
});

describe('collectFiles', () => {
  it('reads every finished file in the folders, and removes each once it is kept', async () => {
    files.set('/download/B.835', Buffer.from('ISA*835~'));
    files.set('/download/A.999', Buffer.from('ISA*999~'));
    files.set('/download/C.835.part', Buffer.from('half'));
    files.set('/other/D.277', Buffer.from('ISA*277~'));
    const kept: RemoteFile[] = [];
    const count = await collectFiles(
      account(),
      ['/download', '/other'],
      async (f) => void kept.push(f),
      true
    );
    assert.equal(count, 3);
    assert.deepEqual(
      kept.map((f) => [f.name, f.path, f.content]),
      [
        ['A.999', '/download/A.999', 'ISA*999~'],
        ['B.835', '/download/B.835', 'ISA*835~'],
        ['D.277', '/other/D.277', 'ISA*277~']
      ]
    );
    assert.deepEqual([...files.keys()], ['/download/C.835.part']);
  });

  it('keeps the files on the server when asked, and removes none it could not keep', async () => {
    files.set('/download/A.999', Buffer.from('ISA*999~'));
    await collectFiles(account(), ['/download'], async () => undefined, false);
    assert.ok(files.has('/download/A.999'));
    await assert.rejects(
      collectFiles(
        account(),
        ['/download'],
        async () => {
          throw new Error('database down');
        },
        true
      ),
      /database down/
    );
    assert.ok(files.has('/download/A.999'));
  });
});
