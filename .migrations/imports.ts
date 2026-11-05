import { type Database, IMPORT_SOURCES } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { dailyNumberCheck, dailyNumberTrigger } from './numbers.ts';

const buildImportsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('imports')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().unique().references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('file_name', 'text', (col) => col.notNull())
    .addColumn('file', 'jsonb', (col) => col.notNull())
    .addColumn('report_count', 'integer')
    .addColumn('uploaded_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
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
    .addColumn('import_id', 'uuid', (col) =>
      col.notNull().references('imports.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('number', 'text', (col) => col.notNull())
    .addColumn('pcr_number', 'text')
    .addColumn('report', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('import_reports_import_id_position_unique', ['import_id', 'position'])
    .addCheckConstraint('import_reports_position_check', sql`position >= 0`)
    .addCheckConstraint('import_reports_number_check', dailyNumberCheck);

const buildImportsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_imports_agency_created')
    .on('imports')
    .columns(['agency_id', 'created_at desc']),
  db.schema.createIndex('idx_imports_uploaded_by').on('imports').column('uploaded_by'),
  db.schema.createIndex('idx_import_reports_number').on('import_reports').column('number'),
  db.schema
    .createIndex('import_reports_report_key_unique')
    .on('import_reports')
    .unique()
    .expression(sql`(report ->> 'key')`)
];

export const createImportsTables = async (db: Kysely<Database>) => {
  await buildImportsTable(db).execute();
  await buildImportReportsTable(db).execute();
  for (const index of buildImportsIndexes(db)) await index.execute();
  await dailyNumberTrigger('import_reports', 'encounter').execute(db);
};
