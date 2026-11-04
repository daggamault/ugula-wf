import SftpClient from 'ssh2-sftp-client';

export type ClearinghouseConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  uploadPath: string;
  downloadPaths: string[];
  fileExtension: string;
  afterDownload: 'delete' | 'keep';
  pollMinutes: number;
};

export type RemoteFile = { path: string; name: string; size: number; modifiedAt: Date };

export type Clearinghouse = {
  config: ClearinghouseConfig;
  upload: (name: string, bytes: Uint8Array) => Promise<string>;
  list: () => Promise<RemoteFile[]>;
  download: (path: string) => Promise<Uint8Array>;
  remove: (path: string) => Promise<void>;
};

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`;

export const createClearinghouse = (config: ClearinghouseConfig): Clearinghouse => {
  const session = async <T>(work: (sftp: SftpClient) => Promise<T>) => {
    const sftp = new SftpClient('clearinghouse');
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: 20_000
    });
    try {
      return await work(sftp);
    } finally {
      await sftp.end().catch(() => undefined);
    }
  };
  return {
    config,
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

export const claimFileName = (controlNumber: number, batchId: string, extension: string) =>
  `837P-${String(controlNumber).padStart(9, '0')}-${batchId.replaceAll('-', '').slice(0, 8)}${extension}`;

const ISA_LENGTH = 106;

export const receiverOf = (text: string) => {
  const start = text.indexOf('ISA');
  if (start < 0 || text.length < start + ISA_LENGTH) return null;
  const isa = text.slice(start, start + ISA_LENGTH).split(text.charAt(start + 3));
  return isa[8]?.trim() || null;
};
