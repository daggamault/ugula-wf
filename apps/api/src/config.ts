import {
  dbEnvEntries,
  nodeEnvSchema,
  nonEmpty,
  portInt,
  posInt,
  redisEnvEntries,
  s3EnvEntries,
  urlString
} from '@ugula/config';
import * as v from 'valibot';

const configSchema = v.object({
  NODE_ENV: nodeEnvSchema,
  API_PORT: portInt,
  SSE_URL: urlString,
  WEB_URL: urlString,
  HTTP_CORS_ORIGINS: nonEmpty,
  HTTP_MAX_BODY_BYTES: posInt,
  ...dbEnvEntries,
  API_DB_POOL_MAX: posInt,
  ...redisEnvEntries,
  ...s3EnvEntries,
  IMPORT_FILE_MAX_BYTES: posInt,
  SFTP_HOOK_SECRET: v.pipe(nonEmpty, v.minLength(32)),
  SFTP_S3_ENDPOINT: urlString,
  SFTP_HOME_ROOT: nonEmpty,
  EMBEDDINGS_URL: urlString
});

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
