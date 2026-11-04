import { type Database, GRAPH_KINDS, PUBLISHED_IMMUTABLE_TRIGGER } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildGraphsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('graphs')
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
    .addUniqueConstraint('graphs_scope_key_unique', ['organization_id', 'agency_id', 'key'], (uc) =>
      uc.nullsNotDistinct()
    )
    .addForeignKeyConstraint(
      'graphs_agency_fkey',
      ['agency_id', 'organization_id'],
      'agencies',
      ['id', 'organization_id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint('graphs_scope_check', sql`agency_id is null or organization_id is not null`)
    .addCheckConstraint(
      'graphs_kind_check',
      sql`kind in (${sql.join(GRAPH_KINDS.map((v) => sql.lit(v)))})`
    )
    .addCheckConstraint(
      'graphs_key_check',
      sql`key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$' and key not like 'std.%'`
    );

const buildGraphVersionsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('graph_versions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('graph_id', 'uuid', (col) =>
      col.notNull().references('graphs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('version', 'integer', (col) => col.notNull().check(sql`version > 0`))
    .addColumn('definition', 'jsonb', (col) => col.notNull())
    .addColumn('base_version_id', 'uuid', (col) =>
      col.references('graph_versions.id').onDelete('restrict').onUpdate('cascade')
    )
    .addColumn('contract', 'text', (col) => col.notNull())
    .addColumn('dependencies', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('graph_versions_graph_id_version_unique', ['graph_id', 'version']);

const buildGraphVersionsDraftIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_graph_versions_draft')
    .on('graph_versions')
    .column('graph_id')
    .unique()
    .where(sql.ref('published_at'), 'is', null);

const buildGraphVersionsCreatedByIndex = (db: Kysely<Database>) =>
  db.schema.createIndex('idx_graph_versions_created_by').on('graph_versions').column('created_by');

const buildGraphScopeIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_graph_versions_base_version_id')
    .on('graph_versions')
    .column('base_version_id'),
  db.schema.createIndex('idx_graphs_agency_id').on('graphs').column('agency_id')
];

const publishedImmutableFunction = sql`
  create function prevent_published_graph_change() returns trigger language plpgsql as $$
  begin
    if old.published_at is not null then
      raise exception 'graph version % is published and immutable', old.id;
    end if;
    return new;
  end;
  $$`;

const publishedImmutableTrigger = sql`
  create trigger ${sql.id(PUBLISHED_IMMUTABLE_TRIGGER)}
  before update on graph_versions
  for each row execute function prevent_published_graph_change()`;

export const createGraphsTables = async (db: Kysely<Database>) => {
  await buildGraphsTable(db).execute();
  await buildGraphVersionsTable(db).execute();
  await buildGraphVersionsDraftIndex(db).execute();
  await buildGraphVersionsCreatedByIndex(db).execute();
  for (const index of buildGraphScopeIndexes(db)) await index.execute();
  await publishedImmutableFunction.execute(db);
  await publishedImmutableTrigger.execute(db);
};
