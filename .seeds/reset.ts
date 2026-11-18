import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDb, type Db } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import { sql } from 'kysely';
import { migrate } from '../.migrations/migrate.ts';
import { parseDevSeedConfig, parseEmbeddingsConfig, parseResetConfig } from './config.ts';
import { createSeedEmbed, REFERENCE_SOURCES, seedBilling, seedDev, seedReference } from './seed.ts';

const MAINTENANCE_DB = 'postgres';

type Connect = (database: string) => Db;

type Embed = Parameters<typeof seedReference>[1];

const referenceFingerprint = async (model: string) => {
  const { db, queries } = createRecordingDb();
  await migrate(db);
  const hash = createHash('sha256').update(model);
  for (const q of queries) hash.update(q.sql).update(JSON.stringify(q.parameters));
  for (const url of REFERENCE_SOURCES) hash.update(await readFile(url));
  return hash.digest('hex');
};

const storedFingerprint = async (admin: Db, name: string) => {
  const { rows } = await sql<{ fingerprint: string | null }>`
    select shobj_description(oid, 'pg_database') as fingerprint
    from pg_database where datname = ${name}`.execute(admin);
  return rows[0]?.fingerprint ?? null;
};

const dropDatabase = (admin: Db, name: string) =>
  sql`drop database if exists ${sql.id(name)} with (force)`.execute(admin);

const buildReference = async (
  admin: Db,
  connect: Connect,
  name: string,
  fingerprint: string,
  embed: Embed
) => {
  await dropDatabase(admin, name);
  await sql`create database ${sql.id(name)}`.execute(admin);
  const db = connect(name);
  try {
    await migrate(db);
    await seedReference(db, embed);
  } finally {
    await db.destroy();
  }
  await sql`comment on database ${sql.id(name)} is ${sql.lit(fingerprint)}`.execute(admin);
};

const cloneDatabase = async (admin: Db, from: string, to: string) => {
  await dropDatabase(admin, to);
  await sql`create database ${sql.id(to)} template ${sql.id(from)} strategy file_copy`.execute(
    admin
  );
};

if (import.meta.main) {
  const config = parseResetConfig(process.env);
  const dev = parseDevSeedConfig(process.env);
  const connect: Connect = (database) =>
    createDb({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database
    });
  const reference = config.DB_REFERENCE_NAME;
  const admin = connect(MAINTENANCE_DB);
  try {
    const { model, embed } = await createSeedEmbed(
      parseEmbeddingsConfig(process.env).EMBEDDINGS_URL
    );
    const fingerprint = await referenceFingerprint(model);
    if ((await storedFingerprint(admin, reference)) === fingerprint) {
      process.stdout.write(`${reference} is current\n`);
    } else {
      process.stdout.write(`Building ${reference}\n`);
      await buildReference(admin, connect, reference, fingerprint, embed);
    }
    await cloneDatabase(admin, reference, config.DB_NAME);
  } finally {
    await admin.destroy();
  }
  const db = connect(config.DB_NAME);
  try {
    await seedBilling(db);
    await seedDev(db, dev);
  } finally {
    await db.destroy();
  }
  process.stdout.write(`Reset ${config.DB_NAME} from ${reference}\n`);
}
