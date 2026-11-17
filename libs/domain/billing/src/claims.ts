import { billingStatements, type LedgerPlan, planProgress } from './payment-plans.ts';

export const CLAIM_EVENT_KINDS = [
  'opened',
  'decided',
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
  'crossed_over',
  'records_requested',
  'records_sent',
  'closing_approved',
  'balance_protected',
  'facility_invoiced',
  'facility_follow_up',
  'responsibility',
  'document',
  'reopened',
  'discovery',
  'plan_started',
  'plan_missed',
  'plan_ended',
  'collections_placed',
  'credit_transferred'
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
  'reopening_requested',
  'crossed_over'
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
  'opened',
  'decided',
  'statement',
  'revised',
  'closed',
  'closing_approved',
  'balance_protected',
  'facility_invoiced',
  'facility_follow_up',
  'responsibility',
  'document',
  'discovery',
  'plan_started',
  'plan_missed',
  'plan_ended',
  'collections_placed',
  'credit_transferred'
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

export const MAX_LINE_MODIFIERS = 4;

export type LineAdjudication = {
  line: number;
  code: string;
  modifiers: string[];
  paidCents: number;
  units: number;
  adjustments: Adjustment[];
};

export const mergedAdjustments = (adjustments: readonly Adjustment[]) => {
  const byCode = new Map<string, Adjustment>();
  for (const a of adjustments) {
    const key = `${a.group}:${a.reason}`;
    const seen = byCode.get(key);
    byCode.set(key, seen ? { ...seen, cents: seen.cents + a.cents } : { ...a });
  }
  return [...byCode.values()].filter((a) => a.cents !== 0);
};

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

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: 'Draft',
  needs_review: 'Needs Review',
  ready: 'Ready to Submit',
  submitted: 'Submitted',
  follow_up: 'Needs Follow-Up',
  reconcile: 'Reconcile Payment',
  denied: 'Denied',
  facility_billing: 'Billed to Facility',
  patient_balance: 'Patient Balance',
  balance_review: 'Balance Review',
  paid: 'Paid',
  written_off: 'Written Off',
  collections: 'Sent to Collections',
  void: 'Void'
};

export const CLOSED_CLAIM_STATUSES = ['paid', 'written_off', 'collections', 'void'] as const;

export type ClosedStatus = (typeof CLOSED_CLAIM_STATUSES)[number];

export const isClosedStatus = (status: string): status is ClosedStatus =>
  (CLOSED_CLAIM_STATUSES as readonly string[]).includes(status);

export const isReopenableStatus = (status: string): status is Exclude<ClosedStatus, 'void'> =>
  isClosedStatus(status) && status !== 'void';

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
  remarks?: string[];
  lines?: LineAdjudication[];
  note: string;
  route?: DenialRoute | null;
  at: string;
};

export type Adjudication = {
  paidCents: number;
  adjustedCents: number;
  paidOn: string;
  adjustments: Adjustment[];
  lines: LineAdjudication[];
};

export type ClaimLedger = {
  totalCents: number;
  coverages: LedgerCoverage[];
  events: ClaimEvent[];
  facilityId?: string | null;
  serviceDate?: string | null;
  pickupState?: string | null;
  pendingReview?: boolean;
  plan?: LedgerPlan | null;
};

export const MIN_WAIT_MS = 60_000;

export const CLAIM_STEPS = [
  'review',
  'discover',
  'reviewPatient',
  'confirmPayers',
  'submit',
  'reconcile',
  'workDenial',
  'overpaid',
  'await',
  'followUp',
  'planMissed',
  'planStatement',
  'awaitPlan',
  'statement',
  'awaitPatient',
  'awaitReview',
  'facility',
  'followUpFacility',
  'collections',
  'writeOff',
  'closed'
] as const;

type ClaimStepName = (typeof CLAIM_STEPS)[number];

export const isClaimStep = (x: unknown): x is ClaimStepName =>
  CLAIM_STEPS.includes(x as ClaimStepName);

export const STEP_STATUSES: Readonly<Partial<Record<ClaimStepName, ClaimStatus>>> = {
  review: 'needs_review',
  discover: 'needs_review',
  reviewPatient: 'needs_review',
  confirmPayers: 'needs_review',
  submit: 'ready',
  reconcile: 'reconcile',
  workDenial: 'denied',
  overpaid: 'reconcile',
  await: 'submitted',
  followUp: 'follow_up',
  planMissed: 'patient_balance',
  planStatement: 'patient_balance',
  awaitPlan: 'patient_balance',
  statement: 'patient_balance',
  awaitPatient: 'patient_balance',
  awaitReview: 'reconcile',
  facility: 'facility_billing',
  followUpFacility: 'facility_billing',
  collections: 'balance_review'
};

type CoverageStep = { coverage: LedgerCoverage; balanceCents: number };

export type ClaimStep =
  | ({ step: 'review' | 'submit' | 'reconcile' | 'workDenial' | 'followUp' } & CoverageStep)
  | ({ step: 'await'; waitMs: number } & CoverageStep)
  | {
      step: 'discover' | 'reviewPatient' | 'confirmPayers' | 'overpaid' | 'planMissed';
      balanceCents: number;
    }
  | { step: 'planStatement'; dueCents: number; dueOn: string; balanceCents: number }
  | { step: 'statement'; statement: number; balanceCents: number }
  | {
      step: 'awaitPatient' | 'awaitReview' | 'awaitPlan' | 'facility';
      waitMs: number;
      balanceCents: number;
    }
  | { step: 'followUpFacility' | 'collections' | 'writeOff' | 'closed'; balanceCents: number };

const CONTACTS: readonly ClaimEventKind[] = [
  'submitted',
  'resubmitted',
  'resubmit_queued',
  'follow_up',
  'rejected',
  'reopening_requested',
  'crossed_over'
];

const FACILITY_CONTACTS: readonly ClaimEventKind[] = ['facility_invoiced', 'facility_follow_up'];

const REOPENED: readonly ClaimEventKind[] = ['resubmit_queued', 'reopening_requested'];

const REOPENING: readonly ClaimEventKind[] = ['resubmit_queued', 'rejected'];

const ADJUDICATED: readonly ClaimEventKind[] = ['response', 'resubmit_queued'];

const REJECTION_NOTE = 'The payer or clearinghouse rejected the last submission';

const latest = (events: ClaimEvent[]) =>
  events.reduce<number | null>((max, e) => {
    const t = Date.parse(e.at);
    return max === null || t > max ? t : max;
  }, null);

const combinedLines = (lines: readonly LineAdjudication[]): LineAdjudication[] =>
  [...Map.groupBy(lines, (l) => l.line)]
    .toSorted(([a], [b]) => a - b)
    .flatMap(([line, all]) => {
      const last = all.at(-1);
      return last
        ? [
            {
              ...last,
              line,
              paidCents: all.reduce((sum, l) => sum + l.paidCents, 0),
              adjustments: mergedAdjustments(all.flatMap((l) => l.adjustments))
            }
          ]
        : [];
    });

const adjudication = (responses: ClaimEvent[]): Adjudication => ({
  paidCents: responses.reduce((sum, e) => sum + e.paidCents, 0),
  adjustedCents: responses.reduce((sum, e) => sum + e.adjustedCents, 0),
  paidOn:
    responses
      .map((e) => e.paidOn ?? e.at.slice(0, 10))
      .toSorted()
      .at(-1) ?? '',
  adjustments: mergedAdjustments(responses.flatMap((e) => e.adjustments)),
  lines: responses.every((e) => e.lines?.length)
    ? combinedLines(responses.flatMap((e) => e.lines ?? []))
    : []
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
  const statements = billingStatements(events);
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
    adjudicatedClaimNumber:
      events.findLast(
        (e) =>
          e.coverageId === coverage?.id &&
          ADJUDICATED.includes(e.kind) &&
          e.payerClaimNumber !== null
      )?.payerClaimNumber ?? null,
    priorCoverages: answered.map((c) => ({
      ...c,
      ...adjudication(events.filter((e) => e.coverageId === c.id && e.kind === 'response'))
    })),
    statements: statements.length,
    lastStatement: latest(events.filter((e) => e.kind === 'statement')),
    lastFacilityContact: latest(facilityContacts)
  };
};

const UNKNOWN_KIND = 'unknown';

export const PATIENT_KIND = 'patient';

const PAYER_KINDS: readonly string[] = [UNKNOWN_KIND, PATIENT_KIND];

type LedgerFacts = ReturnType<typeof ledgerFactsOf>;

const sinceMs = (at: number | null, now: Date) => (at === null ? null : now.getTime() - at);

const eligibilityAt = ({ events }: ClaimLedger, coverageId: string | null) =>
  coverageId === null
    ? null
    : latest(events.filter((e) => e.kind === 'eligibility' && e.coverageId === coverageId));

export const ledgerFactsOf = (ledger: ClaimLedger, now: Date) => {
  const p = claimProgress(ledger);
  const plan = ledger.plan ?? null;
  const progress = plan ? planProgress(plan, ledger.events, now) : null;
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
    rejection: p.rejection,
    pendingReview: ledger.pendingReview ?? false,
    payerAnswered: ledger.events.some((e) => e.kind === 'response' && e.coverageId !== null),
    discoveryTried: ledger.events.some((e) => e.kind === 'discovery'),
    sinceEligibilityMs: sinceMs(eligibilityAt(ledger, p.coverage?.id ?? null), now),
    planActive: plan !== null,
    planInstallmentCents: plan?.installmentCents ?? 0,
    planMisses: plan?.missedCount ?? 0,
    planDueOn: progress?.dueOn ?? null,
    untilPlanDueMs: progress?.untilDueMs ?? null,
    planPaidCents: progress?.paidCents ?? 0,
    planBilled: progress?.billed ?? false
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
    case 'awaitReview':
    case 'awaitPlan':
    case 'facility':
      return { step, waitMs: numberOr(decision.waitMs, MIN_WAIT_MS), balanceCents };
    case 'statement':
      return {
        step,
        statement: numberOr(decision.statementNumber, facts.statements + 1),
        balanceCents
      };
    case 'planStatement':
      return {
        step,
        dueCents: numberOr(decision.dueCents, Math.min(facts.planInstallmentCents, balanceCents)),
        dueOn: typeof decision.dueOn === 'string' ? decision.dueOn : (facts.planDueOn ?? ''),
        balanceCents
      };
    default:
      return { step, balanceCents };
  }
};

export const CLAIM_SIGNAL = 'claim';

export const claimSignalKey = (claimId: string) => `${CLAIM_SIGNAL}:${claimId}`;
