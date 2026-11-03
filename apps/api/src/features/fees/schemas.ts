import { HCPCS_PATTERN } from '@ugula/billing';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

const MAX_FEE_CENTS = 10_000_000;

export const feeSchema = v.object({
  payerId: v.optional(v.nullable(uuid), null),
  code: v.pipe(
    v.string(),
    v.trim(),
    v.toUpperCase(),
    v.regex(new RegExp(HCPCS_PATTERN), 'Enter a HCPCS code like A0427')
  ),
  amountCents: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_FEE_CENTS))
});

export type FeeInput = v.InferOutput<typeof feeSchema>;

const FEE_SORTS = ['payer', 'code', 'amount', 'updated'] as const;

export type FeeSort = (typeof FEE_SORTS)[number];

export const searchFeesQuery = v.object({
  q: searchText,
  ...pageEntries(FEE_SORTS, 'payer', 'asc')
});
