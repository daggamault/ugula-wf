import { createBillingNodes } from '@ugula/billing';
import { createDb, type Db } from '@ugula/db';
import {
  combineSources,
  createRegistry,
  createStdNodes,
  type NodeDef,
  refKey,
  stdGraphSource,
  validateGraph
} from '@ugula/graph';
import { createNemsisNodes } from '@ugula/nemsis';
import { hashPassword } from '@ugula/passwords';
import { billingGraphs } from './billing-graphs.ts';
import { buildUpsertDemoPayers, buildUpsertDemoProfile } from './billing-setup.ts';
import { type DevSeedConfig, parseDbConfig, parseDevSeedConfig } from './config.ts';
import { demoGraphs } from './demo-graphs.ts';
import { buildUpsertDefaultFees, demoFees } from './fees.ts';
import { publishGraph, type SeedGraph } from './graphs.ts';
import { upsertTenant } from './tenants.ts';
import { upsertUser } from './users.ts';

export const assertValidGraphs = (graphs: SeedGraph[], nodes: NodeDef[]) => {
  const byRef = new Map(
    graphs.map((g) => [refKey({ type: g.key, version: g.version }), g.definition])
  );
  const registry = createRegistry(
    nodes,
    combineSources(stdGraphSource, (ref) => byRef.get(refKey(ref)))
  );
  const problems = graphs.flatMap((g) =>
    validateGraph(g.definition, registry).map(
      (i) => `${g.key}${i.node ? `#${i.node}` : ''}: ${i.message}`
    )
  );
  if (problems.length) throw new Error(`Invalid seed graphs:\n${problems.join('\n')}`);
};

export const graphNodes = () => [
  ...createStdNodes({ fetch }),
  ...createNemsisNodes(null),
  ...createBillingNodes(null)
];

const primitives = () => new Set(graphNodes().map(refKey));

export const seedBase = async (db: Db) => {
  assertValidGraphs(billingGraphs, graphNodes());
  await db.transaction().execute(async (tx) => {
    for (const graph of billingGraphs) await publishGraph(tx, graph, primitives());
  });
};

export const seedDev = async (db: Db, dev: DevSeedConfig) => {
  const [userPasswordHash, sftpPasswordHash] = await Promise.all([
    hashPassword(dev.DEV_USER_PASSWORD),
    hashPassword(dev.DEV_SFTP_PASSWORD)
  ]);
  assertValidGraphs(demoGraphs, graphNodes());

  await db.transaction().execute(async (tx) => {
    const tenant = await upsertTenant(tx, {
      name: 'Development',
      slug: 'dev',
      sftpUsername: dev.DEV_SFTP_USERNAME,
      sftpPasswordHash
    });

    await upsertUser(tx, {
      tenantId: tenant.id,
      email: dev.DEV_USER_EMAIL,
      passwordHash: userPasswordHash
    });

    await buildUpsertDefaultFees(tx, tenant.id, demoFees).execute();
    await buildUpsertDemoProfile(tx, tenant.id).execute();
    await buildUpsertDemoPayers(tx, tenant.id).execute();

    for (const graph of demoGraphs) await publishGraph(tx, graph, primitives());
  });
};

if (import.meta.main) {
  const dbConfig = parseDbConfig(process.env);
  const isDev = process.argv.includes('--dev');
  const db = createDb({
    host: dbConfig.DB_HOST,
    port: dbConfig.DB_PORT,
    user: dbConfig.DB_USER,
    password: dbConfig.DB_PASSWORD,
    database: dbConfig.DB_NAME
  });

  try {
    await seedBase(db);
    if (isDev) {
      await seedDev(db, parseDevSeedConfig(process.env));
    }
  } finally {
    await db.destroy();
  }
}
