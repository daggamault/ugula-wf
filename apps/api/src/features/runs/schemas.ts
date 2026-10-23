import { valuesSchema } from '@ugula/graph';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';

export const startRunSchema = v.object({
  graphId: uuid,
  version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  inputs: v.optional(valuesSchema, {})
});

export const RUN_SORTS = ['started', 'workflow', 'status', 'finished'] as const;

export type RunSort = (typeof RUN_SORTS)[number];

export const listRunsQuery = v.object({
  status: v.optional(
    v.picklist(['running', 'suspended', 'completed', 'faulted', 'failed', 'cancelled'])
  ),
  graphId: v.optional(uuid),
  root: v.optional(v.picklist(['true', 'false']), 'true'),
  ...pageEntries(RUN_SORTS, 'started', 'desc')
});

export const stepsQuery = v.object({
  path: v.optional(v.string()),
  node: v.optional(v.string()),
  after: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(0)), '0'),
  limit: v.optional(
    v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(2000)),
    '500'
  )
});

export const signalSchema = v.object({
  name: v.pipe(v.string(), v.nonEmpty()),
  key: v.pipe(v.string(), v.nonEmpty()),
  payload: v.optional(v.unknown(), null)
});
