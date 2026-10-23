import * as v from 'valibot';

const isoDay = v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01'));

export const rangeQuery = v.pipe(
  v.object({ from: v.optional(isoDay), to: v.optional(isoDay) }),
  v.check(
    ({ from, to }) => !from || !to || from <= to,
    'The start date must be before the end date'
  )
);

export type RangeQuery = v.InferOutput<typeof rangeQuery>;
