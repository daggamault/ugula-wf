import { createDb, type Db } from '@ugula/db';
import { hashPassword } from '@ugula/passwords';
import { type DevSeedConfig, parseDbConfig, parseDevSeedConfig } from './config.ts';
import { upsertTenant } from './tenants.ts';
import { upsertUser } from './users.ts';

export const seedDev = async (db: Db, dev: DevSeedConfig) => {
  const [userPasswordHash, sftpPasswordHash] = await Promise.all([
    hashPassword(dev.DEV_USER_PASSWORD),
    hashPassword(dev.DEV_SFTP_PASSWORD)
  ]);

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
    if (isDev) {
      await seedDev(db, parseDevSeedConfig(process.env));
    }
  } finally {
    await db.destroy();
  }
}
