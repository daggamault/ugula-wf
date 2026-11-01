import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildGraphsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('graphs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('graphs_tenant_id_key_unique', ['tenant_id', 'key'], (uc) =>
      uc.nullsNotDistinct()
    )
    .addCheckConstraint('graphs_kind_check', sql`kind in ('workflow', 'node')`)
    .addCheckConstraint(
      'graphs_key_check',
      sql`key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$' and key not like 'std.%'`
    );

export const buildGraphVersionsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('graph_versions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('graph_id', 'uuid', (col) =>
      col.notNull().references('graphs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('version', 'integer', (col) => col.notNull().check(sql`version > 0`))
    .addColumn('definition', 'jsonb', (col) => col.notNull())
    .addColumn('dependencies', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('graph_versions_graph_id_version_unique', ['graph_id', 'version']);

export const buildGraphVersionsDraftIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_graph_versions_draft')
    .on('graph_versions')
    .column('graph_id')
    .unique()
    .where(sql.ref('published_at'), 'is', null);

export const buildGraphVersionsCreatedByIndex = (db: Kysely<Database>) =>
  db.schema.createIndex('idx_graph_versions_created_by').on('graph_versions').column('created_by');

export const publishedImmutableFunction = sql`
  create function prevent_published_graph_change() returns trigger language plpgsql as $$
  begin
    if old.published_at is not null then
      raise exception 'graph version % is published and immutable', old.id;
    end if;
    return new;
  end;
  $$`;

export const publishedImmutableTrigger = sql`
  create trigger graph_versions_published_immutable
  before update on graph_versions
  for each row execute function prevent_published_graph_change()`;

export const createGraphsTables = async (db: Kysely<Database>) => {
  await buildGraphsTable(db).execute();
  await buildGraphVersionsTable(db).execute();
  await buildGraphVersionsDraftIndex(db).execute();
  await buildGraphVersionsCreatedByIndex(db).execute();
  await publishedImmutableFunction.execute(db);
  await publishedImmutableTrigger.execute(db);
};
