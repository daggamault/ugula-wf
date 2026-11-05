import { PAYER_FILE_KINDS, PAYER_FILE_OUTCOMES } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const list = (values: readonly string[]) => sql.join(values.map((v) => sql.lit(v)));

const buildPayerFilesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('payer_files')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('file_name', 'text', (col) => col.notNull())
    .addColumn('digest', 'text', (col) => col.notNull())
    .addColumn('document', 'jsonb', (col) => col.notNull())
    .addColumn('control_number', 'text')
    .addColumn('item_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('problem_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('uploaded_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.references('workflow_runs.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('source_key', 'text')
    .addColumn('envelope_rejection', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('payer_files_agency_id_digest_unique', ['agency_id', 'digest'])
    .addCheckConstraint('payer_files_kind_check', sql`kind in (${list(PAYER_FILE_KINDS)})`)
    .addCheckConstraint('payer_files_file_name_check', sql`file_name <> ''`)
    .addCheckConstraint(
      'payer_files_counts_check',
      sql`item_count >= 0 and problem_count between 0 and item_count`
    );

const buildPayerFileItemsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('payer_file_items')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('file_id', 'uuid', (col) =>
      col.notNull().references('payer_files.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('reference', 'text', (col) => col.notNull())
    .addColumn('claim_id', 'uuid', (col) =>
      col.references('claims.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('outcome', 'text', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('paid_cents', 'integer')
    .addColumn('adjusted_cents', 'integer')
    .addUniqueConstraint('payer_file_items_file_id_position_unique', ['file_id', 'position'])
    .addCheckConstraint('payer_file_items_position_check', sql`position >= 1`)
    .addCheckConstraint(
      'payer_file_items_outcome_check',
      sql`outcome in (${list(PAYER_FILE_OUTCOMES)})`
    );

const buildClearinghouseDownloadsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('clearinghouse_downloads')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('remote_path', 'text', (col) => col.notNull())
    .addColumn('size', 'integer', (col) => col.notNull())
    .addColumn('modified_at', 'timestamptz', (col) => col.notNull())
    .addColumn('agency_id', 'uuid', (col) =>
      col.references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.references('workflow_runs.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('note', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('tried_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('clearinghouse_downloads_file_unique', [
      'source',
      'remote_path',
      'size',
      'modified_at'
    ]);

const buildPayerFilesIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_payer_files_agency_created')
    .on('payer_files')
    .columns(['agency_id', 'created_at desc']),
  db.schema.createIndex('idx_payer_files_uploaded_by').on('payer_files').column('uploaded_by'),
  db.schema.createIndex('idx_payer_files_run').on('payer_files').column('run_id'),
  db.schema.createIndex('idx_payer_file_items_claim').on('payer_file_items').column('claim_id')
];

export const createPayerFilesTables = async (db: Kysely<Database>) => {
  await buildPayerFilesTable(db).execute();
  await buildPayerFileItemsTable(db).execute();
  await buildClearinghouseDownloadsTable(db).execute();
  for (const index of buildPayerFilesIndexes(db)) await index.execute();
};
