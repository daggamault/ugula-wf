import { CODE_SETS } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildCodesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('codes')
    .addColumn('code_set', 'text', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('codes_pkey', ['code_set', 'code'])
    .addCheckConstraint(
      'codes_code_set_check',
      sql`code_set in (${sql.join(CODE_SETS.map((s) => sql.lit(s)))})`
    )
    .addCheckConstraint('codes_code_check', sql`code ~ '^[A-Z0-9]{1,7}$'`);

export const createCodesTable = async (db: Kysely<Database>) => {
  await buildCodesTable(db).execute();
};
