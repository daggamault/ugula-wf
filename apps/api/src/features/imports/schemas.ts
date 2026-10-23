import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';

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

export const IMPORT_SORTS = ['received', 'file', 'reports', 'claims', 'charges'] as const;

export type ImportSort = (typeof IMPORT_SORTS)[number];

export const listImportsQuery = v.object(pageEntries(IMPORT_SORTS, 'received', 'desc'));
