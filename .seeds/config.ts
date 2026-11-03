import { dbEnvEntries, emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

const dbConfigSchema = v.object(dbEnvEntries);

const devSeedSchema = v.object({
  DEV_USER_EMAIL: emailString,
  DEV_USER_PASSWORD: nonEmpty,
  DEV_SFTP_USERNAME: nonEmpty,
  DEV_SFTP_PASSWORD: nonEmpty
});

type DbConfig = v.InferOutput<typeof dbConfigSchema>;
export type DevSeedConfig = v.InferOutput<typeof devSeedSchema>;

export const parseDbConfig = (raw: Record<string, string | undefined>): DbConfig =>
  v.parse(dbConfigSchema, raw);

export const parseDevSeedConfig = (raw: Record<string, string | undefined>): DevSeedConfig =>
  v.parse(devSeedSchema, raw);
