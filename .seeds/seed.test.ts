import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Database } from '@ugula/db';
import { createStdNodes } from '@ugula/graph';
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely';
import { billingGraphs } from './billing-graphs.ts';
import { demoGraphs } from './demo-graphs.ts';
import { assertValidGraphs, seedBase, seedDev } from './seed.ts';

const createRecordingSeedDb = () => {
  const queries: CompiledQuery[] = [];
  const conn: DatabaseConnection = {
    executeQuery: async <R>(q: CompiledQuery) => {
      queries.push(q);
      const refs = q.parameters.flatMap((p, i) =>
        typeof p === 'string' && typeof q.parameters[i + 1] === 'number'
          ? [{ id: 'v-dep', key: p, version: q.parameters[i + 1] }]
          : []
      );
      const rows = q.sql.startsWith('select') ? refs : [{ id: 'tenant-1' }];
      return { rows: rows as unknown as R[] };
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
  it('upserts the development tenant, user and demo graphs inside a transaction', async () => {
    const { db, queries } = createRecordingSeedDb();

    await seedDev(db, {
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_PASSWORD: 'user-pass',
      DEV_SFTP_USERNAME: 'acme-ems',
      DEV_SFTP_PASSWORD: 'sftp-pass'
    });

    assert.ok(queries[0]?.sql.includes('insert into "tenants"'));
    assert.ok(queries[1]?.sql.includes('insert into "users"'));
    assert.ok(queries[1]?.parameters.includes('tenant-1'));
    assert.ok(queries[1]?.parameters.includes('dev@example.com'));
    const versions = queries.filter((q) => q.sql.startsWith('insert into "graph_versions"'));
    assert.equal(versions.length, demoGraphs.length);
    assert.deepEqual(versions[1]?.parameters.at(-1), ['v-dep']);

    await db.destroy();
  });
});

describe('seedBase', () => {
  it('publishes the billing graphs', async () => {
    const { db, queries } = createRecordingSeedDb();
    await seedBase(db);
    const versions = queries.filter((q) => q.sql.startsWith('insert into "graph_versions"'));
    assert.equal(versions.length, billingGraphs.length);
    await db.destroy();
  });
});

describe('assertValidGraphs', () => {
  it('reports every invalid node with its graph key', () => {
    const [first] = demoGraphs;
    if (!first) throw new Error('missing demo graph');
    const broken = {
      ...first,
      definition: {
        ...first.definition,
        nodes: [...first.definition.nodes, { id: 'x', type: 'nope', version: 1 }]
      }
    };
    assert.throws(
      () => assertValidGraphs([broken], createStdNodes({ fetch })),
      /demo\.line-total#x: Unknown node type nope@1/
    );
  });
});
