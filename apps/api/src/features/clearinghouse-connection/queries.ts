import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import type { ConnectionInput } from './schemas.ts';

const columns = [
  'vendor',
  'enabled',
  'sftp_host',
  'sftp_port',
  'sftp_username',
  'upload_path',
  'download_paths',
  'claim_extension',
  'eligibility_extension',
  'claim_status_extension',
  'after_download',
  'realtime_url',
  'updated_at'
] as const;

const secretSet = sql<boolean>`sftp_secret <> ''`.as('secret_set');

export const findConnection = (db: Db, agencyId: string) =>
  db
    .selectFrom('clearinghouse_connections')
    .select([...columns, secretSet])
    .where('agency_id', '=', agencyId)
    .executeTakeFirst();

const valuesOf = (c: ConnectionInput) => ({
  vendor: c.vendor,
  enabled: c.enabled,
  sftp_host: c.sftpHost,
  sftp_port: c.sftpPort,
  sftp_username: c.sftpUsername,
  upload_path: c.uploadPath,
  download_paths: c.downloadPaths,
  claim_extension: c.claimExtension,
  eligibility_extension: c.eligibilityExtension,
  claim_status_extension: c.claimStatusExtension,
  after_download: c.afterDownload,
  realtime_url: c.realtimeUrl
});

export const upsertConnection = (
  db: Db,
  agencyId: string,
  c: ConnectionInput,
  sealedSecret: string
) => {
  const values = { ...valuesOf(c), sftp_secret: sealedSecret };
  return db
    .insertInto('clearinghouse_connections')
    .values({ agency_id: agencyId, ...values })
    .onConflict((oc) => oc.column('agency_id').doUpdateSet({ ...values, updated_at: sql`now()` }))
    .returning([...columns, secretSet])
    .executeTakeFirstOrThrow();
};

export const updateConnection = (db: Db, agencyId: string, c: ConnectionInput) =>
  db
    .updateTable('clearinghouse_connections')
    .set({ ...valuesOf(c), updated_at: sql`now()` })
    .where('agency_id', '=', agencyId)
    .returning([...columns, secretSet])
    .executeTakeFirst();

export const deleteConnection = async (db: Db, agencyId: string) =>
  (
    await db
      .deleteFrom('clearinghouse_connections')
      .where('agency_id', '=', agencyId)
      .executeTakeFirst()
  ).numDeletedRows > 0n;
