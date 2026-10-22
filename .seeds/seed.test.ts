import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Database } from '@ugula/db';
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely';
import { seedDev } from './seed.ts';

const createRecordingSeedDb = () => {
  const queries: CompiledQuery[] = [];
  const conn: DatabaseConnection = {
    executeQuery: async <R>(q: CompiledQuery) => {
      queries.push(q);
      return { rows: [{ id: 'tenant-1' } as unknown as R] };
    },
    streamQuery: async function* () {
      yield* [];
    }
  };

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () =>
        Object.assign(new DummyDriver(), {
          acquireConnection: async () => conn
        }),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });

  return { db, queries };
};

describe('seedDev', () => {
  it('hashes credentials and upserts development tenant and user inside a transaction', async () => {
    const { db, queries } = createRecordingSeedDb();

    await seedDev(db, {
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_PASSWORD: 'user-pass',
      DEV_SFTP_USERNAME: 'acme-ems',
      DEV_SFTP_PASSWORD: 'sftp-pass'
    });

    assert.equal(queries.length, 2);
    assert.ok(queries[0]?.sql.includes('insert into "tenants"'));
    assert.ok(queries[1]?.sql.includes('insert into "users"'));
    assert.ok(queries[1]?.parameters.includes('tenant-1'));
    assert.ok(queries[1]?.parameters.includes('dev@example.com'));

    await db.destroy();
  });
});
