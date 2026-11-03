import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import ssh2, { type Attributes, type SFTPWrapper } from 'ssh2';
import {
  type ClearinghouseConfig,
  claimFileName,
  createClearinghouse,
  receiverOf
} from './clearinghouse.ts';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const MTIME = 1_793_016_000;

const DIRS = new Set(['/inbound', '/outbound/999', '/outbound/277', '/outbound/277/old']);

const files = new Map<string, Buffer>();

const sessions = { opened: 0, closed: 0 };

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
    .on('REMOVE', (id, path) =>
      sftp.status(id, files.delete(path) ? STATUS_CODE.OK : STATUS_CODE.NO_SUCH_FILE)
    );
};

const server = new Server(
  { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
  (client) => {
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
  }
);

const config = (): ClearinghouseConfig => ({
  host: '127.0.0.1',
  port: (server.address() as AddressInfo).port,
  username: 'ugula',
  password: 'secret',
  uploadPath: '/inbound/',
  downloadPaths: ['/outbound/999', '/outbound/277'],
  fileExtension: '.txt',
  afterDownload: 'delete',
  pollMinutes: 1
});

const settled = async () => {
  for (let i = 0; i < 100 && sessions.closed < sessions.opened; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return sessions.closed === sessions.opened;
};

const isa = (receiver: string, separator = '*') =>
  ['ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'CLEARING'.padEnd(15), 'ZZ']
    .concat([receiver.padEnd(15), '261103', '1200', '^', '00501', '000000001', '0', 'T', ':~'])
    .join(separator);

describe('claimFileName', () => {
  it('numbers claim files by control number and batch, with the clearinghouse extension', () => {
    assert.equal(
      claimFileName(7, '0195f2a4-0000-7000-8000-000000000001', '.CLP'),
      '837P-000000007-0195f2a4.CLP'
    );
  });
});

describe('receiverOf', () => {
  it('reads the interchange receiver with whatever element separator the file uses', () => {
    assert.equal(receiverOf(isa('DEVEMS01')), 'DEVEMS01');
    assert.equal(receiverOf(`\n${isa('DEVEMS01', '|')}GS|FA~`), 'DEVEMS01');
  });

  it('has no receiver for text that is not X12 or an interchange cut short', () => {
    assert.equal(receiverOf('not x12'), null);
    assert.equal(receiverOf(isa('DEVEMS01').slice(0, 90)), null);
    assert.equal(receiverOf(isa('')), null);
  });
});

describe('createClearinghouse', () => {
  before(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('uploads claim files into the upload folder over its own session', async () => {
    const clearinghouse = createClearinghouse(config());
    const path = await clearinghouse.upload('837P-1.txt', new TextEncoder().encode('ISA*00~'));
    assert.equal(path, '/inbound/837P-1.txt');
    assert.equal(files.get(path)?.toString(), 'ISA*00~');
    assert.ok(await settled());
  });

  it('lists the files of every download folder, skipping folders, then downloads and removes them', async () => {
    files.set('/outbound/999/a.999', Buffer.from('ack'));
    files.set('/outbound/277/b.277', Buffer.from('status'));
    const clearinghouse = createClearinghouse(config());
    assert.deepEqual(await clearinghouse.list(), [
      { path: '/outbound/999/a.999', name: 'a.999', size: 3, modifiedAt: new Date(MTIME * 1000) },
      { path: '/outbound/277/b.277', name: 'b.277', size: 6, modifiedAt: new Date(MTIME * 1000) }
    ]);
    assert.equal(
      new TextDecoder().decode(await clearinghouse.download('/outbound/277/b.277')),
      'status'
    );
    await clearinghouse.remove('/outbound/277/b.277');
    assert.equal(files.has('/outbound/277/b.277'), false);
    assert.ok(await settled());
  });

  it('closes the session when the server refuses an operation', async () => {
    const clearinghouse = createClearinghouse(config());
    await assert.rejects(() => clearinghouse.remove('/outbound/999/gone.999'));
    await assert.rejects(() => clearinghouse.download('/outbound/999/gone.999'));
    assert.ok(await settled());
  });

  it('fails to connect with the wrong password', async () => {
    const clearinghouse = createClearinghouse({ ...config(), password: 'wrong' });
    await assert.rejects(() => clearinghouse.list());
  });
});
