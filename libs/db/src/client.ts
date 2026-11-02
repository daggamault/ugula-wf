import { CompiledQuery, Kysely, PostgresDialect } from 'kysely';
import { Pool, type PoolConfig, types } from 'pg';
import type { Database, Db } from './schema.ts';

export const typeParsers = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === types.builtins.DATE
      ? (value: string) => value
      : types.getTypeParser(oid, format)) as typeof types.getTypeParser
} satisfies NonNullable<PoolConfig['types']>;

export const createDb = (config: PoolConfig): Db =>
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ ...config, types: typeParsers })
    })
  });

export type SqlExecutor = {
  executeSql: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export const sqlExecutor = (db: Kysely<Database>): SqlExecutor => ({
  executeSql: async (text, values = []) => ({
    rows: [...(await db.executeQuery(CompiledQuery.raw(text, values))).rows]
  })
});
