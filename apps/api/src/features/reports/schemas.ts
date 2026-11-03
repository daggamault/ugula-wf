import * as v from 'valibot';

const slug = v.pipe(v.string(), v.regex(/^[a-z-]{1,32}$/));

export const reportParam = v.object({ id: slug });

const isoDay = v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01'));

export const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const timeZone = v.pipe(
  v.string(),
  v.maxLength(64),
  v.check(isTimeZone, 'Use a time zone like America/New_York')
);

export const reportQuery = v.pipe(
  v.object({
    from: v.optional(isoDay),
    to: v.optional(isoDay),
    tz: v.optional(timeZone, 'UTC'),
    group: v.optional(slug),
    page: v.optional(
      v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
      '1'
    ),
    all: v.optional(v.picklist(['true', 'false']), 'false')
  }),
  v.check(
    ({ from, to }) => !from || !to || from <= to,
    'The start date must be before the end date'
  ),
  v.transform(({ page, all, ...rest }) => ({
    ...rest,
    page: all === 'true' ? ('all' as const) : page
  }))
);

export type ReportQuery = v.InferOutput<typeof reportQuery>;

export type ReportPage = ReportQuery['page'];
