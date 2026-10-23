export const CLAIM_EVENT_KINDS = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'response',
  'payer_skipped',
  'statement',
  'closed'
] as const;

export type ClaimEventKind = (typeof CLAIM_EVENT_KINDS)[number];

export const COVERAGE_EVENT_KINDS: readonly ClaimEventKind[] = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'payer_skipped'
];

export const PATIENT_EVENT_KINDS: readonly ClaimEventKind[] = ['statement', 'closed'];

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

export const RECHECK_MS = 86_400_000;

export const MIN_WAIT_MS = 60_000;

export type ClaimStep =
  | { step: 'submit'; coverage: LedgerCoverage; waitMs: number; balanceCents: number }
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
  const statements = events.filter((e) => e.kind === 'statement');
  return {
    balanceCents,
    coverage,
    contacted,
    submittedBefore: contacts.some((e) => e.kind === 'submitted' || e.kind === 'resubmitted'),
    priorCoverages: coverages.filter((c) => answered.has(c.id) && c.id !== coverage?.id),
    statements: statements.length,
    lastStatement: latest(statements)
  };
};

const waitFor = (since: number, intervalMs: number, now: Date) => {
  const remaining = since + intervalMs - now.getTime();
  return remaining > 0 ? Math.max(Math.min(remaining, RECHECK_MS), MIN_WAIT_MS) : 0;
};

export const nextClaimStep = (ledger: ClaimLedger, now: Date): ClaimStep => {
  const { balanceCents, coverage, contacted, statements, lastStatement } = claimProgress(ledger);
  if (balanceCents <= 0) return { step: 'closed', balanceCents };
  if (coverage !== null) {
    if (contacted === null) return { step: 'submit', coverage, waitMs: RECHECK_MS, balanceCents };
    const waitMs = waitFor(contacted, PAYER_WAIT_MS, now);
    return waitMs > 0
      ? { step: 'await', coverage, waitMs, balanceCents }
      : { step: 'followUp', coverage, balanceCents };
  }
  if (lastStatement === null) return { step: 'statement', statement: 1, balanceCents };
  const waitMs = waitFor(lastStatement, STATEMENT_INTERVAL_MS, now);
  if (waitMs > 0) return { step: 'awaitPatient', waitMs, balanceCents };
  return statements < STATEMENT_LIMIT
    ? { step: 'statement', statement: statements + 1, balanceCents }
    : { step: 'collections', balanceCents };
};
