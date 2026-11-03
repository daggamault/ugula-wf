import { dbEnvEntries, nonEmpty, portInt, redisEnvEntries } from '@ugula/config';
import * as v from 'valibot';

const configSchema = v.object({
  SSE_PORT: portInt,
  HTTP_CORS_ORIGINS: nonEmpty,
  ...dbEnvEntries,
  ...redisEnvEntries
});

type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
