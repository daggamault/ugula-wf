import { RUN_STATUSES } from '@ugula/db';
import { valuesSchema } from '@ugula/graph';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

export const startRunSchema = v.object({
  graphId: uuid,
  version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  inputs: v.optional(valuesSchema, {})
});

const RUN_SORTS = ['started', 'workflow', 'status', 'finished'] as const;

export type RunSort = (typeof RUN_SORTS)[number];

export const listRunsQuery = v.object({
  q: searchText,
  status: v.optional(v.picklist(RUN_STATUSES)),
  graphId: v.optional(uuid),
  root: v.optional(v.picklist(['true', 'false']), 'true'),
  ...pageEntries(RUN_SORTS, 'started', 'desc')
});

const stepFilter = v.optional(v.pipe(v.string(), v.maxLength(200)));

export const stepsQuery = v.object({
  path: stepFilter,
  node: stepFilter,
  after: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(0)), '0'),
  limit: v.optional(
    v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(2000)),
    '500'
  )
});

export const fileFormSchema = v.object({ file: v.instance(File) });
