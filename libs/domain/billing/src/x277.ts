import { componentsOf, readX12, textOf, transactionsOf, type X12File } from './x12.ts';

export type ClaimAcknowledgment = {
  claimNumber: string;
  status: 'accepted' | 'rejected' | 'pending';
  categories: string[];
  payerClaimNumber: string | null;
  message: string;
};

const CATEGORIES: Readonly<Record<string, string>> = {
  A0: 'Forwarded to another entity',
  A1: 'Received',
  A2: 'Accepted into adjudication',
  A3: 'Returned as unprocessable',
  A4: 'Not found',
  A5: 'Split claim',
  A6: 'Rejected for missing information',
  A7: 'Rejected for invalid information',
  A8: 'Rejected for relational field error'
};

const ACCEPTED = ['A0', 'A1', 'A2', 'A5'];

const REJECTED = ['A3', 'A4', 'A6', 'A7', 'A8'];

const PATIENT_LEVEL = 'PT';

const STATUS_ELEMENTS = [1, 10, 11];

type Draft = {
  claimNumber: string | null;
  categories: string[];
  payerClaimNumber: string | null;
  texts: string[];
};

const statusOf = (categories: string[]): ClaimAcknowledgment['status'] =>
  categories.some((c) => REJECTED.includes(c))
    ? 'rejected'
    : categories.some((c) => ACCEPTED.includes(c))
      ? 'accepted'
      : 'pending';

const finish = (d: Draft): ClaimAcknowledgment[] =>
  d.claimNumber
    ? [
        {
          claimNumber: d.claimNumber,
          status: statusOf(d.categories),
          categories: [...new Set(d.categories)],
          payerClaimNumber: d.payerClaimNumber,
          message:
            d.texts.join('; ') ||
            [...new Set(d.categories)].flatMap((c) => CATEGORIES[c] ?? []).join('; ')
        }
      ]
    : [];

const claimsOf = (segments: string[][], file: X12File) => {
  const claims: ClaimAcknowledgment[] = [];
  let draft: Draft | null = null;
  for (const seg of segments) {
    if (seg[0] === 'HL') {
      if (draft) claims.push(...finish(draft));
      draft =
        seg[3] === PATIENT_LEVEL
          ? { claimNumber: null, categories: [], payerClaimNumber: null, texts: [] }
          : null;
      continue;
    }
    if (!draft) continue;
    if (seg[0] === 'TRN' && seg[1] === '2') draft.claimNumber ??= textOf(seg[2]);
    if (seg[0] === 'REF' && seg[1] === '1K') draft.payerClaimNumber ??= textOf(seg[2]);
    if (seg[0] === 'STC') {
      for (const i of STATUS_ELEMENTS) {
        const [category] = componentsOf(seg[i], file);
        if (category?.trim()) draft.categories.push(category.trim());
      }
      const text = textOf(seg[12]);
      if (text) draft.texts.push(text);
    }
  }
  if (draft) claims.push(...finish(draft));
  return claims;
};

export const read277 = (text: string): ClaimAcknowledgment[] => {
  const file = readX12(text);
  return transactionsOf(file, '277').flatMap((segments) => claimsOf(segments, file));
};
