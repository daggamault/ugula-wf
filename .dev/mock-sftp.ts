import { posix } from 'node:path';
import ssh2, { type Attributes, type FileEntry } from 'ssh2';
import { type MockFiles, normalizePath } from './mock-files.ts';
import { UPLOAD } from './mock-uploads.ts';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;

type SftpReply = {
  status: (id: number, code: number, message?: string) => unknown;
  handle: (id: number, handle: Buffer) => unknown;
  data: (id: number, data: Buffer) => unknown;
  attrs: (id: number, attrs: Attributes) => unknown;
  name: (id: number, names: FileEntry[]) => unknown;
};

type Handle =
  | { kind: 'file'; path: string; wrote: boolean }
  | { kind: 'dir'; path: string; read: boolean };

export const createSftpHandlers = (
  reply: SftpReply,
  fs: MockFiles,
  onWritten: (path: string) => void
) => {
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
  const ok = (id: number) => reply.status(id, STATUS_CODE.OK);
  const missing = (id: number) => reply.status(id, STATUS_CODE.NO_SUCH_FILE);
  const denied = (id: number) =>
    reply.status(id, STATUS_CODE.PERMISSION_DENIED, 'Write-only folder');
  const fail = (id: number, message: string) => reply.status(id, STATUS_CODE.FAILURE, message);
  const fileOf = (buf: Buffer) => {
    const h = handleOf(buf);
    return h?.kind === 'file' ? { h, file: fs.files.get(h.path) } : undefined;
  };

  return {
    realpath: (id: number, p: string) => {
      const path = normalizePath(p);
      reply.name(id, [{ filename: path, longname: path, attrs: {} as Attributes }]);
    },
    stat: (id: number, p: string) => {
      const attrs = fs.attrsOf(normalizePath(p));
      if (attrs) reply.attrs(id, attrs);
      else missing(id);
    },
    fstat: (id: number, buf: Buffer) => {
      const h = handleOf(buf);
      const attrs = h && fs.attrsOf(h.path);
      if (attrs) reply.attrs(id, attrs);
      else fail(id, 'Bad handle');
    },
    setstat: (id: number) => ok(id),
    open: (id: number, p: string, flags: number) => {
      const path = normalizePath(p);
      if (fs.dirs.has(path)) return fail(id, 'Is a directory');
      const exists = fs.files.has(path);
      const writing = (flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND)) !== 0;
      if (!writing) {
        if (posix.dirname(path) === UPLOAD) return denied(id);
        return exists ? reply.handle(id, open({ kind: 'file', path, wrote: false })) : missing(id);
      }
      if (!fs.dirs.has(posix.dirname(path))) return missing(id);
      if (exists && flags & OPEN_MODE.EXCL) return fail(id, 'File exists');
      if (!exists && !(flags & OPEN_MODE.CREAT)) return missing(id);
      if (!exists || flags & OPEN_MODE.TRUNC) {
        fs.files.set(path, { data: Buffer.alloc(0), mtime: fs.clock() });
      }
      reply.handle(id, open({ kind: 'file', path, wrote: false }));
    },
    read: (id: number, buf: Buffer, offset: number, length: number) => {
      const file = fileOf(buf)?.file;
      if (!file) return fail(id, 'Bad handle');
      if (offset >= file.data.length) return reply.status(id, STATUS_CODE.EOF);
      reply.data(id, file.data.subarray(offset, Math.min(offset + length, file.data.length)));
    },
    write: (id: number, buf: Buffer, offset: number, data: Buffer) => {
      const found = fileOf(buf);
      if (!found?.file) return fail(id, 'Bad handle');
      const { h, file } = found;
      const end = offset + data.length;
      if (end > file.data.length) {
        const grown = Buffer.alloc(end);
        file.data.copy(grown);
        file.data = grown;
      }
      data.copy(file.data, offset);
      file.mtime = fs.clock();
      h.wrote = true;
      ok(id);
    },
    close: (id: number, buf: Buffer) => {
      const h = handleOf(buf);
      if (!h) return fail(id, 'Bad handle');
      handles.delete(buf.readUInt32BE(0));
      ok(id);
      if (h.kind === 'file' && h.wrote) onWritten(h.path);
    },
    opendir: (id: number, p: string) => {
      const path = normalizePath(p);
      if (path === UPLOAD) return denied(id);
      if (fs.dirs.has(path)) reply.handle(id, open({ kind: 'dir', path, read: false }));
      else missing(id);
    },
    readdir: (id: number, buf: Buffer) => {
      const h = handleOf(buf);
      if (h?.kind !== 'dir') return fail(id, 'Bad handle');
      if (h.read) return reply.status(id, STATUS_CODE.EOF);
      h.read = true;
      reply.name(id, fs.entriesOf(h.path));
    },
    remove: (id: number, p: string) => {
      if (fs.files.delete(normalizePath(p))) ok(id);
      else missing(id);
    },
    mkdir: (id: number, p: string) => {
      const path = normalizePath(p);
      if (fs.dirs.has(path) || fs.files.has(path)) return fail(id, 'Already exists');
      if (!fs.dirs.has(posix.dirname(path))) return missing(id);
      fs.dirs.set(path, fs.clock());
      ok(id);
    },
    rmdir: (id: number, p: string) => {
      const path = normalizePath(p);
      if (!fs.dirs.has(path)) return missing(id);
      if (fs.entriesOf(path).length > 2) return fail(id, 'Directory not empty');
      fs.dirs.delete(path);
      ok(id);
    },
    rename: (id: number, from: string, to: string) => {
      const src = normalizePath(from);
      const dst = normalizePath(to);
      const file = fs.files.get(src);
      if (!file) return missing(id);
      if (fs.files.has(dst) || fs.dirs.has(dst)) return fail(id, 'Target exists');
      if (!fs.dirs.has(posix.dirname(dst))) return missing(id);
      fs.files.delete(src);
      fs.files.set(dst, file);
      ok(id);
      onWritten(dst);
    }
  };
};
