import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import ssh2, { type Attributes, type SFTPWrapper } from 'ssh2';
import { createSftpBatch, hostKeyFingerprint, type SftpConfig } from './sftp-batch.ts';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const MTIME = 1_793_016_000;

const DIRS = new Set(['/inbound', '/outbound/999', '/outbound/277', '/outbound/277/old']);

const STUCK = '/outbound/999/stuck.999';

const files = new Map<string, Buffer>();

const renames: string[][] = [];

const sessions = { opened: 0, closed: 0 };

const keys = utils.generateKeyPairSync('ed25519');

const HOST_KEY = hostKeyFingerprint(Buffer.from(keys.public.split(' ')[1] ?? '', 'base64'));

const attrsOf = (size: number, dir = false): Attributes => ({
  mode: dir ? 0o040755 : 0o100644,
  uid: 0,
  gid: 0,
  size,
  atime: MTIME,
  mtime: MTIME
});

const serve = (sftp: SFTPWrapper) => {
  const handles = new Map<number, { path: string; read: boolean }>();
  const handle = (path: string) => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(handles.size);
    handles.set(handles.size, { path, read: false });
    return buf;
  };
  const handleOf = (buf: Buffer) => handles.get(buf.readUInt32BE(0));
  sftp
    .on('OPEN', (id, path, flags) => {
      if (path === STUCK) return;
      if (flags & OPEN_MODE.WRITE) files.set(path, Buffer.alloc(0));
      if (files.has(path)) sftp.handle(id, handle(path));
      else sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
    })
    .on('WRITE', (id, buf, offset, data) => {
      const path = handleOf(buf)?.path ?? '';
      const file = files.get(path) ?? Buffer.alloc(0);
      files.set(path, Buffer.concat([file.subarray(0, offset), data]));
      sftp.status(id, STATUS_CODE.OK);
    })
    .on('READ', (id, buf, offset, length) => {
      const file = files.get(handleOf(buf)?.path ?? '') ?? Buffer.alloc(0);
      if (offset >= file.length) sftp.status(id, STATUS_CODE.EOF);
      else sftp.data(id, file.subarray(offset, offset + length));
    })
    .on('FSTAT', (id, buf) => {
      sftp.attrs(id, attrsOf(files.get(handleOf(buf)?.path ?? '')?.length ?? 0));
    })
    .on('CLOSE', (id) => sftp.status(id, STATUS_CODE.OK))
    .on('OPENDIR', (id, path) => {
      if (DIRS.has(path)) sftp.handle(id, handle(path));
      else sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
    })
    .on('READDIR', (id, buf) => {
      const h = handleOf(buf);
      if (!h || h.read) return sftp.status(id, STATUS_CODE.EOF);
      h.read = true;
      const inside = (p: string) => p.slice(0, p.lastIndexOf('/')) === h.path;
      sftp.name(id, [
        ...[...DIRS].filter(inside).map((p) => ({
          filename: p.slice(p.lastIndexOf('/') + 1),
          longname: 'drwxr-xr-x 1 u u 4096 Jan 1 00:00 old',
          attrs: attrsOf(4096, true)
        })),
        ...[...files].flatMap(([p, data]) =>
          inside(p)
            ? [
                {
                  filename: p.slice(p.lastIndexOf('/') + 1),
                  longname: `-rw-r--r-- 1 u u ${data.length} Jan 1 00:00 x`,
                  attrs: attrsOf(data.length)
                }
              ]
            : []
        )
      ]);
    })
    .on('RENAME', (id, from, to) => {
      const data = files.get(from);
      if (!data || to.endsWith('.REFUSED')) return sftp.status(id, STATUS_CODE.FAILURE);
      renames.push([from, to]);
      files.delete(from);
      files.set(to, data);
      sftp.status(id, STATUS_CODE.OK);
    })
    .on('REMOVE', (id, path) =>
      sftp.status(id, files.delete(path) ? STATUS_CODE.OK : STATUS_CODE.NO_SUCH_FILE)
    );
};

const server = new Server({ hostKeys: [keys.private] }, (client) => {
  sessions.opened++;
  client
    .on('authentication', (ctx) =>
      ctx.method === 'password' && ctx.password === 'secret' ? ctx.accept() : ctx.reject()
    )
    .on('ready', () =>
      client.on('session', (accept) => accept().on('sftp', (open) => serve(open())))
    )
    .on('close', () => sessions.closed++)
    .on('error', () => undefined);
});

const config = (): SftpConfig => ({
  host: '127.0.0.1',
  port: (server.address() as AddressInfo).port,
  username: 'ugula',
  password: 'secret',
  hostKey: HOST_KEY,
  uploadPath: '/inbound/',
  downloadPaths: ['/outbound/999', '/outbound/277'],
  readyTimeoutMs: 5000
});

const settled = async () => {
  for (let i = 0; i < 100 && sessions.closed < sessions.opened; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return sessions.closed === sessions.opened;
};

describe('createSftpBatch', () => {
  before(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    files.clear();
    renames.length = 0;
  });

  it('uploads under a partial name and renames it into place over its own session', async () => {
    const opened = sessions.opened;
    const clearinghouse = createSftpBatch(config());
    const path = await clearinghouse.upload('837P-1.CLP', new TextEncoder().encode('ISA*00~'));
    assert.equal(path, '/inbound/837P-1.CLP');
    assert.equal(files.get(path)?.toString(), 'ISA*00~');
    assert.deepEqual(renames, [['/inbound/837P-1.CLP.part', '/inbound/837P-1.CLP']]);
    assert.equal(sessions.opened, opened + 1);
    assert.ok(await settled());
  });

  it('removes the partial file when the rename fails', async () => {
    const clearinghouse = createSftpBatch(config());
    await assert.rejects(() => clearinghouse.upload('a.REFUSED', new Uint8Array([1])));
    assert.deepEqual([...files.keys()], []);
    assert.ok(await settled());
  });

  it('lists, downloads and removes files over one session, skipping folders', async () => {
    files.set('/outbound/999/a.999', Buffer.from('ack'));
    files.set('/outbound/277/b.277', Buffer.from('status'));
    const opened = sessions.opened;
    const clearinghouse = createSftpBatch(config());
    await clearinghouse.session(async (s) => {
      assert.deepEqual(await s.list(), [
        { path: '/outbound/999/a.999', name: 'a.999', size: 3, modifiedAt: new Date(MTIME * 1000) },
        { path: '/outbound/277/b.277', name: 'b.277', size: 6, modifiedAt: new Date(MTIME * 1000) }
      ]);
      assert.equal(new TextDecoder().decode(await s.download('/outbound/277/b.277')), 'status');
      await s.remove('/outbound/277/b.277');
    });
    assert.equal(files.has('/outbound/277/b.277'), false);
    assert.equal(sessions.opened, opened + 1);
    assert.ok(await settled());
  });

  it('closes the session when the server refuses an operation', async () => {
    const clearinghouse = createSftpBatch(config());
    await assert.rejects(() => clearinghouse.session((s) => s.remove('/outbound/999/gone.999')));
    await assert.rejects(() => clearinghouse.session((s) => s.download('/outbound/999/gone.999')));
    assert.ok(await settled());
  });

  it('gives up on an operation the server never answers and closes the session', async () => {
    const clearinghouse = createSftpBatch({ ...config(), operationTimeoutMs: 100 });
    await assert.rejects(
      () => clearinghouse.session((s) => s.download(STUCK)),
      /did not answer within 0.1s/
    );
    assert.ok(await settled());
  });

  it('refuses a server whose host key is not the pinned one, naming the key it saw', async () => {
    const pinned = `SHA256:${'A'.repeat(43)}`;
    const clearinghouse = createSftpBatch({ ...config(), hostKey: pinned });
    await assert.rejects(
      () => clearinghouse.session((s) => s.list()),
      (err: Error) => err.message.includes(HOST_KEY) && err.message.includes(pinned)
    );
  });

  it('fails to connect with the wrong password', async () => {
    const clearinghouse = createSftpBatch({ ...config(), password: 'wrong' });
    await assert.rejects(() => clearinghouse.session((s) => s.list()));
  });
});
