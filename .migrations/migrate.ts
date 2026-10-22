import { createDb, type Database, type Db } from '@ugula/db';
import type { Kysely } from 'kysely';
import { parseConfig } from './config.ts';
import { createTenantsTable } from './tenants.ts';
import { createUsersTable } from './users.ts';

export const resetSchema = async (db: Kysely<Database>) => {
  await db.schema.dropTable('users').ifExists().cascade().execute();
  await db.schema.dropTable('tenants').ifExists().cascade().execute();
};

export const steps = [resetSchema, createTenantsTable, createUsersTable] as const;

export const migrate = async (db: Db) => {
  await db.transaction().execute(async (tx) => {
    for (const step of steps) {
      await step(tx);
    }
  });
};

if (import.meta.main) {
  const config = parseConfig(process.env);
  const db = createDb({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME
  });
  try {
    await migrate(db);
  } finally {
    await db.destroy();
  }
}
