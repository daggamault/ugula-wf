import { dbEnvEntries, posInt, redisEnvEntries, s3EnvEntries } from '@ugula/config';
import * as v from 'valibot';

export const configSchema = v.object({
  ...dbEnvEntries,
  ...redisEnvEntries,
  ...s3EnvEntries,
  WORKFLOW_CONCURRENCY: v.optional(posInt, '8')
});

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
