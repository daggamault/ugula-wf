export const CLAIM_EVENT_KINDS = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'response',
  'refunded',
  'payer_skipped',
  'approved',
  'edited',
  'reconciled',
  'statement',
  'revised',
  'closed',
  'accepted',
  'rejected'
] as const;

export type ClaimEventKind = (typeof CLAIM_EVENT_KINDS)[number];

export const COVERAGE_EVENT_KINDS: readonly ClaimEventKind[] = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'reconciled',
  'accepted',
  'rejected'
];

export const CYCLE_EVENT_KINDS = [
  'submitted',
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'approved',
  'reconciled',
  'statement'
] as const satisfies readonly ClaimEventKind[];

export type CycleEventKind = (typeof CYCLE_EVENT_KINDS)[number];

export const isCycleEventKind = (x: string): x is CycleEventKind =>
  (CYCLE_EVENT_KINDS as readonly string[]).includes(x);

export const PATIENT_EVENT_KINDS: readonly ClaimEventKind[] = ['statement', 'revised', 'closed'];

export const ADJUSTMENT_GROUPS = {
  CO: 'Contractual obligation',
  PR: 'Patient responsibility',
  OA: 'Other adjustment',
  PI: 'Payer initiated reduction',
  CR: 'Correction or reversal'
} as const;

export type AdjustmentGroup = keyof typeof ADJUSTMENT_GROUPS;

export const isAdjustmentGroup = (x: unknown): x is AdjustmentGroup =>
  typeof x === 'string' && Object.hasOwn(ADJUSTMENT_GROUPS, x);

export const ADJUSTMENT_REASON_PATTERN = '^[A-Z0-9]{1,5}$';

export type Adjustment = { group: AdjustmentGroup; reason: string; cents: number };

export const CLAIM_STATUSES = [
  'draft',
  'needs_review',
  'ready',
  'submitted',
  'follow_up',
  'reconcile',
  'patient_balance',
  'balance_review',
  'paid',
  'written_off',
  'collections',
  'void'
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLOSED_CLAIM_STATUSES = ['paid', 'written_off', 'collections', 'void'] as const;

export type ClosedStatus = (typeof CLOSED_CLAIM_STATUSES)[number];

export const isClosedStatus = (status: string): status is ClosedStatus =>
  (CLOSED_CLAIM_STATUSES as readonly string[]).includes(status);

export const RESTARTABLE_STATUSES = [
  'draft',
  'needs_review',
  'void'
] as const satisfies readonly ClaimStatus[];

export type LedgerCoverage = { id: string; payer: string };

export type ClaimEvent = {
  kind: ClaimEventKind;
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  payerClaimNumber: string | null;
  paidOn: string | null;
  adjustments: Adjustment[];
  note: string;
  at: string;
};

export type Adjudication = {
  paidCents: number;
  adjustedCents: number;
  paidOn: string;
  adjustments: Adjustment[];
};

export type ClaimLedger = {
  totalCents: number;
  coverages: LedgerCoverage[];
  events: ClaimEvent[];
};

const STATEMENT_LIMIT = 3;

export const PAYER_WAIT_MS = 30 * 86_400_000;

export const SUBMIT_WAIT_MS = 3 * 86_400_000;

export const STATEMENT_INTERVAL_MS = 30 * 86_400_000;

export const MIN_WAIT_MS = 60_000;

type CoverageStep = { coverage: LedgerCoverage; balanceCents: number };

export type ClaimStep =
  | ({ step: 'review' | 'submitDue' | 'reconcile' | 'followUp' } & CoverageStep)
  | ({ step: 'submit' | 'await'; waitMs: number } & CoverageStep)
  | { step: 'reviewPatient' | 'confirmPayers' | 'overpaid'; balanceCents: number }
  | { step: 'statement'; statement: number; balanceCents: number }
  | { step: 'awaitPatient'; waitMs: number; balanceCents: number }
  | { step: 'collections' | 'closed'; balanceCents: number };

const CONTACTS: readonly ClaimEventKind[] = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'rejected'
];

const REOPENING: readonly ClaimEventKind[] = ['resubmit_queued', 'rejected'];

const REJECTION_NOTE = 'The payer or clearinghouse rejected the last submission';

const latest = (events: ClaimEvent[]) =>
  events.reduce<number | null>((max, e) => {
    const t = Date.parse(e.at);
    return max === null || t > max ? t : max;
  }, null);

const adjudication = (responses: ClaimEvent[]): Adjudication => ({
  paidCents: responses.reduce((sum, e) => sum + e.paidCents, 0),
  adjustedCents: responses.reduce((sum, e) => sum + e.adjustedCents, 0),
  paidOn:
    responses
      .map((e) => e.paidOn ?? e.at.slice(0, 10))
      .toSorted()
      .at(-1) ?? '',
  adjustments: responses.flatMap((e) => e.adjustments)
});

export const claimProgress = ({ totalCents, coverages, events }: ClaimLedger) => {
  const balanceCents = events.reduce((b, e) => b - e.paidCents - e.adjustedCents, totalCents);
  const lastOf = (coverageId: string | null, kinds: readonly ClaimEventKind[]) =>
    events.findLastIndex((e) => e.coverageId === coverageId && kinds.includes(e.kind));
  const edited = events.findLastIndex((e) => e.kind === 'edited');
  const reopened = (id: string) => lastOf(id, ['resubmit_queued']);
  const isDone = (id: string) => lastOf(id, ['response', 'payer_skipped']) > reopened(id);
  const coverage = coverages.find((c) => !isDone(c.id)) ?? null;
  const contacts = events
    .filter((e) => coverage !== null && e.coverageId === coverage.id && CONTACTS.includes(e.kind))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = contacts.at(-1);
  const contacted = !last || REOPENING.includes(last.kind) ? null : Date.parse(last.at);
  const approvedAt = coverage === null ? -1 : lastOf(coverage.id, ['approved']);
  const approval =
    coverage !== null && approvedAt > Math.max(lastOf(coverage.id, CONTACTS), edited)
      ? approvedAt
      : -1;
  const unreconciled =
    coverages.find(
      (c) => lastOf(c.id, ['response']) > lastOf(c.id, ['reconciled', 'resubmit_queued'])
    ) ?? null;
  const statements = events.filter((e) => e.kind === 'statement');
  const answered = coverages.filter(
    (c) => c.id !== coverage?.id && lastOf(c.id, ['response']) >= 0
  );
  return {
    balanceCents,
    coverage,
    contacted,
    approved: approval >= 0,
    approvedAt: approval >= 0 ? Date.parse(events[approval]?.at ?? '') : null,
    patientApproved: lastOf(null, ['approved']) > edited,
    unreconciled,
    skipped: coverages
      .filter((c) => lastOf(c.id, ['payer_skipped']) > reopened(c.id))
      .map((c) => c.id),
    submittedBefore: contacts.some((e) => e.kind === 'submitted' || e.kind === 'resubmitted'),
    rejection: last?.kind === 'rejected' ? last.note || REJECTION_NOTE : null,
    payerClaimNumber:
      events.findLast((e) => e.coverageId === coverage?.id && e.payerClaimNumber !== null)
        ?.payerClaimNumber ?? null,
    priorCoverages: answered.map((c) => ({
      ...c,
      ...adjudication(events.filter((e) => e.coverageId === c.id && e.kind === 'response'))
    })),
    statements: statements.length,
    lastStatement: latest(statements)
  };
};

const waitFor = (since: number, intervalMs: number, now: Date) => {
  const remaining = since + intervalMs - now.getTime();
  return remaining > 0 ? Math.max(remaining, MIN_WAIT_MS) : 0;
};

type CyclePolicy = {
  payerWaitMs: number;
  submitWaitMs: number;
  statementLimit: number;
  statementIntervalMs: number;
};

export const DEFAULT_POLICY: CyclePolicy = {
  payerWaitMs: PAYER_WAIT_MS,
  submitWaitMs: SUBMIT_WAIT_MS,
  statementLimit: STATEMENT_LIMIT,
  statementIntervalMs: STATEMENT_INTERVAL_MS
};

const payerStep = (
  p: ReturnType<typeof claimProgress>,
  coverage: LedgerCoverage,
  now: Date,
  policy: CyclePolicy
): ClaimStep => {
  const { balanceCents, contacted, approvedAt } = p;
  if (contacted === null) {
    if (approvedAt === null) return { step: 'review', coverage, balanceCents };
    const waitMs = waitFor(approvedAt, policy.submitWaitMs, now);
    return waitMs > 0
      ? { step: 'submit', coverage, waitMs, balanceCents }
      : { step: 'submitDue', coverage, balanceCents };
  }
  const waitMs = waitFor(contacted, policy.payerWaitMs, now);
  return waitMs > 0
    ? { step: 'await', coverage, waitMs, balanceCents }
    : { step: 'followUp', coverage, balanceCents };
};

export const nextClaimStep = (
  ledger: ClaimLedger,
  now: Date,
  policy: CyclePolicy = DEFAULT_POLICY
): ClaimStep => {
  const p = claimProgress(ledger);
  const { balanceCents, coverage, unreconciled, statements, lastStatement } = p;
  if (balanceCents < 0) return { step: 'overpaid', balanceCents };
  if (balanceCents === 0) return { step: 'closed', balanceCents };
  if (unreconciled !== null) return { step: 'reconcile', coverage: unreconciled, balanceCents };
  if (coverage !== null) return payerStep(p, coverage, now, policy);
  if (statements === 0 && !p.patientApproved) {
    return { step: ledger.coverages.length ? 'reviewPatient' : 'confirmPayers', balanceCents };
  }
  const waitMs =
    lastStatement === null ? 0 : waitFor(lastStatement, policy.statementIntervalMs, now);
  if (waitMs > 0) return { step: 'awaitPatient', waitMs, balanceCents };
  return statements < policy.statementLimit
    ? { step: 'statement', statement: statements + 1, balanceCents }
    : { step: 'collections', balanceCents };
};

const STAGES: Record<ClaimStep['step'], ClaimStatus | null> = {
  review: 'needs_review',
  reviewPatient: 'needs_review',
  confirmPayers: 'needs_review',
  submit: 'ready',
  submitDue: 'ready',
  reconcile: 'reconcile',
  overpaid: 'reconcile',
  await: 'submitted',
  followUp: 'follow_up',
  statement: 'patient_balance',
  awaitPatient: 'patient_balance',
  collections: 'balance_review',
  closed: null
};

export const stageOf = (step: ClaimStep['step']) => STAGES[step];

export const CLAIM_SIGNAL = 'claim';

export const claimSignalKey = (claimId: string) => `${CLAIM_SIGNAL}:${claimId}`;
