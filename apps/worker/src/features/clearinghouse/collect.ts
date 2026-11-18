import { createHash } from 'node:crypto';
import { fileKindOf } from '@ugula/billing';
import {
  collectFiles,
  openSecret,
  type RemoteFile,
  type SecretKeyring
} from '@ugula/clearinghouse';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';
import type { SlotBoss } from '../../shared/gated-work.ts';

export const COLLECT_QUEUE = 'clearinghouse-collect';

export const collectCron = (minutes: number) => `*/${Math.min(Math.max(minutes, 1), 59)} * * * *`;

type CollectDeps = {
  db: Kysely<Database>;
  keyring: SecretKeyring | null;
  collect?: typeof collectFiles;
  report: (message: string) => void;
};

const keepFile = (db: Kysely<Database>, agencyId: string) => async (f: RemoteFile) => {
  await db
    .insertInto('clearinghouse_files')
    .values({
      agency_id: agencyId,
      kind: fileKindOf(f.content),
      file_name: f.name,
      content: f.content,
      content_hash: createHash('sha256').update(f.content).digest('hex')
    })
    .onConflict((oc) => oc.columns(['agency_id', 'content_hash']).doNothing())
    .execute();
};

export const collectClearinghouseFiles =
  ({ db, keyring, collect = collectFiles, report }: CollectDeps) =>
  async () => {
    const connections = await db
      .selectFrom('clearinghouse_connections as c')
      .innerJoin('agencies as a', 'a.id', 'c.agency_id')
      .select([
        'c.agency_id',
        'c.sftp_host',
        'c.sftp_port',
        'c.sftp_host_key',
        'c.sftp_username',
        'c.sftp_secret',
        'c.download_paths',
        'c.after_download'
      ])
      .where('c.is_active', '=', true)
      .where('a.is_active', '=', true)
      .orderBy('c.agency_id')
      .execute();
    if (connections.length && !keyring) {
      report('Clearinghouse files were not collected: the worker has no CLEARINGHOUSE_SECRET_KEY');
      return 0;
    }
    let total = 0;
    for (const c of connections) {
      try {
        total += await collect(
          {
            host: c.sftp_host,
            port: c.sftp_port,
            hostKey: c.sftp_host_key,
            username: c.sftp_username,
            password: openSecret(keyring as SecretKeyring, c.sftp_secret, c.agency_id)
          },
          c.download_paths,
          keepFile(db, c.agency_id),
          c.after_download === 'delete'
        );
      } catch (err) {
        report(`Collecting clearinghouse files for agency ${c.agency_id} failed: ${String(err)}`);
      }
    }
    return total;
  };

type CollectBoss = Pick<SlotBoss, 'work'> & {
  createQueue: (name: string) => Promise<void>;
  schedule: (name: string, cron: string) => Promise<void>;
};

export const registerCollectJob = async ({
  boss,
  minutes,
  collect
}: {
  boss: CollectBoss;
  minutes: number;
  collect: () => Promise<number>;
}) => {
  await boss.createQueue(COLLECT_QUEUE);
  await boss.schedule(COLLECT_QUEUE, collectCron(minutes));
  await boss.work(COLLECT_QUEUE, { localConcurrency: 1, batchSize: 1 }, async () => {
    await collect();
  });
};
