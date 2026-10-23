export type ClaimEventKind =
  | 'submitted'
  | 'resubmitted'
  | 'resubmit_queued'
  | 'follow_up'
  | 'response'
  | 'payer_skipped'
  | 'statement'
  | 'closed';

export type ClaimEvent = {
  kind: ClaimEventKind;
  payer: string | null;
  paidCents: number;
  adjustedCents: number;
  at: string;
};

export type ClaimLedger = {
  totalCents: number;
  payers: string[];
  events: ClaimEvent[];
};

export const STATEMENT_LIMIT = 3;

export const PAYER_WAIT_MS = 30 * 86_400_000;

export const STATEMENT_INTERVAL_MS = 30 * 86_400_000;

export const RECHECK_MS = 86_400_000;

export const MIN_WAIT_MS = 60_000;

export type ClaimStep =
  | { step: 'submit'; payer: string; waitMs: number; balanceCents: number }
  | { step: 'followUp'; payer: string; balanceCents: number }
  | { step: 'await'; payer: string; waitMs: number; balanceCents: number }
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

export const claimProgress = ({ totalCents, payers, events }: ClaimLedger) => {
  const balanceCents = events.reduce((b, e) => b - e.paidCents - e.adjustedCents, totalCents);
  const done = new Set(
    events
      .filter((e) => e.payer !== null && (e.kind === 'response' || e.kind === 'payer_skipped'))
      .map((e) => e.payer)
  );
  const payer = payers.find((p) => !done.has(p)) ?? null;
  const contacts = events
    .filter((e) => payer !== null && e.payer === payer && CONTACTS.includes(e.kind))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = contacts.at(-1);
  const contacted = !last || last.kind === 'resubmit_queued' ? null : Date.parse(last.at);
  const answered = new Set(
    events.filter((e) => e.payer !== null && e.kind === 'response').map((e) => e.payer)
  );
  const statements = events.filter((e) => e.kind === 'statement');
  return {
    balanceCents,
    payer,
    contacted,
    submittedBefore: contacts.some((e) => e.kind === 'submitted' || e.kind === 'resubmitted'),
    priorPayers: payers.filter((p) => answered.has(p) && p !== payer),
    statements: statements.length,
    lastStatement: latest(statements)
  };
};

const waitFor = (since: number, intervalMs: number, now: Date) => {
  const remaining = since + intervalMs - now.getTime();
  return remaining > 0 ? Math.max(Math.min(remaining, RECHECK_MS), MIN_WAIT_MS) : 0;
};

export const nextClaimStep = (ledger: ClaimLedger, now: Date): ClaimStep => {
  const { balanceCents, payer, contacted, statements, lastStatement } = claimProgress(ledger);
  if (balanceCents <= 0) return { step: 'closed', balanceCents };
  if (payer !== null) {
    if (contacted === null) return { step: 'submit', payer, waitMs: RECHECK_MS, balanceCents };
    const waitMs = waitFor(contacted, PAYER_WAIT_MS, now);
    return waitMs > 0
      ? { step: 'await', payer, waitMs, balanceCents }
      : { step: 'followUp', payer, balanceCents };
  }
  if (lastStatement === null) return { step: 'statement', statement: 1, balanceCents };
  const waitMs = waitFor(lastStatement, STATEMENT_INTERVAL_MS, now);
  if (waitMs > 0) return { step: 'awaitPatient', waitMs, balanceCents };
  return statements < STATEMENT_LIMIT
    ? { step: 'statement', statement: statements + 1, balanceCents }
    : { step: 'collections', balanceCents };
};
