import { valuesSchema } from '@ugula/graph';
import * as v from 'valibot';
import { limitQuery } from '../../shared/http.ts';

export const listTasksQuery = v.object({
  queue: v.optional(v.pipe(v.string(), v.nonEmpty())),
  status: v.optional(v.picklist(['open', 'completed', 'cancelled']), 'open'),
  mine: v.optional(v.picklist(['true', 'false']), 'false'),
  limit: limitQuery
});

export const nextTaskSchema = v.object({ queue: v.pipe(v.string(), v.nonEmpty()) });

export const completeTaskSchema = v.object({
  outcome: v.pipe(v.string(), v.nonEmpty()),
  values: v.optional(valuesSchema, {})
});
