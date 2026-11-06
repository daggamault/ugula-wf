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
  'rejected',
  'eligibility',
  'claim_status',
  'denied',
  'appeal_packet',
  'appealed',
  'appeal_decided',
  'reopening_requested',
  'records_requested',
  'records_sent',
  'closing_approved',
  'balance_protected',
  'facility_invoiced',
  'facility_follow_up',
  'responsibility',
  'document'
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
  'rejected',
  'eligibility',
  'claim_status',
  'denied',
  'appeal_packet',
  'appealed',
  'appeal_decided',
  'reopening_requested'
];

const CYCLE_EVENT_KINDS = [
  'submitted',
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'approved',
  'reconciled',
  'statement',
  'appealed',
  'appeal_decided',
  'reopening_requested',
  'records_requested',
  'records_sent',
  'closing_approved',
  'facility_follow_up'
] as const satisfies readonly ClaimEventKind[];

export type CycleEventKind = (typeof CYCLE_EVENT_KINDS)[number];

export const isCycleEventKind = (x: string): x is CycleEventKind =>
  (CYCLE_EVENT_KINDS as readonly string[]).includes(x);

export const PATIENT_EVENT_KINDS: readonly ClaimEventKind[] = [
  'statement',
  'revised',
  'closed',
  'closing_approved',
  'balance_protected',
  'facility_invoiced',
  'facility_follow_up',
  'responsibility',
  'document'
];

export const DENIAL_ROUTES = ['denial', 'appeal', 'fix'] as const;

export type DenialRoute = (typeof DENIAL_ROUTES)[number];

export const isDenialRoute = (x: unknown): x is DenialRoute =>
  DENIAL_ROUTES.includes(x as DenialRoute);

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

export const REMARK_CODE_PATTERN = '^[A-Z]{1,2}[0-9]{1,3}$';

export type Adjustment = { group: AdjustmentGroup; reason: string; cents: number };

export const CLAIM_STATUSES = [
  'draft',
  'needs_review',
  'ready',
  'submitted',
  'follow_up',
  'reconcile',
  'denied',
  'facility_billing',
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

export type LedgerCoverage = {
  id: string;
  payer: string;
  claimFiling?: string | null;
  correctionMethod?: string | null;
  appealDays?: number | null;
  planType?: string | null;
};

export type ClaimEvent = {
  kind: ClaimEventKind;
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  payerClaimNumber: string | null;
  paidOn: string | null;
  adjustments: Adjustment[];
  note: string;
  route?: DenialRoute | null;
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
  facilityId?: string | null;
  serviceDate?: string | null;
  pickupState?: string | null;
};

export const MIN_WAIT_MS = 60_000;

export const CLAIM_STEPS = [
  'review',
  'reviewPatient',
  'confirmPayers',
  'submit',
  'reconcile',
  'workDenial',
  'overpaid',
  'await',
  'followUp',
  'statement',
  'awaitPatient',
  'facility',
  'followUpFacility',
  'collections',
  'writeOff',
  'closed'
] as const;

export type ClaimStepName = (typeof CLAIM_STEPS)[number];

export const isClaimStep = (x: unknown): x is ClaimStepName =>
  CLAIM_STEPS.includes(x as ClaimStepName);

export const STEP_STATUSES: Readonly<Partial<Record<ClaimStepName, ClaimStatus>>> = {
  review: 'needs_review',
  reviewPatient: 'needs_review',
  confirmPayers: 'needs_review',
  submit: 'ready',
  reconcile: 'reconcile',
  workDenial: 'denied',
  overpaid: 'reconcile',
  await: 'submitted',
  followUp: 'follow_up',
  statement: 'patient_balance',
  awaitPatient: 'patient_balance',
  facility: 'facility_billing',
  followUpFacility: 'facility_billing',
  collections: 'balance_review'
};

type CoverageStep = { coverage: LedgerCoverage; balanceCents: number };

export type ClaimStep =
  | ({ step: 'review' | 'submit' | 'reconcile' | 'workDenial' | 'followUp' } & CoverageStep)
  | ({ step: 'await'; waitMs: number } & CoverageStep)
  | { step: 'reviewPatient' | 'confirmPayers' | 'overpaid'; balanceCents: number }
  | { step: 'statement'; statement: number; balanceCents: number }
  | { step: 'awaitPatient' | 'facility'; waitMs: number; balanceCents: number }
  | { step: 'followUpFacility' | 'collections' | 'writeOff' | 'closed'; balanceCents: number };

const CONTACTS: readonly ClaimEventKind[] = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'rejected',
  'reopening_requested'
];

const FACILITY_CONTACTS: readonly ClaimEventKind[] = ['facility_invoiced', 'facility_follow_up'];

const REOPENED: readonly ClaimEventKind[] = ['resubmit_queued', 'reopening_requested'];

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
  const reopened = (id: string) => lastOf(id, REOPENED);
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
  const settled = (id: string) => lastOf(id, ['reconciled', ...REOPENED]);
  const unreconciled = coverages.find((c) => lastOf(c.id, ['response']) > settled(c.id)) ?? null;
  const denialAt = unreconciled ? lastOf(unreconciled.id, ['denied']) : -1;
  const denial =
    unreconciled &&
    denialAt > settled(unreconciled.id) &&
    denialAt > lastOf(unreconciled.id, ['response'])
      ? (events[denialAt] ?? null)
      : null;
  const statements = events.filter((e) => e.kind === 'statement');
  const facilityContacts = events.filter((e) => FACILITY_CONTACTS.includes(e.kind));
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
    denial: denial ? { route: denial.route ?? 'denial', note: denial.note } : null,
    appeals: unreconciled
      ? events.filter((e) => e.coverageId === unreconciled.id && e.kind === 'appealed').length
      : 0,
    skipped: coverages
      .filter((c) => lastOf(c.id, ['payer_skipped']) > reopened(c.id))
      .map((c) => c.id),
    submittedBefore: contacts.some((e) => e.kind === 'submitted' || e.kind === 'resubmitted'),
    rejection: last?.kind === 'rejected' ? last.note || REJECTION_NOTE : null,
    claimStatus:
      coverage === null || lastOf(coverage.id, ['claim_status']) < lastOf(coverage.id, CONTACTS)
        ? null
        : (events[lastOf(coverage.id, ['claim_status'])]?.note ?? null),
    payerClaimNumber:
      events.findLast((e) => e.coverageId === coverage?.id && e.payerClaimNumber !== null)
        ?.payerClaimNumber ?? null,
    priorCoverages: answered.map((c) => ({
      ...c,
      ...adjudication(events.filter((e) => e.coverageId === c.id && e.kind === 'response'))
    })),
    statements: statements.length,
    lastStatement: latest(statements),
    lastFacilityContact: latest(facilityContacts)
  };
};

const UNKNOWN_KIND = 'unknown';

export const PATIENT_KIND = 'patient';

const PAYER_KINDS: readonly string[] = [UNKNOWN_KIND, PATIENT_KIND];

export type LedgerFacts = ReturnType<typeof ledgerFactsOf>;

const sinceMs = (at: number | null, now: Date) => (at === null ? null : now.getTime() - at);

export const ledgerFactsOf = (ledger: ClaimLedger, now: Date) => {
  const p = claimProgress(ledger);
  return {
    balanceCents: p.balanceCents,
    coverageId: p.coverage?.id ?? null,
    payer: p.coverage?.payer ?? null,
    payerKind: p.coverage ? (p.coverage.claimFiling ?? UNKNOWN_KIND) : PATIENT_KIND,
    coverageCount: ledger.coverages.length,
    contacted: p.contacted !== null,
    sinceContactMs: sinceMs(p.contacted, now),
    approved: p.approved,
    unreconciledCoverageId: p.unreconciled?.id ?? null,
    unreconciledPayer: p.unreconciled?.payer ?? null,
    denialRoute: p.denial?.route ?? null,
    appeals: p.appeals,
    billFacility: (ledger.facilityId ?? null) !== null,
    patientApproved: p.patientApproved,
    statements: p.statements,
    sinceStatementMs: sinceMs(p.lastStatement, now),
    sinceFacilityContactMs: sinceMs(p.lastFacilityContact, now),
    rejection: p.rejection
  };
};

const numberOr = (x: unknown, fallback: number) =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;

export const readClaimStep = (decision: Record<string, unknown>, facts: LedgerFacts): ClaimStep => {
  const { step } = decision;
  if (!isClaimStep(step)) throw new Error(`Unknown claim step "${String(step)}"`);
  const { balanceCents } = facts;
  const coverageOf = (id: string | null, payer: string | null, claimFiling: string | null) => {
    if (!id) throw new Error(`The ${step} step needs a payer`);
    return { id, payer: payer ?? '', claimFiling };
  };
  const current = () =>
    coverageOf(
      facts.coverageId,
      facts.payer,
      PAYER_KINDS.includes(facts.payerKind) ? null : facts.payerKind
    );
  switch (step) {
    case 'reconcile':
    case 'workDenial':
      return {
        step,
        coverage: coverageOf(facts.unreconciledCoverageId, facts.unreconciledPayer, null),
        balanceCents
      };
    case 'review':
    case 'submit':
    case 'followUp':
      return { step, coverage: current(), balanceCents };
    case 'await':
      return {
        step,
        coverage: current(),
        waitMs: numberOr(decision.waitMs, MIN_WAIT_MS),
        balanceCents
      };
    case 'awaitPatient':
    case 'facility':
      return { step, waitMs: numberOr(decision.waitMs, MIN_WAIT_MS), balanceCents };
    case 'statement':
      return {
        step,
        statement: numberOr(decision.statementNumber, facts.statements + 1),
        balanceCents
      };
    default:
      return { step, balanceCents };
  }
};

export const CLAIM_SIGNAL = 'claim';

export const claimSignalKey = (claimId: string) => `${CLAIM_SIGNAL}:${claimId}`;
