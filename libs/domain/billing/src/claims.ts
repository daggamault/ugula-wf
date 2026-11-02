export const CLAIM_EVENT_KINDS = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'response',
  'payer_skipped',
  'approved',
  'reconciled',
  'statement',
  'revised',
  'closed'
] as const;

export type ClaimEventKind = (typeof CLAIM_EVENT_KINDS)[number];

export const COVERAGE_EVENT_KINDS: readonly ClaimEventKind[] = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'approved',
  'reconciled'
];

export const PATIENT_EVENT_KINDS: readonly ClaimEventKind[] = ['statement', 'revised', 'closed'];

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

export const OPEN_CLAIM_STATUSES = CLAIM_STATUSES.filter(
  (s): s is Exclude<ClaimStatus, ClosedStatus> => !isClosedStatus(s)
);

export type LedgerCoverage = { id: string; payer: string };

export type ClaimEvent = {
  kind: ClaimEventKind;
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  at: string;
};

export type ClaimLedger = {
  totalCents: number;
  coverages: LedgerCoverage[];
  events: ClaimEvent[];
};

export const STATEMENT_LIMIT = 3;

export const PAYER_WAIT_MS = 30 * 86_400_000;

export const STATEMENT_INTERVAL_MS = 30 * 86_400_000;

export const MIN_WAIT_MS = 60_000;

export type ClaimStep =
  | { step: 'review'; coverage: LedgerCoverage; balanceCents: number }
  | { step: 'submit'; coverage: LedgerCoverage; balanceCents: number }
  | { step: 'reconcile'; coverage: LedgerCoverage; balanceCents: number }
  | { step: 'followUp'; coverage: LedgerCoverage; balanceCents: number }
  | { step: 'await'; coverage: LedgerCoverage; waitMs: number; balanceCents: number }
  | { step: 'statement'; statement: number; balanceCents: number }
  | { step: 'awaitPatient'; waitMs: number; balanceCents: number }
  | { step: 'collections' | 'closed'; balanceCents: number };

const CONTACTS: readonly ClaimEventKind[] = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up'
];

const latest = (events: ClaimEvent[]) =>
  events.reduce<number | null>((max, e) => {
    const t = Date.parse(e.at);
    return max === null || t > max ? t : max;
  }, null);

export const claimProgress = ({ totalCents, coverages, events }: ClaimLedger) => {
  const balanceCents = events.reduce((b, e) => b - e.paidCents - e.adjustedCents, totalCents);
  const idsWhere = (kinds: readonly ClaimEventKind[]) =>
    new Set(
      events.filter((e) => e.coverageId !== null && kinds.includes(e.kind)).map((e) => e.coverageId)
    );
  const done = idsWhere(['response', 'payer_skipped']);
  const answered = idsWhere(['response']);
  const coverage = coverages.find((c) => !done.has(c.id)) ?? null;
  const contacts = events
    .filter((e) => coverage !== null && e.coverageId === coverage.id && CONTACTS.includes(e.kind))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = contacts.at(-1);
  const contacted = !last || last.kind === 'resubmit_queued' ? null : Date.parse(last.at);
  const lastOf = (coverageId: string, kinds: readonly ClaimEventKind[]) =>
    events.findLastIndex((e) => e.coverageId === coverageId && kinds.includes(e.kind));
  const approved =
    coverage !== null && lastOf(coverage.id, ['approved']) > lastOf(coverage.id, CONTACTS);
  const unreconciled =
    coverages.find((c) => lastOf(c.id, ['response']) > lastOf(c.id, ['reconciled'])) ?? null;
  const statements = events.filter((e) => e.kind === 'statement');
  return {
    balanceCents,
    coverage,
    contacted,
    approved,
    unreconciled,
    submittedBefore: contacts.some((e) => e.kind === 'submitted' || e.kind === 'resubmitted'),
    priorCoverages: coverages.filter((c) => answered.has(c.id) && c.id !== coverage?.id),
    statements: statements.length,
    lastStatement: latest(statements)
  };
};

const waitFor = (since: number, intervalMs: number, now: Date) => {
  const remaining = since + intervalMs - now.getTime();
  return remaining > 0 ? Math.max(remaining, MIN_WAIT_MS) : 0;
};

export type CyclePolicy = {
  payerWaitMs: number;
  statementLimit: number;
  statementIntervalMs: number;
};

export const DEFAULT_POLICY: CyclePolicy = {
  payerWaitMs: PAYER_WAIT_MS,
  statementLimit: STATEMENT_LIMIT,
  statementIntervalMs: STATEMENT_INTERVAL_MS
};

export const nextClaimStep = (
  ledger: ClaimLedger,
  now: Date,
  policy: CyclePolicy = DEFAULT_POLICY
): ClaimStep => {
  const { balanceCents, coverage, contacted, approved, unreconciled, statements, lastStatement } =
    claimProgress(ledger);
  if (balanceCents <= 0) return { step: 'closed', balanceCents };
  if (unreconciled !== null) return { step: 'reconcile', coverage: unreconciled, balanceCents };
  if (coverage !== null) {
    if (contacted === null) {
      return { step: approved ? 'submit' : 'review', coverage, balanceCents };
    }
    const waitMs = waitFor(contacted, policy.payerWaitMs, now);
    return waitMs > 0
      ? { step: 'await', coverage, waitMs, balanceCents }
      : { step: 'followUp', coverage, balanceCents };
  }
  if (lastStatement === null) return { step: 'statement', statement: 1, balanceCents };
  const waitMs = waitFor(lastStatement, policy.statementIntervalMs, now);
  if (waitMs > 0) return { step: 'awaitPatient', waitMs, balanceCents };
  return statements < policy.statementLimit
    ? { step: 'statement', statement: statements + 1, balanceCents }
    : { step: 'collections', balanceCents };
};

const STAGES: Record<ClaimStep['step'], ClaimStatus | null> = {
  review: 'needs_review',
  submit: 'ready',
  reconcile: 'reconcile',
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
