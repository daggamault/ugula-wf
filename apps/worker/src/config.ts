import { HOST_KEY_PATTERN } from '@ugula/billing';
import {
  dbEnvEntries,
  inferenceEnvEntries,
  nonEmpty,
  portInt,
  posInt,
  redisEnvEntries,
  s3EnvEntries,
  secretKeyEnvEntries
} from '@ugula/config';
import * as v from 'valibot';
import type { ConnectionSettings } from './shared/clearinghouse.ts';

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

const extension = v.pipe(v.string(), v.regex(/^\.[A-Za-z0-9]+$/));

const clearinghouseEntries = {
  CLEARINGHOUSE_SFTP_HOST: v.optional(v.pipe(v.string(), v.trim())),
  CLEARINGHOUSE_SFTP_PORT: v.optional(portInt, '22'),
  CLEARINGHOUSE_SFTP_USERNAME: v.optional(v.string()),
  CLEARINGHOUSE_SFTP_PASSWORD: v.optional(v.string()),
  CLEARINGHOUSE_SFTP_HOST_KEY: v.optional(
    v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.regex(new RegExp(HOST_KEY_PATTERN)))]),
    ''
  ),
  CLEARINGHOUSE_UPLOAD_PATH: v.optional(remotePath, '/'),
  CLEARINGHOUSE_DOWNLOAD_PATHS: v.optional(pathList, '/'),
  CLEARINGHOUSE_FILE_EXTENSION: v.optional(extension, '.txt'),
  CLEARINGHOUSE_ELIGIBILITY_EXTENSION: v.optional(extension, '.txt'),
  CLEARINGHOUSE_CLAIM_STATUS_EXTENSION: v.optional(extension, '.txt'),
  CLEARINGHOUSE_AFTER_DOWNLOAD: v.optional(v.picklist(['delete', 'keep']), 'delete'),
  CLEARINGHOUSE_REALTIME_URL: v.optional(
    v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.url())]),
    ''
  ),
  CLEARINGHOUSE_REALTIME_TIMEOUT_SECONDS: v.optional(v.pipe(posInt, v.maxValue(300)), '30'),
  CLEARINGHOUSE_POLL_MINUTES: v.optional(v.pipe(posInt, v.maxValue(59)), '1')
};

const baseSchema = v.object({
  ...dbEnvEntries,
  ...redisEnvEntries,
  ...s3EnvEntries,
  ...inferenceEnvEntries,
  ...secretKeyEnvEntries,
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
      (Boolean(c.CLEARINGHOUSE_SFTP_USERNAME) &&
        Boolean(c.CLEARINGHOUSE_SFTP_PASSWORD) &&
        Boolean(c.CLEARINGHOUSE_SFTP_HOST_KEY)),
    'CLEARINGHOUSE_SFTP_USERNAME, CLEARINGHOUSE_SFTP_PASSWORD and CLEARINGHOUSE_SFTP_HOST_KEY are required with CLEARINGHOUSE_SFTP_HOST'
  )
);

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);

export const clearinghouseOf = (c: Config): ConnectionSettings | null =>
  c.CLEARINGHOUSE_SFTP_HOST
    ? {
        host: c.CLEARINGHOUSE_SFTP_HOST,
        port: c.CLEARINGHOUSE_SFTP_PORT,
        username: c.CLEARINGHOUSE_SFTP_USERNAME ?? '',
        password: c.CLEARINGHOUSE_SFTP_PASSWORD ?? '',
        hostKey: c.CLEARINGHOUSE_SFTP_HOST_KEY,
        uploadPath: c.CLEARINGHOUSE_UPLOAD_PATH,
        downloadPaths: c.CLEARINGHOUSE_DOWNLOAD_PATHS,
        extensions: {
          claims: c.CLEARINGHOUSE_FILE_EXTENSION,
          eligibility: c.CLEARINGHOUSE_ELIGIBILITY_EXTENSION,
          claimStatus: c.CLEARINGHOUSE_CLAIM_STATUS_EXTENSION
        },
        afterDownload: c.CLEARINGHOUSE_AFTER_DOWNLOAD,
        realtimeUrl: c.CLEARINGHOUSE_REALTIME_URL || null
      }
    : null;
