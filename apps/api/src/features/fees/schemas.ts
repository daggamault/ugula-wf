import * as v from 'valibot';

export const MAX_FEE_CENTS = 10_000_000;

export const feeSchema = v.object({
  payer: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.trim(),
        v.transform((s) => s || null)
      )
    ),
    null
  ),
  code: v.pipe(
    v.string(),
    v.trim(),
    v.toUpperCase(),
    v.regex(/^[A-Z]\d{4}$/, 'Enter a HCPCS code like A0427')
  ),
  amountCents: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_FEE_CENTS))
});

export type FeeInput = v.InferOutput<typeof feeSchema>;
