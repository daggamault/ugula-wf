import * as v from 'valibot';
import { limitQuery } from '../../shared/http.ts';

const graphKey = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/));

export const importFormSchema = v.object({
  file: v.instance(File),
  workflow: v.optional(graphKey, 'billing.ingest-nemsis')
});

export const sftpAuthSchema = v.looseObject({
  username: v.pipe(v.string(), v.nonEmpty()),
  password: v.optional(v.string(), '')
});

export const sftpEventSchema = v.looseObject({
  action: v.string(),
  username: v.pipe(v.string(), v.nonEmpty()),
  virtual_path: v.pipe(v.string(), v.nonEmpty()),
  file_size: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  status: v.number()
});

export type SftpEvent = v.InferOutput<typeof sftpEventSchema>;

export const listImportsQuery = v.object({ limit: limitQuery });
