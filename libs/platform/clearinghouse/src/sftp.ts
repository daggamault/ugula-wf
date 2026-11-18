import ssh2 from 'ssh2';
import { hostKeyFingerprint } from './host-key.ts';

export type SftpAccount = {
  host: string;
  port: number;
  hostKey: string;
  username: string;
  password: string;
};

const TIMEOUT_MS = 30_000;

export const uploadFile = (account: SftpAccount, path: string, content: string) =>
  new Promise<void>((resolve, reject) => {
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
          sftp.writeFile(path, content, (writeErr) => {
            if (writeErr) return fail(writeErr);
            conn.end();
            resolve();
          });
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
