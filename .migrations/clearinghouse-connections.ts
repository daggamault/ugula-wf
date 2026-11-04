import { AFTER_DOWNLOAD, CLEARINGHOUSE_VENDORS, FILE_EXTENSION_PATTERN } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const list = (values: readonly string[]) => sql.join(values.map((v) => sql.lit(v)));

const extension = (column: string) => sql`${sql.ref(column)} ~ ${sql.lit(FILE_EXTENSION_PATTERN)}`;

export const createClearinghouseConnectionsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('clearinghouse_connections')
    .addColumn('agency_id', 'uuid', (col) =>
      col.primaryKey().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('vendor', 'text', (col) => col.notNull())
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('sftp_host', 'text', (col) => col.notNull())
    .addColumn('sftp_port', 'integer', (col) => col.notNull())
    .addColumn('sftp_username', 'text', (col) => col.notNull())
    .addColumn('sftp_secret', 'text', (col) => col.notNull())
    .addColumn('upload_path', 'text', (col) => col.notNull())
    .addColumn('download_paths', sql`text[]`, (col) => col.notNull())
    .addColumn('claim_extension', 'text', (col) => col.notNull())
    .addColumn('eligibility_extension', 'text', (col) => col.notNull())
    .addColumn('claim_status_extension', 'text', (col) => col.notNull())
    .addColumn('after_download', 'text', (col) => col.notNull())
    .addColumn('realtime_url', 'text')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'clearinghouse_connections_vendor_check',
      sql`vendor in (${list(CLEARINGHOUSE_VENDORS)})`
    )
    .addCheckConstraint(
      'clearinghouse_connections_sftp_check',
      sql`sftp_host <> '' and sftp_username <> '' and sftp_secret <> '' and sftp_port between 1 and 65535`
    )
    .addCheckConstraint(
      'clearinghouse_connections_paths_check',
      sql`upload_path ~ '^/' and cardinality(download_paths) between 1 and 10`
    )
    .addCheckConstraint(
      'clearinghouse_connections_extensions_check',
      sql`${extension('claim_extension')} and ${extension('eligibility_extension')} and ${extension('claim_status_extension')}`
    )
    .addCheckConstraint(
      'clearinghouse_connections_after_download_check',
      sql`after_download in (${list(AFTER_DOWNLOAD)})`
    )
    .addCheckConstraint(
      'clearinghouse_connections_realtime_url_check',
      sql`realtime_url ~ '^https?://'`
    )
    .execute();
