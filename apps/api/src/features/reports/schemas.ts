import * as v from 'valibot';

const day = v.optional(v.pipe(v.string(), v.isoDate('Use a date like 2026-11-01')));

export const remittanceReportQuery = v.pipe(
  v.object({
    from: day,
    to: day,
    payer: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)))
  }),
  v.check(
    ({ from, to }) => !from || !to || from <= to,
    'The start of the period must not be after its end'
  )
);

export type RemittanceReportQuery = v.InferOutput<typeof remittanceReportQuery>;
