import { readFile } from 'node:fs/promises';
import { hashPassword } from '@ugula/auth';
import { billingModels, createBillingNodes } from '@ugula/billing';
import { createDb, type Db } from '@ugula/db';
import {
  combineSources,
  createModelNodes,
  createRegistry,
  createStdNodes,
  type NodeDef,
  refKey,
  stdGraphSource,
  validateGraph
} from '@ugula/graph';
import { createNemsisNodes, nemsisModels } from '@ugula/nemsis';
import { upsertAgency, upsertBuiltInRoles, upsertOrganization } from './agencies.ts';
import { billingGraphs } from './billing-graphs.ts';
import { buildUpsertDemoPayers, buildUpsertDemoProfile } from './billing-setup.ts';
import { type DevSeedConfig, parseDbConfig, parseDevSeedConfig } from './config.ts';
import { demoGraphs } from './demo-graphs.ts';
import { buildUpsertDefaultFees, demoFees } from './fees.ts';
import { readPlaces, upsertPlaces } from './gnis.ts';
import { PLACES_FILE } from './gnis-build.ts';
import { publishGraphs, type SeedGraph } from './graphs.ts';
import { CODES_FILE, ELEMENTS_FILE } from './nemsis-build.ts';
import { readCodes, readElements, upsertDictionary } from './nemsis-dictionary.ts';
import { upsertMembership, upsertUser } from './users.ts';

const DEV_AGENCIES = [
  { name: 'Development', slug: 'dev', sftp: true },
  { name: 'Development North', slug: 'dev-north', sftp: false }
] as const;

const assertValidGraphs = (graphs: SeedGraph[], nodes: NodeDef[]) => {
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

const graphNodes = () => [
  ...createStdNodes({ fetch }),
  ...createNemsisNodes(null),
  ...createBillingNodes(null),
  ...createModelNodes([...nemsisModels, ...billingModels])
];

const seedBase = async (db: Db) => {
  const nodes = graphNodes();
  assertValidGraphs(billingGraphs, nodes);
  const places = readPlaces(await readFile(PLACES_FILE));
  const dictionary = {
    elements: readElements(await readFile(ELEMENTS_FILE)),
    codes: readCodes(await readFile(CODES_FILE))
  };
  await db.transaction().execute(async (tx) => {
    await upsertPlaces(tx, places);
    await upsertDictionary(tx, dictionary);
    await publishGraphs(tx, billingGraphs, new Set(nodes.map(refKey)));
  });
};

const seedDev = async (db: Db, dev: DevSeedConfig) => {
  const [userPasswordHash, sftpPasswordHash] = await Promise.all([
    hashPassword(dev.DEV_USER_PASSWORD),
    hashPassword(dev.DEV_SFTP_PASSWORD)
  ]);
  const nodes = graphNodes();
  assertValidGraphs(demoGraphs, nodes);

  await db.transaction().execute(async (tx) => {
    const organization = await upsertOrganization(tx, 'Development EMS');
    const user = await upsertUser(tx, {
      organizationId: organization.id,
      email: dev.DEV_USER_EMAIL,
      firstName: 'Dev',
      lastName: 'User',
      passwordHash: userPasswordHash,
      isOwner: true
    });
    for (const seed of DEV_AGENCIES) {
      const agency = await upsertAgency(tx, {
        organizationId: organization.id,
        name: seed.name,
        slug: seed.slug,
        sftpUsername: seed.sftp ? dev.DEV_SFTP_USERNAME : null,
        sftpPasswordHash: seed.sftp ? sftpPasswordHash : null
      });
      const roles = await upsertBuiltInRoles(tx, agency.id);
      const admin = roles.get('Admin');
      if (admin) {
        await upsertMembership(tx, {
          organizationId: organization.id,
          agencyId: agency.id,
          userId: user.id,
          roleId: admin
        });
      }
      await buildUpsertDefaultFees(tx, agency.id, demoFees).execute();
      await buildUpsertDemoProfile(tx, agency.id).execute();
      await buildUpsertDemoPayers(tx, agency.id).execute();
    }

    await publishGraphs(tx, demoGraphs, new Set(nodes.map(refKey)));
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
