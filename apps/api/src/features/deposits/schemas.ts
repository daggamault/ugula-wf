import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

const optionalText = (max: number) =>
  v.optional(
    v.pipe(
      v.nullable(v.string()),
      v.transform((s) => s?.trim() || null),
      v.nullable(v.pipe(v.string(), v.maxLength(max)))
    ),
    null
  );

export const depositSchema = v.object({
  traceNumber: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(50)),
  amountCents: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2_000_000_000)),
  depositedOn: v.pipe(v.string(), v.isoDate('Use a date like 2026-11-02')),
  payerName: optionalText(80),
  note: optionalText(500)
});

export type DepositInput = v.InferOutput<typeof depositSchema>;

const DEPOSIT_SORTS = ['deposited', 'amount', 'trace'] as const;

export type DepositSort = (typeof DEPOSIT_SORTS)[number];

export const searchDepositsQuery = v.object({
  q: searchText,
  ...pageEntries(DEPOSIT_SORTS, 'deposited', 'desc')
});
