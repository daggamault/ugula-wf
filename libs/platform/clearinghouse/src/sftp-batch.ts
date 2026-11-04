import SftpClient from 'ssh2-sftp-client';

export type SftpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  uploadPath: string;
  downloadPaths: string[];
  readyTimeoutMs?: number;
};

export type RemoteFile = { path: string; name: string; size: number; modifiedAt: Date };

export type SftpBatch = {
  upload: (name: string, bytes: Uint8Array) => Promise<string>;
  list: () => Promise<RemoteFile[]>;
  download: (path: string) => Promise<Uint8Array>;
  remove: (path: string) => Promise<void>;
};

const READY_TIMEOUT_MS = 20_000;

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;

export const createSftpBatch = (config: SftpConfig): SftpBatch => {
  const session = async <T>(work: (sftp: SftpClient) => Promise<T>) => {
    const sftp = new SftpClient('clearinghouse');
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: config.readyTimeoutMs ?? READY_TIMEOUT_MS
    });
    try {
      return await work(sftp);
    } finally {
      await sftp.end().catch(() => undefined);
    }
  };
  return {
    upload: (name, bytes) =>
      session(async (sftp) => {
        const path = joinPath(config.uploadPath, name);
        await sftp.put(Buffer.from(bytes), path);
        return path;
      }),
    list: () =>
      session(async (sftp) => {
        const files: RemoteFile[] = [];
        for (const dir of config.downloadPaths) {
          for (const entry of await sftp.list(dir)) {
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
      }),
    download: (path) => session(async (sftp) => new Uint8Array((await sftp.get(path)) as Buffer)),
    remove: (path) =>
      session(async (sftp) => {
        await sftp.delete(path);
      })
  };
};
