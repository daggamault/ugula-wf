import type { Database } from '@ugula/db';
import { deepEqual, type Json, tableContract } from '@ugula/graph';
import { type Kysely, sql } from 'kysely';
import type { SeedTable } from './builder.ts';

const buildUpsertTable = (db: Kysely<Database>, table: SeedTable) =>
  db
    .insertInto('data_tables')
    .values({
      organization_id: null,
      agency_id: null,
      key: table.key,
      name: table.name,
      kind: table.kind,
      description: table.description
    })
    .onConflict((oc) =>
      oc.columns(['organization_id', 'agency_id', 'key']).doUpdateSet({
        name: table.name,
        kind: table.kind,
        description: table.description,
        updated_at: sql`now()`
      })
    )
    .returning('id');

const findLatest = (db: Kysely<Database>, tableId: string) =>
  db
    .selectFrom('data_table_versions')
    .select(['version', 'definition'])
    .where('table_id', '=', tableId)
    .where('published_at', 'is not', null)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();

const publishTable = async (db: Kysely<Database>, table: SeedTable) => {
  const { id } = await buildUpsertTable(db, table).executeTakeFirstOrThrow();
  const latest = await findLatest(db, id);
  if (latest && deepEqual(latest.definition as Json, table.definition)) return;
  await db
    .insertInto('data_table_versions')
    .values({
      table_id: id,
      version: (latest?.version ?? 0) + 1,
      definition: JSON.stringify(table.definition),
      contract: tableContract(table.definition),
      published_at: sql`now()`
    })
    .execute();
};

export const publishTables = async (db: Kysely<Database>, tables: SeedTable[]) => {
  for (const table of tables) await publishTable(db, table);
};
