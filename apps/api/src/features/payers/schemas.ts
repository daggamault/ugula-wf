import { CLAIM_FILING_CODES, type ClaimFilingCode } from '@ugula/billing';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

export const payerSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(60)),
  payerId: v.pipe(
    v.string(),
    v.trim(),
    v.regex(/^[A-Za-z0-9]{2,80}$/, 'A clearinghouse payer ID is 2 to 80 letters or digits')
  ),
  claimFiling: v.picklist(Object.keys(CLAIM_FILING_CODES) as ClaimFilingCode[])
});

export type PayerInput = v.InferOutput<typeof payerSchema>;

export const aliasParams = v.object({ id: uuid, aliasId: uuid });

const PAYER_SORTS = ['name', 'payerId', 'filing'] as const;

export type PayerSort = (typeof PAYER_SORTS)[number];

export const searchPayersQuery = v.object({
  q: searchText,
  ...pageEntries(PAYER_SORTS, 'name', 'asc')
});

export const payerNamesQuery = v.object({ q: searchText });
