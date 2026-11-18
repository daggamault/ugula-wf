import { CODE_PATTERN, CODE_SETS } from '@ugula/billing';
import { type Database, EMBEDDING_DIMENSIONS } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { oneOf, trimmed } from './checks.ts';

const buildCodesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('codes')
    .addColumn('code_set', 'text', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull().modifyFront(sql`collate "C"`))
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('is_billable', 'boolean', (col) => col.notNull())
    .addColumn('embedding', sql`vector(${sql.lit(EMBEDDING_DIMENSIONS)})`)
    .addPrimaryKeyConstraint('codes_pkey', ['code_set', 'code'])
    .addCheckConstraint('codes_code_set_check', oneOf('code_set', CODE_SETS))
    .addCheckConstraint('codes_code_check', sql`code ~ ${sql.lit(CODE_PATTERN)}`)
    .addCheckConstraint('codes_description_check', trimmed('description'))
    .addCheckConstraint('codes_is_billable_check', sql`is_billable or code_set = 'icd10cm'`);

const buildCodesDescriptionIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_codes_description_trgm')
    .on('codes')
    .using('gin')
    .expression(sql`description gin_trgm_ops`);

const buildCodesEmbeddingIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_codes_embedding')
    .on('codes')
    .using('hnsw')
    .expression(sql`embedding vector_cosine_ops`)
    .where(sql.ref('embedding'), 'is not', null);

export const createCodesTable = async (db: Kysely<Database>) => {
  await buildCodesTable(db).execute();
  await buildCodesDescriptionIndex(db).execute();
  await buildCodesEmbeddingIndex(db).execute();
};
