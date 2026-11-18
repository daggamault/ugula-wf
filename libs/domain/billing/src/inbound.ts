import { type Adjudication, type Adjustment, mergedAdjustments } from './adjudications.ts';
import { readX12 } from './x12.ts';
import { read277 } from './x277.ts';
import type { Remittance, RemittanceClaim } from './x835.ts';
import { read999 } from './x999.ts';

export const CLEARINGHOUSE_FILE_KINDS = ['ta1', '999', '277ca', '835', 'other'] as const;

export type ClearinghouseFileKind = (typeof CLEARINGHOUSE_FILE_KINDS)[number];

export const ACKNOWLEDGMENT_KINDS: readonly ClearinghouseFileKind[] = ['ta1', '999', '277ca'];

const KINDS: Readonly<Record<string, ClearinghouseFileKind>> = {
  TA1: 'ta1',
  '999': '999',
  '277': '277ca',
  '835': '835'
};

export const fileKindOf = (text: string): ClearinghouseFileKind => {
  try {
    return KINDS[readX12(text).kind ?? ''] ?? 'other';
  } catch {
    return 'other';
  }
};

const TA1_NOTES: Readonly<Record<string, string>> = {
  '000': 'No error',
  '001': 'The interchange control numbers in the header and trailer do not match',
  '005': 'Invalid interchange sender ID',
  '006': 'Invalid interchange sender ID qualifier',
  '007': 'Invalid interchange receiver ID qualifier',
  '008': 'Invalid interchange receiver ID',
  '014': 'Invalid interchange date',
  '022': 'Invalid control characters',
  '024': 'Invalid interchange content'
};

const TA1_REJECTED = 'R';

export type Acknowledgment =
  | { by: 'controlNumber'; controlNumber: number; accepted: boolean; note: string }
  | {
      by: 'claimNumber';
      claimNumber: string;
      status: 'accepted' | 'rejected' | 'pending';
      payerClaimNumber: string | null;
      note: string;
    };

const controlNumberOf = (x: string | undefined) => {
  const n = Number(x?.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

const readTa1 = (text: string): Acknowledgment[] =>
  readX12(text).segments.flatMap((s) => {
    const controlNumber = controlNumberOf(s[1]);
    if (s[0] !== 'TA1' || controlNumber === null) return [];
    const code = s[5]?.trim() ?? '';
    return [
      {
        by: 'controlNumber' as const,
        controlNumber,
        accepted: s[4]?.trim() !== TA1_REJECTED,
        note: `The clearinghouse rejected the file: ${TA1_NOTES[code] ?? `TA1 note ${code}`}`
      }
    ];
  });

const read999Acks = (text: string): Acknowledgment[] =>
  read999(text).flatMap((g) => {
    const controlNumber = controlNumberOf(g.groupControlNumber);
    if (controlNumber === null) return [];
    const errors = g.transactions.flatMap((t) => t.errors);
    return [
      {
        by: 'controlNumber' as const,
        controlNumber,
        accepted: g.accepted,
        note: g.accepted
          ? ''
          : `The clearinghouse rejected the 837P: ${errors.join('; ') || 'syntax errors'}`
      }
    ];
  });

const read277Acks = (text: string): Acknowledgment[] =>
  read277(text).map((c) => ({
    by: 'claimNumber' as const,
    claimNumber: c.claimNumber,
    status: c.status,
    payerClaimNumber: c.payerClaimNumber,
    note: c.message
  }));

export const acknowledgmentsOf = (kind: ClearinghouseFileKind, text: string): Acknowledgment[] => {
  switch (kind) {
    case 'ta1':
      return readTa1(text);
    case '999':
      return read999Acks(text);
    case '277ca':
      return read277Acks(text);
    default:
      return [];
  }
};

export const PAYMENT_OUTCOMES = ['paid', 'denied', 'forwarded', 'reversed'] as const;

export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

const FORWARDED_STATUSES: readonly string[] = ['19', '20', '21'];

export const paymentOutcomeOf = (c: RemittanceClaim): PaymentOutcome =>
  c.reversal
    ? 'reversed'
    : c.denied
      ? 'denied'
      : FORWARDED_STATUSES.includes(c.status) || c.crossoverPayer
        ? 'forwarded'
        : 'paid';

export const patientCentsOf = (adjustments: readonly Adjustment[]) =>
  adjustments.filter((a) => a.group === 'PR').reduce((sum, a) => sum + a.cents, 0);

export const adjudicationOf = (c: RemittanceClaim, paidOn: string): Adjudication => ({
  paidCents: c.paidCents,
  adjustedCents: c.chargeCents - c.paidCents,
  paidOn,
  adjustments: mergedAdjustments(c.adjustments),
  lines: c.services.map((s, i) => ({
    line: controlNumberOf(s.lineNumber ?? undefined) ?? i + 1,
    code: s.originalCode ?? s.code,
    modifiers: s.modifiers,
    paidCents: s.paidCents,
    units: s.units,
    adjustments: mergedAdjustments(s.adjustments)
  }))
});

export const providerAdjustmentCentsOf = (r: Remittance) =>
  r.providerAdjustments.reduce((sum, a) => sum + a.cents, 0);

export const claimPaidCentsOf = (r: Remittance) =>
  r.claims.reduce((sum, c) => sum + c.paidCents, 0);

export const isBalanced = (r: Remittance) =>
  r.totalCents === claimPaidCentsOf(r) - providerAdjustmentCentsOf(r);
