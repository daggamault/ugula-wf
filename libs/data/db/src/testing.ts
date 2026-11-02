import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely';
import type { Database, Db } from './schema.ts';

export const createDummyDb = (): Db =>
  new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });

export type RowsFor = (query: CompiledQuery) => unknown[];

export const createRecordingDb = (rowsFor: RowsFor = () => []) => {
  const queries: CompiledQuery[] = [];
  const conn: DatabaseConnection = {
    executeQuery: async <R>(q: CompiledQuery) => {
      queries.push(q);
      const rows = rowsFor(q) as R[];
      return { rows, numAffectedRows: BigInt(rows.length) };
    },
    streamQuery: async function* () {
      yield* [];
    }
  };
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => Object.assign(new DummyDriver(), { acquireConnection: async () => conn }),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, queries };
};
