import { type Database, TABLE_KINDS, TABLE_PUBLISHED_IMMUTABLE_TRIGGER } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildDataTablesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('data_tables')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('agency_id', 'uuid')
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint(
      'data_tables_scope_key_unique',
      ['organization_id', 'agency_id', 'key'],
      (uc) => uc.nullsNotDistinct()
    )
    .addForeignKeyConstraint(
      'data_tables_agency_fkey',
      ['agency_id', 'organization_id'],
      'agencies',
      ['id', 'organization_id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint(
      'data_tables_scope_check',
      sql`agency_id is null or organization_id is not null`
    )
    .addCheckConstraint(
      'data_tables_kind_check',
      sql`kind in (${sql.join(TABLE_KINDS.map((v) => sql.lit(v)))})`
    )
    .addCheckConstraint(
      'data_tables_key_check',
      sql`key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$' and key not like 'std.%'`
    );

const buildDataTableVersionsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('data_table_versions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('table_id', 'uuid', (col) =>
      col.notNull().references('data_tables.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('version', 'integer', (col) => col.notNull().check(sql`version > 0`))
    .addColumn('definition', 'jsonb', (col) => col.notNull())
    .addColumn('base_version_id', 'uuid', (col) =>
      col.references('data_table_versions.id').onDelete('restrict').onUpdate('cascade')
    )
    .addColumn('contract', 'text', (col) => col.notNull())
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('data_table_versions_table_id_version_unique', ['table_id', 'version']);

const buildDataTableIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_data_table_versions_draft')
    .on('data_table_versions')
    .column('table_id')
    .unique()
    .where(sql.ref('published_at'), 'is', null),
  db.schema
    .createIndex('idx_data_table_versions_base_version_id')
    .on('data_table_versions')
    .column('base_version_id'),
  db.schema
    .createIndex('idx_data_table_versions_created_by')
    .on('data_table_versions')
    .column('created_by'),
  db.schema.createIndex('idx_data_tables_agency_id').on('data_tables').column('agency_id')
];

const buildWorkflowRunTablesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('workflow_run_tables')
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('table_version_id', 'uuid', (col) =>
      col.notNull().references('data_table_versions.id').onDelete('no action').onUpdate('cascade')
    )
    .addPrimaryKeyConstraint('workflow_run_tables_pkey', ['run_id', 'key']);

const buildWorkflowRunTablesVersionIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_workflow_run_tables_table_version_id')
    .on('workflow_run_tables')
    .column('table_version_id');

const publishedImmutableFunction = sql`
  create function prevent_published_table_change() returns trigger language plpgsql as $$
  begin
    if old.published_at is not null then
      raise exception 'table version % is published and immutable', old.id;
    end if;
    return new;
  end;
  $$`;

const publishedImmutableTrigger = sql`
  create trigger ${sql.id(TABLE_PUBLISHED_IMMUTABLE_TRIGGER)}
  before update on data_table_versions
  for each row execute function prevent_published_table_change()`;

export const createDataTablesTables = async (db: Kysely<Database>) => {
  await buildDataTablesTable(db).execute();
  await buildDataTableVersionsTable(db).execute();
  for (const index of buildDataTableIndexes(db)) await index.execute();
  await buildWorkflowRunTablesTable(db).execute();
  await buildWorkflowRunTablesVersionIndex(db).execute();
  await publishedImmutableFunction.execute(db);
  await publishedImmutableTrigger.execute(db);
};
