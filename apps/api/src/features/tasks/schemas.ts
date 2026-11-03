import { valuesSchema } from '@ugula/graph';
import * as v from 'valibot';

export const nextTaskSchema = v.object({
  queue: v.optional(v.nullable(v.pipe(v.string(), v.nonEmpty())), null)
});

export const completeTaskSchema = v.object({
  outcome: v.pipe(v.string(), v.nonEmpty()),
  values: v.optional(valuesSchema, {})
});
