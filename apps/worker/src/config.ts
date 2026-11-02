import {
  dbEnvEntries,
  inferenceEnvEntries,
  posInt,
  redisEnvEntries,
  s3EnvEntries
} from '@ugula/config';
import * as v from 'valibot';

const utilization = v.pipe(
  v.string(),
  v.transform(Number),
  v.number(),
  v.minValue(0.1),
  v.maxValue(1)
);

export const configSchema = v.object({
  ...dbEnvEntries,
  ...redisEnvEntries,
  ...s3EnvEntries,
  ...inferenceEnvEntries,
  WORKFLOW_CONCURRENCY: v.optional(posInt, '8'),
  COMPLETIONS_CONCURRENCY: v.optional(posInt, '2'),
  WORKER_MAX_EVENT_LOOP_UTILIZATION: v.optional(utilization, '0.9'),
  WORKER_MAX_HEAP_MB: v.optional(posInt),
  WORKER_MAX_RSS_MB: v.optional(posInt)
});

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
