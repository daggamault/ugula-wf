import { dbEnvEntries, emailString, nonEmpty, urlString } from '@ugula/config';
import * as v from 'valibot';

const dbConfigSchema = v.object(dbEnvEntries);

const resetConfigSchema = v.pipe(
  v.object({ ...dbEnvEntries, DB_REFERENCE_NAME: v.optional(nonEmpty) }),
  v.transform(({ DB_REFERENCE_NAME, ...c }) => ({
    ...c,
    DB_REFERENCE_NAME: DB_REFERENCE_NAME ?? `${c.DB_NAME}_reference`
  })),
  v.check(
    (c) => c.DB_NAME !== c.DB_REFERENCE_NAME && c.DB_NAME !== 'postgres',
    'DB_NAME must not be the reference or maintenance database'
  )
);

const devSeedSchema = v.object({
  DEV_USER_EMAIL: emailString,
  DEV_USER_PASSWORD: nonEmpty,
  DEV_SFTP_USERNAME: nonEmpty,
  DEV_SFTP_PASSWORD: nonEmpty
});

const embeddingsSchema = v.object({ EMBEDDINGS_URL: urlString });

type DbConfig = v.InferOutput<typeof dbConfigSchema>;
export type ResetConfig = v.InferOutput<typeof resetConfigSchema>;
export type DevSeedConfig = v.InferOutput<typeof devSeedSchema>;

export const parseDbConfig = (raw: Record<string, string | undefined>): DbConfig =>
  v.parse(dbConfigSchema, raw);

export const parseResetConfig = (raw: Record<string, string | undefined>): ResetConfig =>
  v.parse(resetConfigSchema, raw);

export const parseDevSeedConfig = (raw: Record<string, string | undefined>): DevSeedConfig =>
  v.parse(devSeedSchema, raw);

export const parseEmbeddingsConfig = (raw: Record<string, string | undefined>) =>
  v.parse(embeddingsSchema, raw);
