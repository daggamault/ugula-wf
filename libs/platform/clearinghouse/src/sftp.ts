import { posix } from 'node:path';
import ssh2 from 'ssh2';
import { hostKeyFingerprint } from './host-key.ts';

export type SftpAccount = {
  host: string;
  port: number;
  hostKey: string;
  username: string;
  password: string;
};

export type RemoteFile = { name: string; path: string; content: string };

type Sftp = ssh2.SFTPWrapper;

const TIMEOUT_MS = 30_000;

const PARTIAL = /\.(part|tmp|filepart)$/i;

const withSftp = <T>(account: SftpAccount, work: (sftp: Sftp) => Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    const conn = new ssh2.Client();
    let hostKeyMatched = false;
    const fail = (err: Error) => {
      conn.end();
      reject(
        hostKeyMatched
          ? err
          : new Error(
              `The SFTP server ${account.host} did not present the host key ${account.hostKey}`,
              { cause: err }
            )
      );
    };
    conn
      .on('ready', () =>
        conn.sftp((err, sftp) => {
          if (err) return fail(err);
          work(sftp).then((value) => {
            conn.end();
            resolve(value);
          }, fail);
        })
      )
      .on('error', fail)
      .connect({
        host: account.host,
        port: account.port,
        username: account.username,
        password: account.password,
        readyTimeout: TIMEOUT_MS,
        hostVerifier: (key: Buffer) => {
          hostKeyMatched = hostKeyFingerprint(key) === account.hostKey;
          return hostKeyMatched;
        }
      });
  });

const done =
  <T>(resolve: (value: T) => void, reject: (err: Error) => void) =>
  (err: Error | null | undefined, value: T) =>
    err ? reject(err) : resolve(value);

const listFiles = (sftp: Sftp, dir: string) =>
  new Promise<string[]>((resolve, reject) =>
    sftp.readdir(dir, (err, list) =>
      err
        ? reject(err)
        : resolve(
            list
              .filter((e) => !e.attrs.isDirectory() && !PARTIAL.test(e.filename))
              .map((e) => e.filename)
              .sort()
          )
    )
  );

const readFile = (sftp: Sftp, path: string) =>
  new Promise<Buffer>((resolve, reject) => sftp.readFile(path, done(resolve, reject)));

const removeFile = (sftp: Sftp, path: string) =>
  new Promise<void>((resolve, reject) =>
    sftp.unlink(path, (err) => (err ? reject(err) : resolve()))
  );

export const uploadFile = (account: SftpAccount, path: string, content: string) =>
  withSftp(
    account,
    (sftp) =>
      new Promise<void>((resolve, reject) =>
        sftp.writeFile(path, content, (err) => (err ? reject(err) : resolve()))
      )
  );

export const collectFiles = (
  account: SftpAccount,
  dirs: readonly string[],
  keep: (file: RemoteFile) => Promise<void>,
  remove: boolean
) =>
  withSftp(account, async (sftp) => {
    let count = 0;
    for (const dir of dirs) {
      for (const name of await listFiles(sftp, dir)) {
        const path = posix.join(dir, name);
        await keep({ name, path, content: (await readFile(sftp, path)).toString('latin1') });
        if (remove) await removeFile(sftp, path);
        count += 1;
      }
    }
    return count;
  });
