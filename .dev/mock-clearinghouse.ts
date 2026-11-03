/**
 * Dev-only mock clearinghouse: an in-memory SFTP server plus a responder.
 *
 * The app uploads 837P files to /inbound; for each one this answers like a clearinghouse
 * (see respond() in @ugula/billing/mock): a 999 to /outbound/999 and a 277CA to /outbound/277
 * straight away, an 835 to /outbound/835 after CLEARINGHOUSE_REMIT_DELAY_SECONDS, and the 837
 * is removed from /inbound. Claims whose member ID starts with REJECT are rejected in the 277CA.
 * Everything lives in memory and is lost on restart.
 */
import { timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { respond } from '@ugula/billing/mock';
import ssh2, { type Attributes, type FileEntry, type SFTPWrapper } from 'ssh2';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
};

const HOST = env('CLEARINGHOUSE_SFTP_HOST', 'localhost');
const PORT = Number(env('CLEARINGHOUSE_SFTP_PORT'));
const USERNAME = env('CLEARINGHOUSE_SFTP_USERNAME');
const PASSWORD = env('CLEARINGHOUSE_SFTP_PASSWORD');
const REMIT_DELAY_MS = Number(env('CLEARINGHOUSE_REMIT_DELAY_SECONDS', '20')) * 1000;

const INBOUND = '/inbound';
const OUTBOUND = { ack999: '/outbound/999', ack277: '/outbound/277', remit835: '/outbound/835' };
/** Like a clearinghouse polling its upload folder, uploads are picked up shortly after they land. */
const PICKUP_DELAY_MS = 2000;
/** Uploads still being written under a temporary name are left alone until renamed. */
const TEMPORARY = /\.(part|tmp|filepart)$/i;

const log = (line: string) =>
  process.stdout.write(`[mock-clearinghouse] ${new Date().toISOString()} ${line}\n`);

// In-memory filesystem

type File = { data: Buffer; mtime: number };

const dirs = new Map<string, number>();
const files = new Map<string, File>();

const now = () => Math.floor(Date.now() / 1000);

const norm = (p: string) => posix.resolve('/', p || '.');

for (const dir of ['/', '/outbound', INBOUND, ...Object.values(OUTBOUND)]) dirs.set(dir, now());

const attrsOf = (p: string): Attributes | null => {
  const file = files.get(p);
  if (file) {
    return {
      mode: 0o100644,
      uid: 0,
      gid: 0,
      size: file.data.length,
      atime: file.mtime,
      mtime: file.mtime
    };
  }
  const dir = dirs.get(p);
  return dir === undefined
    ? null
    : { mode: 0o040755, uid: 0, gid: 0, size: 4096, atime: dir, mtime: dir };
};

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

const longname = (name: string, a: Attributes) => {
  const d = new Date(a.mtime * 1000);
  const when = `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const kind = (a.mode & 0o170000) === 0o040000 ? 'drwxr-xr-x' : '-rw-r--r--';
  return `${kind} 1 ${USERNAME} ${USERNAME} ${String(a.size).padStart(8)} ${when} ${name}`;
};

const entriesOf = (dir: string): FileEntry[] => {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  const children = [...dirs.keys(), ...files.keys()].filter(
    (p) => p !== dir && p.startsWith(prefix) && !p.slice(prefix.length).includes('/')
  );
  return ['.', '..', ...children].flatMap((p) => {
    const path = p === '.' ? dir : p === '..' ? posix.dirname(dir) : p;
    const attrs = attrsOf(path);
    const filename = p.startsWith('/') ? posix.basename(p) : p;
    return attrs ? [{ filename, longname: longname(filename, attrs), attrs }] : [];
  });
};

/** Writes a whole file in one step, so a client never sees half of it. */
const put = (p: string, text: string) => files.set(p, { data: Buffer.from(text), mtime: now() });

// Responder

const baseOf = (p: string) => {
  const name = posix.basename(p);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const handleUpload = (p: string) => {
  const file = files.get(p);
  if (!file) return;
  const base = baseOf(p);
  const r = respond(file.data.toString('utf8'), new Date());
  files.delete(p);
  log(
    `picked up ${p}${r.inbound ? ` (GS06 ${r.inbound.groupControlNumber}, ${r.inbound.claims.length} claims)` : ` (unreadable: ${r.error})`}`
  );
  put(`${OUTBOUND.ack999}/${base}.999`, r.ack999);
  log(`wrote ${OUTBOUND.ack999}/${base}.999 (${r.inbound ? 'accepted' : 'rejected'})`);
  if (r.ack277) {
    put(`${OUTBOUND.ack277}/${base}.277`, r.ack277);
    log(
      `wrote ${OUTBOUND.ack277}/${base}.277 (accepted: ${r.accepted.join(', ') || 'none'}; rejected: ${r.rejected.join(', ') || 'none'})`
    );
  }
  const remit = r.remit835;
  if (remit) {
    log(`835 for ${r.accepted.join(', ')} due in ${REMIT_DELAY_MS / 1000}s`);
    setTimeout(() => {
      put(`${OUTBOUND.remit835}/${base}.835`, remit);
      log(`wrote ${OUTBOUND.remit835}/${base}.835`);
    }, REMIT_DELAY_MS);
  }
};

const isInboundUpload = (p: string) => posix.dirname(p) === INBOUND && !TEMPORARY.test(p);

const scheduleUpload = (p: string) => {
  if (isInboundUpload(p)) setTimeout(() => handleUpload(p), PICKUP_DELAY_MS);
};

// SFTP subsystem

type Handle =
  | { kind: 'file'; path: string; wrote: boolean }
  | { kind: 'dir'; path: string; read: boolean };

const serve = (sftp: SFTPWrapper) => {
  const handles = new Map<number, Handle>();
  let next = 0;
  const open = (h: Handle) => {
    const id = next++;
    handles.set(id, h);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(id);
    return buf;
  };
  const handleOf = (buf: Buffer) =>
    buf.length === 4 ? handles.get(buf.readUInt32BE(0)) : undefined;
  const ok = (id: number) => sftp.status(id, STATUS_CODE.OK);
  const missing = (id: number) => sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
  const fail = (id: number, message: string) => sftp.status(id, STATUS_CODE.FAILURE, message);

  sftp
    .on('REALPATH', (id, p) => {
      const path = norm(p);
      sftp.name(id, [{ filename: path, longname: path, attrs: {} as Attributes }]);
    })
    .on('STAT', (id, p) => {
      const attrs = attrsOf(norm(p));
      if (attrs) sftp.attrs(id, attrs);
      else missing(id);
    })
    .on('LSTAT', (id, p) => {
      const attrs = attrsOf(norm(p));
      if (attrs) sftp.attrs(id, attrs);
      else missing(id);
    })
    .on('FSTAT', (id, buf) => {
      const h = handleOf(buf);
      const attrs = h && attrsOf(h.path);
      if (attrs) sftp.attrs(id, attrs);
      else fail(id, 'Bad handle');
    })
    .on('SETSTAT', (id) => ok(id))
    .on('FSETSTAT', (id) => ok(id))
    .on('OPEN', (id, p, flags) => {
      const path = norm(p);
      if (dirs.has(path)) return fail(id, 'Is a directory');
      const exists = files.has(path);
      const writing = (flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND)) !== 0;
      if (!writing) {
        return exists ? sftp.handle(id, open({ kind: 'file', path, wrote: false })) : missing(id);
      }
      if (!dirs.has(posix.dirname(path))) return missing(id);
      if (exists && flags & OPEN_MODE.EXCL) return fail(id, 'File exists');
      if (!exists && !(flags & OPEN_MODE.CREAT)) return missing(id);
      if (!exists || flags & OPEN_MODE.TRUNC)
        files.set(path, { data: Buffer.alloc(0), mtime: now() });
      sftp.handle(id, open({ kind: 'file', path, wrote: false }));
    })
    .on('READ', (id, buf, offset, length) => {
      const h = handleOf(buf);
      const file = h?.kind === 'file' ? files.get(h.path) : undefined;
      if (!file) return fail(id, 'Bad handle');
      if (offset >= file.data.length) return sftp.status(id, STATUS_CODE.EOF);
      sftp.data(id, file.data.subarray(offset, Math.min(offset + length, file.data.length)));
    })
    .on('WRITE', (id, buf, offset, data) => {
      const h = handleOf(buf);
      const file = h?.kind === 'file' ? files.get(h.path) : undefined;
      if (h?.kind !== 'file' || !file) return fail(id, 'Bad handle');
      const end = offset + data.length;
      if (end > file.data.length) {
        const grown = Buffer.alloc(end);
        file.data.copy(grown);
        file.data = grown;
      }
      data.copy(file.data, offset);
      file.mtime = now();
      h.wrote = true;
      ok(id);
    })
    .on('CLOSE', (id, buf) => {
      const h = handleOf(buf);
      if (!h) return fail(id, 'Bad handle');
      handles.delete(buf.readUInt32BE(0));
      ok(id);
      if (h.kind === 'file' && h.wrote) scheduleUpload(h.path);
    })
    .on('OPENDIR', (id, p) => {
      const path = norm(p);
      if (dirs.has(path)) sftp.handle(id, open({ kind: 'dir', path, read: false }));
      else missing(id);
    })
    .on('READDIR', (id, buf) => {
      const h = handleOf(buf);
      if (h?.kind !== 'dir') return fail(id, 'Bad handle');
      if (h.read) return sftp.status(id, STATUS_CODE.EOF);
      h.read = true;
      sftp.name(id, entriesOf(h.path));
    })
    .on('REMOVE', (id, p) => {
      if (files.delete(norm(p))) ok(id);
      else missing(id);
    })
    .on('MKDIR', (id, p) => {
      const path = norm(p);
      if (dirs.has(path) || files.has(path)) return fail(id, 'Already exists');
      if (!dirs.has(posix.dirname(path))) return missing(id);
      dirs.set(path, now());
      ok(id);
    })
    .on('RMDIR', (id, p) => {
      const path = norm(p);
      if (!dirs.has(path)) return missing(id);
      if (entriesOf(path).length > 2) return fail(id, 'Directory not empty');
      dirs.delete(path);
      ok(id);
    })
    .on('RENAME', (id, from, to) => {
      const src = norm(from);
      const dst = norm(to);
      const file = files.get(src);
      if (!file) return missing(id);
      if (files.has(dst) || dirs.has(dst)) return fail(id, 'Target exists');
      if (!dirs.has(posix.dirname(dst))) return missing(id);
      files.delete(src);
      files.set(dst, file);
      ok(id);
      scheduleUpload(dst);
    });
};

// SSH server

const matches = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const hostKey = utils.generateKeyPairSync('ed25519').private;

new Server({ hostKeys: [hostKey] }, (client) => {
  client
    .on('authentication', (ctx) => {
      if (
        ctx.method === 'password' &&
        matches(ctx.username, USERNAME) &&
        matches(ctx.password, PASSWORD)
      ) {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    })
    .on('ready', () => {
      client.on('session', (accept) => {
        accept().on('sftp', (acceptSftp) => serve(acceptSftp()));
      });
    })
    .on('error', (e) => log(`client error: ${e.message}`));
}).listen(PORT, HOST, () => {
  log(`SFTP on ${HOST}:${PORT} as ${USERNAME}; 835s after ${REMIT_DELAY_MS / 1000}s`);
});
