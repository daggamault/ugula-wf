import {
  dbEnvEntries,
  nodeEnvSchema,
  posInt,
  redisEnvEntries,
  s3EnvEntries,
  secretKeyEnvEntries,
  urlString
} from '@ugula/config';
import * as v from 'valibot';

const utilization = v.pipe(
  v.string(),
  v.transform(Number),
  v.number(),
  v.minValue(0.1),
  v.maxValue(1)
);

const configSchema = v.object({
  NODE_ENV: v.optional(nodeEnvSchema, 'production'),
  ...dbEnvEntries,
  ...redisEnvEntries,
  ...s3EnvEntries,
  ...secretKeyEnvEntries,
  EMBEDDINGS_URL: urlString,
  WORKER_RUN_CONCURRENCY: v.optional(posInt, '8'),
  WORKER_MAX_EVENT_LOOP_UTILIZATION: v.optional(utilization, '0.9'),
  WORKER_MAX_HEAP_MB: v.optional(posInt),
  WORKER_MAX_RSS_MB: v.optional(posInt),
  CLEARINGHOUSE_POLL_MINUTES: v.optional(posInt, '5')
});

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
