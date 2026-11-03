import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const EXTENSIONS = ['vector', 'pg_trgm'] as const;

const buildExtensions = () =>
  EXTENSIONS.map((name) => sql`create extension if not exists ${sql.id(name)}`);

export const createExtensions = async (db: Kysely<Database>) => {
  for (const statement of buildExtensions()) await statement.execute(db);
};
