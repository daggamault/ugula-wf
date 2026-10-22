import {
  dbEnvEntries,
  nodeEnvSchema,
  nonEmpty,
  portInt,
  posInt,
  redisEnvEntries,
  urlString
} from '@ugula/config';
import * as v from 'valibot';

export const configSchema = v.object({
  NODE_ENV: nodeEnvSchema,
  API_PORT: portInt,
  SSE_URL: urlString,
  HTTP_CORS_ORIGINS: nonEmpty,
  ...dbEnvEntries,
  API_DB_POOL_MAX: posInt,
  ...redisEnvEntries
});

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
