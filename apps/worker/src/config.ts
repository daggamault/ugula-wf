import {
  dbEnvEntries,
  inferenceEnvEntries,
  nonEmpty,
  portInt,
  posInt,
  redisEnvEntries,
  s3EnvEntries
} from '@ugula/config';
import * as v from 'valibot';
import type { ClearinghouseConfig } from './shared/clearinghouse.ts';

const utilization = v.pipe(
  v.string(),
  v.transform(Number),
  v.number(),
  v.minValue(0.1),
  v.maxValue(1)
);

const remotePath = v.pipe(nonEmpty, v.trim(), v.startsWith('/'));

const pathList = v.pipe(
  nonEmpty,
  v.transform((s) =>
    s
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
  ),
  v.array(remotePath),
  v.minLength(1)
);

const clearinghouseEntries = {
  CLEARINGHOUSE_SFTP_HOST: v.optional(v.pipe(v.string(), v.trim())),
  CLEARINGHOUSE_SFTP_PORT: v.optional(portInt, '22'),
  CLEARINGHOUSE_SFTP_USERNAME: v.optional(v.string()),
  CLEARINGHOUSE_SFTP_PASSWORD: v.optional(v.string()),
  CLEARINGHOUSE_UPLOAD_PATH: v.optional(remotePath, '/'),
  CLEARINGHOUSE_DOWNLOAD_PATHS: v.optional(pathList, '/'),
  CLEARINGHOUSE_FILE_EXTENSION: v.optional(v.pipe(v.string(), v.regex(/^\.[A-Za-z0-9]+$/)), '.txt'),
  CLEARINGHOUSE_AFTER_DOWNLOAD: v.optional(v.picklist(['delete', 'keep']), 'delete'),
  CLEARINGHOUSE_POLL_MINUTES: v.optional(v.pipe(posInt, v.maxValue(59)), '1')
};

const baseSchema = v.object({
  ...dbEnvEntries,
  ...redisEnvEntries,
  ...s3EnvEntries,
  ...inferenceEnvEntries,
  WORKFLOW_CONCURRENCY: v.optional(posInt, '8'),
  COMPLETIONS_CONCURRENCY: v.optional(posInt, '2'),
  WORKER_MAX_EVENT_LOOP_UTILIZATION: v.optional(utilization, '0.9'),
  WORKER_MAX_HEAP_MB: v.optional(posInt),
  WORKER_MAX_RSS_MB: v.optional(posInt),
  ...clearinghouseEntries
});

const configSchema = v.pipe(
  baseSchema,
  v.check(
    (c) =>
      !c.CLEARINGHOUSE_SFTP_HOST ||
      (Boolean(c.CLEARINGHOUSE_SFTP_USERNAME) && Boolean(c.CLEARINGHOUSE_SFTP_PASSWORD)),
    'CLEARINGHOUSE_SFTP_USERNAME and CLEARINGHOUSE_SFTP_PASSWORD are required with CLEARINGHOUSE_SFTP_HOST'
  )
);

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);

export const clearinghouseOf = (c: Config): ClearinghouseConfig | null =>
  c.CLEARINGHOUSE_SFTP_HOST
    ? {
        host: c.CLEARINGHOUSE_SFTP_HOST,
        port: c.CLEARINGHOUSE_SFTP_PORT,
        username: c.CLEARINGHOUSE_SFTP_USERNAME ?? '',
        password: c.CLEARINGHOUSE_SFTP_PASSWORD ?? '',
        uploadPath: c.CLEARINGHOUSE_UPLOAD_PATH,
        downloadPaths: c.CLEARINGHOUSE_DOWNLOAD_PATHS,
        fileExtension: c.CLEARINGHOUSE_FILE_EXTENSION,
        afterDownload: c.CLEARINGHOUSE_AFTER_DOWNLOAD,
        pollMinutes: c.CLEARINGHOUSE_POLL_MINUTES
      }
    : null;
