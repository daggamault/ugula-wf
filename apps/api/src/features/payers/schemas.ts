import { CLAIM_FILING_CODES, type ClaimFilingCode } from '@ugula/billing';
import * as v from 'valibot';

export const payerSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(60)),
  payerId: v.pipe(
    v.string(),
    v.trim(),
    v.regex(/^[A-Za-z0-9]{2,80}$/, 'A payer ID is 2 to 80 letters or digits')
  ),
  claimFiling: v.picklist(Object.keys(CLAIM_FILING_CODES) as ClaimFilingCode[])
});

export type PayerInput = v.InferOutput<typeof payerSchema>;
