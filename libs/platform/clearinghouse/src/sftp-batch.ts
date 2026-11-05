import { createHash } from 'node:crypto';
import SftpClient from 'ssh2-sftp-client';

export type SftpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  hostKey: string;
  uploadPath: string;
  downloadPaths: string[];
  readyTimeoutMs?: number;
  operationTimeoutMs?: number;
};

export type RemoteFile = { path: string; name: string; size: number; modifiedAt: Date };

export type SftpSession = {
  upload: (name: string, bytes: Uint8Array) => Promise<string>;
  list: () => Promise<RemoteFile[]>;
  download: (path: string) => Promise<Uint8Array>;
  remove: (path: string) => Promise<void>;
};

export type SftpBatch = {
  upload: SftpSession['upload'];
  session: <T>(work: (s: SftpSession) => Promise<T>) => Promise<T>;
};

const READY_TIMEOUT_MS = 20_000;

const OPERATION_TIMEOUT_MS = 60_000;

const KEEPALIVE_MS = 10_000;

const PARTIAL = '.part';

export const hostKeyFingerprint = (key: Buffer) =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;

const deadline = <T>(ms: number, op: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`The clearinghouse did not answer within ${ms / 1000}s`)),
      ms
    );
    op()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });

const sessionOf = (
  sftp: SftpClient,
  config: SftpConfig,
  timed: <T>(op: () => Promise<T>) => Promise<T>
): SftpSession => ({
  upload: async (name, bytes) => {
    const path = joinPath(config.uploadPath, name);
    const partial = `${path}${PARTIAL}`;
    await timed(() => sftp.put(Buffer.from(bytes), partial));
    try {
      await timed(() => sftp.rename(partial, path));
    } catch (err) {
      await timed(() => sftp.delete(partial)).catch(() => undefined);
      throw err;
    }
    return path;
  },
  list: async () => {
    const files: RemoteFile[] = [];
    for (const dir of config.downloadPaths) {
      for (const entry of await timed(() => sftp.list(dir))) {
        if (entry.type !== '-') continue;
        files.push({
          path: joinPath(dir, entry.name),
          name: entry.name,
          size: entry.size,
          modifiedAt: new Date(entry.modifyTime)
        });
      }
    }
    return files;
  },
  download: async (path) => new Uint8Array((await timed(() => sftp.get(path))) as Buffer),
  remove: async (path) => {
    await timed(() => sftp.delete(path));
  }
});

export const createSftpBatch = (config: SftpConfig): SftpBatch => {
  const ms = config.operationTimeoutMs ?? OPERATION_TIMEOUT_MS;
  const timed = <T>(op: () => Promise<T>) => deadline(ms, op);
  const session = async <T>(work: (s: SftpSession) => Promise<T>) => {
    const sftp = new SftpClient('clearinghouse');
    const seen = { hostKey: '' };
    try {
      await sftp.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: config.readyTimeoutMs ?? READY_TIMEOUT_MS,
        keepaliveInterval: KEEPALIVE_MS,
        hostVerifier: (key: Buffer) => {
          seen.hostKey = hostKeyFingerprint(key);
          return seen.hostKey === config.hostKey;
        }
      });
    } catch (err) {
      if (seen.hostKey && seen.hostKey !== config.hostKey) {
        throw new Error(
          `The SFTP server ${config.host} presented host key ${seen.hostKey}, not the pinned ${config.hostKey}`
        );
      }
      throw err;
    }
    try {
      return await work(sessionOf(sftp, config, timed));
    } finally {
      await timed(() => sftp.end()).catch(() => undefined);
    }
  };
  return { upload: (name, bytes) => session((s) => s.upload(name, bytes)), session };
};
