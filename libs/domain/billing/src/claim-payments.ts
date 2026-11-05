import { ADJUSTMENT_REASON_PATTERN, type Adjustment, isAdjustmentGroup } from './claims.ts';
import { textOrNull } from './values.ts';

export const PAYMENT_KINDS = { response: 'Payment', refunded: 'Refund' } as const;

export type PaymentKind = keyof typeof PAYMENT_KINDS;

export type ManualPayment = {
  kind: PaymentKind;
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  paidOn: string | null;
  checkNumber: string | null;
  payerClaimNumber: string | null;
  adjustments: Adjustment[];
  note: string;
};

export type PaymentEntry = {
  kind?: unknown;
  coverageId?: unknown;
  paid?: unknown;
  adjusted?: unknown;
  paidOn?: unknown;
  checkNumber?: unknown;
  payerClaimNumber?: unknown;
  reasonCodes?: unknown;
  note?: unknown;
};

const MAX_CENTS = 100_000_000;

const REASON = new RegExp(ADJUSTMENT_REASON_PATTERN);

const REASON_LINE = /^([A-Z]{2})\s*-?\s*([A-Z0-9]+)\s+(-?\d+(?:\.\d{1,2})?)$/;

const centsOf = (x: unknown) => {
  if (x === null || x === undefined) return 0;
  const cents = typeof x === 'number' ? Math.round(x * 100) : Number.NaN;
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_CENTS ? cents : null;
};

export const readReasonCode = (line: string): Adjustment | null => {
  const [, group, reason, amount] = REASON_LINE.exec(line.trim().toUpperCase()) ?? [];
  const cents = Math.round(Number(amount) * 100);
  return isAdjustmentGroup(group) && reason && REASON.test(reason) && cents
    ? { group, reason, cents }
    : null;
};

export const readPayment = (entry: PaymentEntry): ManualPayment | string => {
  const kind = textOrNull(entry.kind) ?? 'response';
  if (!Object.hasOwn(PAYMENT_KINDS, kind)) return `Unknown payment type "${kind}"`;
  const isRefund = kind === 'refunded';
  const paidCents = centsOf(entry.paid);
  const adjustedCents = isRefund ? 0 : centsOf(entry.adjusted);
  if (paidCents === null || adjustedCents === null) return 'Enter amounts of zero or more';
  const coverageId = textOrNull(entry.coverageId);
  if (isRefund && paidCents === 0) return 'A refund needs the amount paid back';
  if (paidCents + adjustedCents === 0 && coverageId === null) {
    return 'A patient payment needs an amount';
  }
  const lines = Array.isArray(entry.reasonCodes)
    ? entry.reasonCodes.filter((l): l is string => typeof l === 'string' && Boolean(l.trim()))
    : [];
  if (isRefund && lines.length) return 'A refund carries no reason codes';
  const adjustments = lines.map(readReasonCode);
  const bad = lines.find((_, i) => adjustments[i] === null);
  if (bad !== undefined) {
    return `Write each reason code as a group, code and amount, like CO-45 12.50 (not "${bad.trim()}")`;
  }
  return {
    kind: isRefund ? 'refunded' : 'response',
    coverageId,
    paidCents,
    adjustedCents,
    paidOn: textOrNull(entry.paidOn),
    checkNumber: textOrNull(entry.checkNumber),
    payerClaimNumber: coverageId && !isRefund ? textOrNull(entry.payerClaimNumber) : null,
    adjustments: adjustments.filter((a) => a !== null),
    note: textOrNull(entry.note) ?? ''
  };
};
