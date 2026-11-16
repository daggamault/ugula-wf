import { readFile } from 'node:fs/promises';
import { hashPassword } from '@ugula/auth';
import { createDb, type Db, saveBuiltInRoles } from '@ugula/db';
import { refKey } from '@ugula/graph';
import { sql } from 'kysely';
import { upsertAgency, upsertOrganization } from './agencies.ts';
import { billingGraphs, billingTables } from './billing/index.ts';
import { CMS_FILES, readCmsData, replaceCmsData } from './cms.ts';
import { CODE_SETS_FILE, readCodeSets, replaceCodeSets } from './codes.ts';
import { type DevSeedConfig, parseDbConfig } from './config.ts';
import {
  buildUpsertDevFacilities,
  buildUpsertDevPayers,
  buildUpsertDevProfile,
  upsertDevPayerAliases
} from './dev-billing.ts';
import { devGraphs } from './dev-graphs.ts';
import { buildUpsertDefaultFees, devFees } from './fees.ts';
import {
  GEONAMES_POSTAL_CODES_FILE,
  readGeonamesPostalCodes,
  replaceGeonamesPostalCodes
} from './geonames-postal-codes.ts';
import { PLACES_FILE, readPlaces, replacePlaces } from './gnis.ts';
import { publishGraphs } from './graphs.ts';
import {
  CODES_FILE,
  ELEMENTS_FILE,
  PICK_LISTS_FILE,
  readCodes,
  readElements,
  readPickLists,
  replaceDictionary
} from './nemsis-dictionary.ts';
import { publishTables } from './tables.ts';
import { upsertMembership, upsertUser } from './users.ts';
import { graphNodes, graphProblems, seedProblems } from './validate.ts';

const DEV_AGENCIES = [
  { name: 'Development', slug: 'dev', sftp: true, submitterId: 'DEVEMS01' },
  { name: 'Development North', slug: 'dev-north', sftp: false, submitterId: 'DEVEMS02' }
] as const;

const REFERENCE_TABLES = [
  'gnis_places',
  'codes',
  'nemsis_elements',
  'nemsis_codes',
  'nemsis_pick_lists',
  'geonames_postal_codes',
  'cms_zip_localities',
  'cms_zip4_localities',
  'cms_ambulance_fees',
  'cms_hospitals'
] as const;

export const REFERENCE_SOURCES = [
  PLACES_FILE,
  CODE_SETS_FILE,
  ELEMENTS_FILE,
  CODES_FILE,
  PICK_LISTS_FILE,
  GEONAMES_POSTAL_CODES_FILE,
  ...Object.values(CMS_FILES),
  ...['gnis', 'codes', 'nemsis-dictionary', 'geonames-postal-codes', 'cms', 'tsv'].map(
    (name) => new URL(`./${name}.ts`, import.meta.url)
  )
];

export const seedReference = async (db: Db) => {
  const places = readPlaces(await readFile(PLACES_FILE));
  const codeSets = readCodeSets(await readFile(CODE_SETS_FILE));
  const dictionary = {
    elements: readElements(await readFile(ELEMENTS_FILE)),
    codes: readCodes(await readFile(CODES_FILE)),
    picks: readPickLists(await readFile(PICK_LISTS_FILE))
  };
  const postalCodes = readGeonamesPostalCodes(await readFile(GEONAMES_POSTAL_CODES_FILE));
  const cms = readCmsData({
    zips: await readFile(CMS_FILES.zips),
    zip4s: await readFile(CMS_FILES.zip4s),
    fees: await readFile(CMS_FILES.fees),
    hospitals: await readFile(CMS_FILES.hospitals)
  });
  await db.transaction().execute(async (tx) => {
    await replacePlaces(tx, places);
    await replaceCodeSets(tx, codeSets);
    await replaceDictionary(tx, dictionary);
    await replaceGeonamesPostalCodes(tx, postalCodes);
    await replaceCmsData(tx, cms);
  });
  await sql`analyze ${sql.join(REFERENCE_TABLES.map((name) => sql.table(name)))}`.execute(db);
};

export const seedBilling = async (db: Db) => {
  const nodes = graphNodes();
  const problems = seedProblems(billingGraphs, billingTables, nodes);
  if (problems.length) throw new Error(`Invalid seeds:\n${problems.join('\n')}`);
  await db.transaction().execute(async (tx) => {
    await publishTables(tx, billingTables);
    await publishGraphs(tx, billingGraphs, new Set(nodes.map(refKey)));
  });
};

export const seedDev = async (db: Db, dev: DevSeedConfig) => {
  const [userPasswordHash, sftpPasswordHash] = await Promise.all([
    hashPassword(dev.DEV_USER_PASSWORD),
    hashPassword(dev.DEV_SFTP_PASSWORD)
  ]);
  const nodes = graphNodes();
  const problems = graphProblems(devGraphs, nodes);
  if (problems.length) throw new Error(`Invalid dev graphs:\n${problems.join('\n')}`);

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
      const roles = await saveBuiltInRoles(tx, agency.id);
      const admin = roles.get('Admin');
      if (admin) {
        await upsertMembership(tx, {
          organizationId: organization.id,
          agencyId: agency.id,
          userId: user.id,
          roleId: admin
        });
      }
      await buildUpsertDefaultFees(tx, agency.id, devFees).execute();
      await buildUpsertDevProfile(tx, agency.id, seed.submitterId).execute();
      await buildUpsertDevPayers(tx, agency.id).execute();
      await upsertDevPayerAliases(tx, agency.id);
      await buildUpsertDevFacilities(tx, agency.id).execute();
    }

    await publishGraphs(tx, devGraphs, new Set(nodes.map(refKey)));
  });
};

if (import.meta.main) {
  const dbConfig = parseDbConfig(process.env);
  const db = createDb({
    host: dbConfig.DB_HOST,
    port: dbConfig.DB_PORT,
    user: dbConfig.DB_USER,
    password: dbConfig.DB_PASSWORD,
    database: dbConfig.DB_NAME
  });

  try {
    await seedReference(db);
    await seedBilling(db);
  } finally {
    await db.destroy();
  }
}
