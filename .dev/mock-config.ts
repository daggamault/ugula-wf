import { nonEmpty, portInt } from '@ugula/config';
import * as v from 'valibot';

const seconds = v.pipe(nonEmpty, v.transform(Number), v.number(), v.integer(), v.minValue(0));

const mockConfigSchema = v.pipe(
  v.object({
    CLEARINGHOUSE_SFTP_HOST: v.optional(nonEmpty, 'localhost'),
    CLEARINGHOUSE_SFTP_PORT: portInt,
    CLEARINGHOUSE_SFTP_USERNAME: nonEmpty,
    CLEARINGHOUSE_SFTP_PASSWORD: nonEmpty,
    CLEARINGHOUSE_REMIT_DELAY_SECONDS: v.optional(seconds, '20'),
    CLEARINGHOUSE_REALTIME_PORT: v.optional(portInt, '2224'),
    CLEARINGHOUSE_ERA_UNENROLLED: v.optional(v.string(), '')
  }),
  v.transform((c) => ({
    host: c.CLEARINGHOUSE_SFTP_HOST,
    port: c.CLEARINGHOUSE_SFTP_PORT,
    credentials: {
      username: c.CLEARINGHOUSE_SFTP_USERNAME,
      password: c.CLEARINGHOUSE_SFTP_PASSWORD
    },
    remitDelayMs: c.CLEARINGHOUSE_REMIT_DELAY_SECONDS * 1000,
    realtimePort: c.CLEARINGHOUSE_REALTIME_PORT,
    eraUnenrolled: new Set(
      c.CLEARINGHOUSE_ERA_UNENROLLED.split(',')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
    )
  }))
);

type MockConfig = v.InferOutput<typeof mockConfigSchema>;

export const parseMockConfig = (raw: Record<string, string | undefined>): MockConfig =>
  v.parse(mockConfigSchema, raw);
