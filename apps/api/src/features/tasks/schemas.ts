import { valuesSchema } from '@ugula/graph';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

export const nextTaskSchema = v.object({
  queue: v.optional(v.nullable(v.pipe(v.string(), v.nonEmpty(), v.maxLength(60))), null)
});

export const completeTaskSchema = v.object({
  outcome: v.pipe(v.string(), v.nonEmpty(), v.maxLength(200)),
  values: v.optional(valuesSchema, {})
});

const TASK_SORTS = ['waiting', 'priority', 'due', 'title', 'queue', 'claim', 'assignee'] as const;

export type TaskSort = (typeof TASK_SORTS)[number];

export const listTasksQuery = v.object({
  q: searchText,
  queue: v.optional(v.pipe(v.string(), v.nonEmpty(), v.maxLength(60))),
  assignee: v.optional(v.picklist(['mine', 'unassigned', 'all']), 'all'),
  runId: v.optional(uuid),
  ...pageEntries(TASK_SORTS, 'waiting', 'asc')
});

export const taskFileSchema = v.object({ file: v.instance(File) });
