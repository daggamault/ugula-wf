import { type Database, IMPORT_SOURCES, REPORT_OUTCOMES } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { agencySetNullForeignKey } from './foreign-keys.ts';
import { dailyNumberCheck, dailyNumberTrigger } from './numbers.ts';

const buildImportsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('imports')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('run_id', 'uuid', (col) => col.unique())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('file_name', 'text', (col) => col.notNull())
    .addColumn('file', 'jsonb', (col) => col.notNull())
    .addColumn('report_count', 'integer')
    .addColumn('uploaded_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'imports_run_id_fkey',
      ['agency_id', 'run_id'],
      'workflow_runs',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('set null').onUpdate('cascade')
    )
    .addUniqueConstraint('imports_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint(
      'imports_source_check',
      sql`source in (${sql.join(IMPORT_SOURCES.map((s) => sql.lit(s)))})`
    )
    .addCheckConstraint('imports_file_name_check', sql`file_name <> ''`)
    .addCheckConstraint('imports_report_count_check', sql`report_count >= 0`);

const buildImportReportsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('import_reports')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('import_id', 'uuid', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('number', 'text', (col) => col.notNull())
    .addColumn('pcr_number', 'text')
    .addColumn('report', 'jsonb', (col) => col.notNull())
    .addColumn('report_key', 'text', (col) => col.notNull())
    .addColumn('encounter_id', 'uuid')
    .addColumn('outcome', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'import_reports_import_id_fkey',
      ['agency_id', 'import_id'],
      'imports',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint('import_reports_agency_id_id_unique', ['agency_id', 'id'])
    .addUniqueConstraint('import_reports_import_id_position_unique', ['import_id', 'position'])
    .addUniqueConstraint('import_reports_agency_id_report_key_unique', ['agency_id', 'report_key'])
    .addCheckConstraint('import_reports_report_key_check', sql`report_key = report ->> 'key'`)
    .addCheckConstraint('import_reports_position_check', sql`position >= 0`)
    .addCheckConstraint('import_reports_number_check', dailyNumberCheck)
    .addCheckConstraint(
      'import_reports_outcome_check',
      sql`outcome in (${sql.join(REPORT_OUTCOMES.map((o) => sql.lit(o)))})`
    );

const buildImportsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_imports_agency_created')
    .on('imports')
    .columns(['agency_id', 'created_at desc']),
  db.schema.createIndex('idx_imports_uploaded_by_id').on('imports').column('uploaded_by_id'),
  db.schema
    .createIndex('idx_import_reports_encounter_id')
    .on('import_reports')
    .column('encounter_id')
];

export const linkImportReportsToEncounters = (db: Kysely<Database>) =>
  agencySetNullForeignKey({
    table: 'import_reports',
    column: 'encounter_id',
    references: 'encounters'
  }).execute(db);

export const createImportsTables = async (db: Kysely<Database>) => {
  await buildImportsTable(db).execute();
  await buildImportReportsTable(db).execute();
  for (const index of buildImportsIndexes(db)) await index.execute();
  await dailyNumberTrigger('import_reports', 'report').execute(db);
};
