import { centsOf, componentsOf, readX12, textOf, transactionsOf, type X12File } from './x12.ts';

const CLAIM_STATUS_MEANINGS = [
  'inProcess',
  'pending',
  'paid',
  'denied',
  'finalized',
  'rejected',
  'notFound',
  'moreInfo',
  'unavailable'
] as const;

export type ClaimStatusMeaning = (typeof CLAIM_STATUS_MEANINGS)[number];

export type PayerClaimStatus = {
  trace: string;
  claimNumber: string;
  payerClaimNumber: string | null;
  category: string;
  code: string;
  meaning: ClaimStatusMeaning;
  chargeCents: number;
  paidCents: number;
  message: string;
};

const CATEGORIES: Readonly<Record<string, [ClaimStatusMeaning, string]>> = {
  A0: ['inProcess', 'Forwarded to another entity'],
  A1: ['inProcess', 'Received'],
  A2: ['inProcess', 'Accepted into adjudication'],
  A3: ['rejected', 'Returned as unprocessable'],
  A4: ['notFound', 'Not found'],
  A5: ['inProcess', 'Split claim'],
  A6: ['rejected', 'Rejected for missing information'],
  A7: ['rejected', 'Rejected for invalid information'],
  A8: ['rejected', 'Rejected for relational field error'],
  P0: ['pending', 'Pending: adjudication or details'],
  P1: ['pending', 'Pending: in process'],
  P2: ['pending', 'Pending: payer review'],
  P3: ['moreInfo', 'Pending: provider requested information'],
  P4: ['moreInfo', 'Pending: patient requested information'],
  P5: ['pending', 'Pending: payer administrative or system hold'],
  F0: ['finalized', 'Finalized'],
  F1: ['paid', 'Finalized: payment'],
  F2: ['denied', 'Finalized: denial'],
  F3: ['finalized', 'Finalized: revised'],
  F3F: ['finalized', 'Finalized: forwarded'],
  F3N: ['finalized', 'Finalized: not forwarded'],
  F4: ['finalized', 'Finalized: adjudication complete, no payment forthcoming'],
  R0: ['moreInfo', 'Requests for additional information: general'],
  R1: ['moreInfo', 'Requests for additional information: entity requests'],
  R3: ['moreInfo', 'Requests for additional information: claim or line'],
  R4: ['moreInfo', 'Requests for additional information: documentation'],
  R5: ['moreInfo', 'Requests for more specific detail'],
  E0: ['unavailable', 'Response not possible: error on submitted request'],
  E1: ['unavailable', 'Response not possible: system status'],
  E2: ['unavailable', 'Information holder is not responding'],
  E3: ['unavailable', 'Correction required: relational fields in error'],
  E4: ['unavailable', 'Trading partner agreement specific requirement not met'],
  D0: ['notFound', 'Data search unsuccessful']
};

const CODES: Readonly<Record<string, string>> = {
  '1': 'For more detailed information, see remittance advice',
  '3': 'Claim has been adjudicated and is awaiting payment cycle',
  '15': 'Requested information not provided as described',
  '20': 'Accepted for processing',
  '21': 'Missing or invalid information',
  '35': 'Claim not found',
  '65': 'Claim has been paid',
  '88': 'Entity not eligible for benefits for submitted dates of service',
  '107': 'Processed according to contract provisions'
};

const CLAIM_LEVELS = ['22', '23'];

type Draft = {
  trace: string | null;
  claimNumber: string | null;
  payerClaimNumber: string | null;
  stc: string[] | null;
};

const blank = (): Draft => ({ trace: null, claimNumber: null, payerClaimNumber: null, stc: null });

const finish = (d: Draft, file: X12File): PayerClaimStatus[] => {
  if (!d.stc || !(d.trace || d.claimNumber)) return [];
  const [category = '', code = ''] = componentsOf(d.stc[1], file).map((c) => c.trim());
  const [meaning, description] = CATEGORIES[category] ?? ['pending', `Status ${category}`];
  const detail = textOf(d.stc[12]) ?? CODES[code] ?? (code ? `Status code ${code}` : null);
  return [
    {
      trace: d.trace ?? d.claimNumber ?? '',
      claimNumber: d.claimNumber ?? d.trace ?? '',
      payerClaimNumber: d.payerClaimNumber,
      category,
      code,
      meaning,
      chargeCents: centsOf(d.stc[4]),
      paidCents: centsOf(d.stc[5]),
      message: [description, detail].filter(Boolean).join(': ')
    }
  ];
};

const statusesOf = (segments: string[][], file: X12File) => {
  const out: PayerClaimStatus[] = [];
  let draft: Draft | null = null;
  for (const seg of segments) {
    if (seg[0] === 'HL') {
      if (draft?.stc) out.push(...finish(draft, file));
      draft = CLAIM_LEVELS.includes(seg[3] ?? '') ? blank() : null;
      continue;
    }
    if (!draft) continue;
    if (seg[0] === 'TRN' && seg[1] === '2') {
      if (draft.stc) {
        out.push(...finish(draft, file));
        draft = blank();
      }
      draft.trace = textOf(seg[2]);
    }
    if (seg[0] === 'STC') draft.stc ??= seg;
    if (seg[0] === 'REF' && seg[1] === '1K') draft.payerClaimNumber ??= textOf(seg[2]);
    if (seg[0] === 'REF' && seg[1] === 'EJ') draft.claimNumber ??= textOf(seg[2]);
  }
  if (draft) out.push(...finish(draft, file));
  return out;
};

export const readClaimStatus = (text: string): PayerClaimStatus[] => {
  const file = readX12(text);
  return transactionsOf(file, '277').flatMap((segments) => statusesOf(segments, file));
};

const CLAIM_STATUS_LABELS: Record<ClaimStatusMeaning, string> = {
  inProcess: 'In process',
  pending: 'Pending',
  paid: 'Paid',
  denied: 'Denied',
  finalized: 'Finalized',
  rejected: 'Rejected',
  notFound: 'Not on file',
  moreInfo: 'Needs information',
  unavailable: 'No answer'
};

export const claimStatusNote = (
  s: Pick<PayerClaimStatus, 'meaning' | 'category' | 'code' | 'message'>
) =>
  `${CLAIM_STATUS_LABELS[s.meaning]} (${[s.category, s.code].filter(Boolean).join(':')}): ${s.message}`;
