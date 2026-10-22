import { PgBoss } from 'pg-boss';
import { type Config, parseConfig } from './config.ts';
import { registerHealthJob } from './features/health/job.ts';

export const createWorker = (config: Config) =>
  new PgBoss({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME
  });

if (import.meta.main) {
  const config = parseConfig(process.env);
  const boss = createWorker(config);
  await boss.start();
  await registerHealthJob(boss);
}
