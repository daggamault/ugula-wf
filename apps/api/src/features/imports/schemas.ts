import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

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
  virtual_path: v.pipe(v.string(), v.nonEmpty(), v.maxLength(1024)),
  file_size: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  status: v.number()
});

export type SftpEvent = v.InferOutput<typeof sftpEventSchema>;

const IMPORT_SORTS = [
  'received',
  'file',
  'reports',
  'claims',
  'charges',
  'status',
  'attention'
] as const;

export type ImportSort = (typeof IMPORT_SORTS)[number];

export const listImportsQuery = v.object({
  q: searchText,
  ...pageEntries(IMPORT_SORTS, 'received', 'desc')
});

const REPORT_SORTS = ['position', 'pcr', 'patient', 'status', 'claim', 'total'] as const;

export type ReportSort = (typeof REPORT_SORTS)[number];

export const listReportsQuery = v.object(pageEntries(REPORT_SORTS, 'position', 'asc'));
