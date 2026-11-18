import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import ssh2 from 'ssh2';
import { hostKeyFingerprint } from './host-key.ts';
import { uploadFile } from './sftp.ts';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;

const keys = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });

const parsed = ssh2.utils.parseKey(keys.private);
if (parsed instanceof Error) throw parsed;

const HOST_KEY = hostKeyFingerprint(parsed.getPublicSSH());

const files = new Map<string, Buffer>();

const server = new ssh2.Server({ hostKeys: [keys.private] }, (client) => {
  client
    .on('authentication', (ctx) =>
      ctx.method === 'password' && ctx.username === 'ugula' && ctx.password === 'secret'
        ? ctx.accept()
        : ctx.reject()
    )
    .on('ready', () =>
      client.on('session', (accept) =>
        accept().on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const open = new Map<string, string>();
          sftp
            .on('OPEN', (id, path, flags) => {
              if (!(flags & OPEN_MODE.WRITE)) return sftp.status(id, STATUS_CODE.FAILURE);
              const handle = Buffer.from(String(open.size));
              open.set(handle.toString(), path);
              files.set(path, Buffer.alloc(0));
              sftp.handle(id, handle);
            })
            .on('WRITE', (id, handle, offset, data) => {
              const path = open.get(handle.toString()) ?? '';
              const now = files.get(path) ?? Buffer.alloc(0);
              files.set(path, Buffer.concat([now.subarray(0, offset), data]));
              sftp.status(id, STATUS_CODE.OK);
            })
            .on('FSTAT', (id) =>
              sftp.attrs(id, { mode: 0o644, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 })
            )
            .on('CLOSE', (id) => sftp.status(id, STATUS_CODE.OK));
        })
      )
    )
    .on('error', () => undefined);
});

let port = 0;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

after(() => server.close());

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
