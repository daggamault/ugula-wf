import type { EventDef, PinSpec } from '@ugula/graph';
import { CLAIM_STATUSES, type ClaimEventKind } from './claims.ts';
import { BLOB } from './model-kit.ts';

export const EVENT_TYPES = {
  claimAccepted: 'claim.accepted',
  claimAppealed: 'claim.appealed',
  claimClassified: 'claim.classified',
  claimClosed: 'claim.closed',
  claimDenied: 'claim.denied',
  claimOpened: 'claim.opened',
  claimPaid: 'claim.paid',
  claimRejected: 'claim.rejected',
  claimReopened: 'claim.reopened',
  claimStatusChanged: 'claim.status_changed',
  claimSubmitted: 'claim.submitted',
  clearinghouseFailed: 'clearinghouse.failed',
  clearinghouseRecovered: 'clearinghouse.recovered',
  collectionsPlaced: 'collections.placed',
  depositRecorded: 'deposit.recorded',
  documentReceived: 'document.received',
  eligibilityAnswered: 'eligibility.answered',
  importReceived: 'import.received',
  payerFileReceived: 'payer_file.received',
  paymentPlanEnded: 'payment_plan.ended',
  paymentPlanMissed: 'payment_plan.missed',
  paymentPlanStarted: 'payment_plan.started',
  periodClosed: 'period.closed',
  remittanceFileApplied: 'remittance.file_applied',
  remittancePosted: 'remittance.posted',
  taskCompleted: 'task.completed'
} as const;

const p = (name: string, type: PinSpec['type'], label: string, description: string): PinSpec => ({
  name,
  type,
  label,
  description,
  optional: true
});

const CLAIM = p('claimId', { id: 'claim' }, 'Claim', 'The claim it happened to.');
const COVERAGE = p(
  'coverageId',
  { id: 'coverage' },
  'Coverage',
  'The payer on the claim it concerns, when it concerns one.'
);
const PAID = p('paidCents', 'integer', 'Paid (Cents)', 'What the payer paid, in cents.');
const ADJUSTED = p(
  'adjustedCents',
  'integer',
  'Adjusted (Cents)',
  'What the payment adjusted off the balance, in cents.'
);
const ROUTE = p(
  'route',
  'string',
  'Route',
  'How Route Remittance routed it: denial, appeal or fix for a denial.'
);
const NOTE = p('note', 'string', 'Note', 'What the claim history says about it.');
const CONNECTION = p(
  'connection',
  'string',
  'Connection',
  'The SFTP server of the clearinghouse connection (host and port).'
);

const event = (type: string, label: string, description: string, payload: PinSpec[]): EventDef => ({
  type,
  label,
  description,
  payload
});

const LEDGER_EVENTS = [
  event(
    EVENT_TYPES.claimOpened,
    'Claim Opened',
    'A draft claim was opened for a patient care report.',
    [CLAIM, NOTE]
  ),
  event(
    EVENT_TYPES.claimSubmitted,
    'Claim Submitted',
    'A claim was filed with a payer, first or again.',
    [CLAIM, COVERAGE, NOTE]
  ),
  event(
    EVENT_TYPES.claimAccepted,
    'Claim Accepted',
    'A payer or the clearinghouse accepted a claim for processing (999 or 277CA).',
    [CLAIM, COVERAGE, NOTE]
  ),
  event(
    EVENT_TYPES.claimRejected,
    'Claim Rejected',
    'A payer or the clearinghouse rejected a claim before processing it (TA1, 999 or 277CA).',
    [CLAIM, COVERAGE, NOTE]
  ),
  event(EVENT_TYPES.claimDenied, 'Claim Denied', 'A payer denied a claim on a remittance.', [
    CLAIM,
    COVERAGE,
    ROUTE,
    NOTE
  ]),
  event(
    EVENT_TYPES.claimAppealed,
    'Claim Appealed',
    'An appeal of a denial was sent to the payer.',
    [CLAIM, COVERAGE, NOTE]
  ),
  event(
    EVENT_TYPES.remittancePosted,
    'Remittance Posted',
    'A payment, an 835 claim payment or one posted by hand, was posted to a claim.',
    [CLAIM, COVERAGE, PAID, ADJUSTED, NOTE]
  ),
  event(
    EVENT_TYPES.eligibilityAnswered,
    'Eligibility Answered',
    'A payer answered whether it covers the patient (271).',
    [CLAIM, COVERAGE, NOTE]
  ),
  event(EVENT_TYPES.documentReceived, 'Document Received', 'A document was added to a claim.', [
    CLAIM,
    NOTE
  ]),
  event(
    EVENT_TYPES.claimClosed,
    'Claim Closed',
    'A claim was closed as paid, written off, sent to collections or void.',
    [CLAIM, NOTE]
  ),
  event(
    EVENT_TYPES.claimReopened,
    'Claim Reopened',
    'A payment, takeback or refund was posted to a paid, written-off or collections claim, which reopened it.',
    [CLAIM, NOTE]
  ),
  event(
    EVENT_TYPES.paymentPlanStarted,
    'Payment Plan Started',
    'The patient agreed to pay the balance of a claim in installments.',
    [CLAIM, NOTE]
  ),
  event(
    EVENT_TYPES.paymentPlanMissed,
    'Payment Plan Missed',
    'The patient missed an installment and the plan was kept.',
    [CLAIM, NOTE]
  ),
  event(
    EVENT_TYPES.paymentPlanEnded,
    'Payment Plan Ended',
    'A payment plan was completed, defaulted or cancelled.',
    [CLAIM, NOTE]
  ),
  event(
    EVENT_TYPES.collectionsPlaced,
    'Collections Placed',
    'A claim sent to collections was placed with the collection agency and added to its placement file.',
    [CLAIM, NOTE]
  )
];

export const CLAIM_LEDGER_EVENTS = {
  opened: EVENT_TYPES.claimOpened,
  submitted: EVENT_TYPES.claimSubmitted,
  resubmitted: EVENT_TYPES.claimSubmitted,
  accepted: EVENT_TYPES.claimAccepted,
  rejected: EVENT_TYPES.claimRejected,
  denied: EVENT_TYPES.claimDenied,
  appealed: EVENT_TYPES.claimAppealed,
  response: EVENT_TYPES.remittancePosted,
  eligibility: EVENT_TYPES.eligibilityAnswered,
  document: EVENT_TYPES.documentReceived,
  closed: EVENT_TYPES.claimClosed,
  reopened: EVENT_TYPES.claimReopened,
  plan_started: EVENT_TYPES.paymentPlanStarted,
  plan_missed: EVENT_TYPES.paymentPlanMissed,
  plan_ended: EVENT_TYPES.paymentPlanEnded,
  collections_placed: EVENT_TYPES.collectionsPlaced
} as const satisfies Partial<Record<ClaimEventKind, string>>;

const LEDGER_COLUMNS: Readonly<Record<string, string>> = {
  claimId: 'claim_id',
  coverageId: 'coverage_id',
  paidCents: 'paid_cents',
  adjustedCents: 'adjusted_cents',
  route: 'route',
  note: 'note'
};

export const ledgerPayloadColumns = (type: string) =>
  Object.fromEntries(
    (LEDGER_EVENTS.find((e) => e.type === type)?.payload ?? []).flatMap((p) => {
      const column = LEDGER_COLUMNS[p.name];
      return column ? [[p.name, column] as const] : [];
    })
  );

const STATUS = (name: string, label: string, description: string) =>
  p(name, 'string', label, `${description} One of ${CLAIM_STATUSES.join(', ')}.`);

export const billingEvents: EventDef[] = [
  event(
    EVENT_TYPES.importReceived,
    'NEMSIS File Received',
    'A NEMSIS file was uploaded or arrived by SFTP, and its import started.',
    [
      p('importId', 'string', 'Import', 'The import the file started.'),
      p('file', BLOB, 'File', 'Where the file is stored.'),
      p('fileName', 'string', 'File Name', 'The name the file arrived with.')
    ]
  ),
  event(
    EVENT_TYPES.payerFileReceived,
    'Payer File Received',
    'A file from the clearinghouse (835, TA1, 999, 277CA, 277 or 271) was downloaded or uploaded on Payer Files.',
    [
      p('file', BLOB, 'File', 'Where the file is stored.'),
      p('fileName', 'string', 'File Name', 'The name the file arrived with.')
    ]
  ),
  event(
    EVENT_TYPES.clearinghouseFailed,
    'Clearinghouse Failed',
    "The agency's clearinghouse connection stopped working: its poll failed after the one before succeeded.",
    [CONNECTION, p('error', 'string', 'Error', 'Why the poll failed.')]
  ),
  event(
    EVENT_TYPES.clearinghouseRecovered,
    'Clearinghouse Recovered',
    "The agency's clearinghouse connection works again: its poll succeeded after failing.",
    [CONNECTION]
  ),
  event(
    EVENT_TYPES.remittanceFileApplied,
    'Remittance File Applied',
    'An 835 with a payment trace number (TRN02) was applied, so it can be matched to its deposit.',
    [p('payerFileId', { id: 'payerFile' }, 'Payer File', 'The 835 file applied.')]
  ),
  event(
    EVENT_TYPES.depositRecorded,
    'Deposit Recorded',
    'A biller recorded a bank deposit on Deposits.',
    [p('depositId', { id: 'deposit' }, 'Deposit', 'The deposit recorded.')]
  ),
  event(
    EVENT_TYPES.periodClosed,
    'Period Closed',
    'An accounting month was closed: postings dated in it are posted to the next open month.',
    [p('period', 'string', 'Period', 'The month closed, as its first day (YYYY-MM-01).')]
  ),
  ...LEDGER_EVENTS,
  event(
    EVENT_TYPES.claimClassified,
    'Claim Classified',
    'A claim was classified as an emergency, scheduled, treat-no-transport, refusal or not-billable trip.',
    [CLAIM, p('classification', 'string', 'Classification', 'How the trip is billed.')]
  ),
  event(EVENT_TYPES.claimStatusChanged, 'Claim Status Changed', "A claim's status changed.", [
    CLAIM,
    STATUS('from', 'From', 'The status before.'),
    STATUS('to', 'To', 'The status now.')
  ]),
  event(EVENT_TYPES.claimPaid, 'Claim Paid', 'A claim was paid in full and closed as paid.', [
    CLAIM
  ]),
  event(EVENT_TYPES.taskCompleted, 'Task Completed', 'A biller completed a task.', [
    p('taskId', { id: 'task' }, 'Task', 'The task completed.'),
    CLAIM,
    p('queue', 'string', 'Queue', 'The work queue the task was in.'),
    p('outcome', 'string', 'Outcome', 'The option the biller chose.')
  ])
];
