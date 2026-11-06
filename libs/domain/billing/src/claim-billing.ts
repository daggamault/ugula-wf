import { isRecord } from '@ugula/graph';
import type { CodeRef } from './code-sets.ts';

export type ClaimBilling = {
  payer: string;
  placeOfService: string | null;
  modifiers: string[][];
};

export const MAP_837P_RULE = 'billing.map-837p';

const texts = (x: unknown) =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && v !== '') : [];

export const claimBillingOf = (payer: string, x837: unknown): ClaimBilling | null => {
  if (!isRecord(x837) || !Array.isArray(x837.lines)) return null;
  return {
    payer,
    placeOfService: typeof x837.placeOfService === 'string' ? x837.placeOfService : null,
    modifiers: x837.lines.map((l) => (isRecord(l) ? texts(l.modifiers) : []))
  };
};

export const billingCodeRefs = (billing: ClaimBilling | null): CodeRef[] =>
  billing
    ? [
        ...billing.modifiers.flat().map((code): CodeRef => ({ set: 'modifier', code })),
        ...(billing.placeOfService ? [{ set: 'pos', code: billing.placeOfService } as const] : [])
      ]
    : [];
