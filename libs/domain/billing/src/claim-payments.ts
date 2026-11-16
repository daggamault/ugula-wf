import {
  ADJUSTMENT_REASON_PATTERN,
  type Adjustment,
  isAdjustmentGroup,
  mergedAdjustments
} from './claims.ts';
import type { RemittanceLine, RemittancePosting, RemittanceRoute } from './remittances.ts';
import { textOrNull } from './values.ts';

export const PAYMENT_KINDS = { response: 'Payment', refunded: 'Refund' } as const;

type PaymentKind = keyof typeof PAYMENT_KINDS;

export type ManualPayment = {
  kind: PaymentKind;
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  route: RemittanceRoute | null;
  paidOn: string | null;
  checkNumber: string | null;
  payerClaimNumber: string | null;
  adjustments: Adjustment[];
  note: string;
};

type PaymentEntry = {
  kind?: unknown;
  coverageId?: unknown;
  paid?: unknown;
  paidOn?: unknown;
  checkNumber?: unknown;
  payerClaimNumber?: unknown;
  reasonCodes?: unknown;
  note?: unknown;
};

const MAX_CENTS = 100_000_000;

const REASON = new RegExp(ADJUSTMENT_REASON_PATTERN);

const REASON_LINE = /^([A-Z]{2})\s*-?\s*([A-Z0-9]+)\s+(-?\d+(?:\.\d{1,2})?)$/;

const POSTABLE: readonly RemittanceRoute[] = ['reconcile', 'denial', 'appeal', 'fix'];

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

export const readPayment = (
  entry: PaymentEntry,
  posting: RemittancePosting | null = null
): ManualPayment | string => {
  const kind = textOrNull(entry.kind) ?? 'response';
  if (!Object.hasOwn(PAYMENT_KINDS, kind)) return `Unknown payment type "${kind}"`;
  const isRefund = kind === 'refunded';
  const paidCents = centsOf(entry.paid);
  if (paidCents === null) return 'Enter amounts of zero or more';
  const coverageId = textOrNull(entry.coverageId);
  if (isRefund && paidCents === 0) return 'A refund needs the amount paid back';
  const lines = Array.isArray(entry.reasonCodes)
    ? entry.reasonCodes.filter((l): l is string => typeof l === 'string' && Boolean(l.trim()))
    : [];
  if (paidCents === 0 && coverageId === null) return 'A patient payment needs an amount';
  if (isRefund && lines.length) return 'A refund carries no reason codes';
  const adjustments = lines.map(readReasonCode);
  const bad = lines.find((_, i) => adjustments[i] === null);
  if (bad !== undefined) {
    return `Write each reason code as a group, code and amount, like CO-45 12.50 (not "${bad.trim()}")`;
  }
  const routed = isRefund ? null : posting;
  if (routed && !POSTABLE.includes(routed.route)) {
    return routed.message || 'Remittance Routing leaves this payment to be posted another way';
  }
  if (routed && routed.adjustedCents < 0) {
    return 'The adjustments that lower the balance add up to less than zero';
  }
  return {
    kind: isRefund ? 'refunded' : 'response',
    coverageId,
    paidCents,
    adjustedCents: routed?.adjustedCents ?? 0,
    route: routed?.route ?? null,
    paidOn: textOrNull(entry.paidOn),
    checkNumber: textOrNull(entry.checkNumber),
    payerClaimNumber: coverageId && !isRefund ? textOrNull(entry.payerClaimNumber) : null,
    adjustments: adjustments.filter((a) => a !== null),
    note: textOrNull(entry.note) ?? ''
  };
};

export const paymentLine = (claimId: string, payment: ManualPayment): RemittanceLine => ({
  position: 0,
  reference: payment.payerClaimNumber ?? '',
  claimId,
  coverageId: payment.coverageId,
  payerName: null,
  status: '',
  remarks: [],
  crossoverPayer: null,
  denied: false,
  reversal: false,
  reversesPosted: false,
  takeback: false,
  paidCents: payment.paidCents,
  adjustments: mergedAdjustments(payment.adjustments)
});
