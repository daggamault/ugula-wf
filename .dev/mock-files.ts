import { posix } from 'node:path';
import type { Attributes, FileEntry } from 'ssh2';

type MockFile = { data: Buffer; mtime: number };

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

const DIR_MODE = 0o040755;
const FILE_MODE = 0o100644;
const TYPE_MASK = 0o170000;
const DIR_TYPE = 0o040000;

export const normalizePath = (p: string) => posix.resolve('/', p || '.');

const longname = (owner: string, name: string, a: Attributes) => {
  const d = new Date(a.mtime * 1000);
  const when = `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const kind = (a.mode & TYPE_MASK) === DIR_TYPE ? 'drwxr-xr-x' : '-rw-r--r--';
  return `${kind} 1 ${owner} ${owner} ${String(a.size).padStart(8)} ${when} ${name}`;
};

export const createMockFiles = (owner: string, clock: () => number, folders: string[]) => {
  const dirs = new Map<string, number>(['/', ...folders].map((d) => [d, clock()]));
  const files = new Map<string, MockFile>();

  const attrsOf = (p: string): Attributes | null => {
    const file = files.get(p);
    if (file) {
      const { length: size } = file.data;
      return { mode: FILE_MODE, uid: 0, gid: 0, size, atime: file.mtime, mtime: file.mtime };
    }
    const dir = dirs.get(p);
    return dir === undefined
      ? null
      : { mode: DIR_MODE, uid: 0, gid: 0, size: 4096, atime: dir, mtime: dir };
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
      return attrs ? [{ filename, longname: longname(owner, filename, attrs), attrs }] : [];
    });
  };

  const put = (p: string, text: string) =>
    void files.set(p, { data: Buffer.from(text), mtime: clock() });

  return { dirs, files, clock, attrsOf, entriesOf, put };
};

export type MockFiles = ReturnType<typeof createMockFiles>;
