import type { EventDef, PinSpec } from '@ugula/graph';
import { CLAIM_STATUSES, type ClaimEventKind } from './claims.ts';
import { BLOB } from './model-kit.ts';

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
  event('claim.opened', 'Claim Opened', 'A draft claim was opened for a patient care report.', [
    CLAIM,
    NOTE
  ]),
  event('claim.submitted', 'Claim Submitted', 'A claim was filed with a payer, first or again.', [
    CLAIM,
    COVERAGE,
    NOTE
  ]),
  event(
    'claim.accepted',
    'Claim Accepted',
    'A payer or the clearinghouse accepted a claim for processing (999 or 277CA).',
    [CLAIM, COVERAGE, NOTE]
  ),
  event(
    'claim.rejected',
    'Claim Rejected',
    'A payer or the clearinghouse rejected a claim before processing it (TA1, 999 or 277CA).',
    [CLAIM, COVERAGE, NOTE]
  ),
  event('claim.denied', 'Claim Denied', 'A payer denied a claim on a remittance.', [
    CLAIM,
    COVERAGE,
    ROUTE,
    NOTE
  ]),
  event('claim.appealed', 'Claim Appealed', 'An appeal of a denial was sent to the payer.', [
    CLAIM,
    COVERAGE,
    NOTE
  ]),
  event(
    'remittance.posted',
    'Remittance Posted',
    'A payment, an 835 claim payment or one posted by hand, was posted to a claim.',
    [CLAIM, COVERAGE, PAID, ADJUSTED, NOTE]
  ),
  event(
    'eligibility.answered',
    'Eligibility Answered',
    'A payer answered whether it covers the patient (271).',
    [CLAIM, COVERAGE, NOTE]
  ),
  event('document.received', 'Document Received', 'A document was added to a claim.', [
    CLAIM,
    NOTE
  ]),
  event(
    'claim.closed',
    'Claim Closed',
    'A claim was closed as paid, written off, sent to collections or void.',
    [CLAIM, NOTE]
  ),
  event(
    'claim.reopened',
    'Claim Reopened',
    'A payment, takeback or refund was posted to a paid, written-off or collections claim, which reopened it.',
    [CLAIM, NOTE]
  )
];

export const CLAIM_LEDGER_EVENTS = {
  opened: 'claim.opened',
  submitted: 'claim.submitted',
  resubmitted: 'claim.submitted',
  accepted: 'claim.accepted',
  rejected: 'claim.rejected',
  denied: 'claim.denied',
  appealed: 'claim.appealed',
  response: 'remittance.posted',
  eligibility: 'eligibility.answered',
  document: 'document.received',
  closed: 'claim.closed',
  reopened: 'claim.reopened'
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
    'import.received',
    'NEMSIS File Received',
    'A NEMSIS file was uploaded or arrived by SFTP, and its import started.',
    [
      p('importId', 'string', 'Import', 'The import the file started.'),
      p('file', BLOB, 'File', 'Where the file is stored.'),
      p('fileName', 'string', 'File Name', 'The name the file arrived with.')
    ]
  ),
  event(
    'payer_file.received',
    'Payer File Received',
    'A file from the clearinghouse (835, TA1, 999, 277CA, 277 or 271) was downloaded or uploaded on Payer Files.',
    [
      p('file', BLOB, 'File', 'Where the file is stored.'),
      p('fileName', 'string', 'File Name', 'The name the file arrived with.')
    ]
  ),
  event(
    'clearinghouse.failed',
    'Clearinghouse Failed',
    "The agency's clearinghouse connection stopped working: its poll failed after the one before succeeded.",
    [CONNECTION, p('error', 'string', 'Error', 'Why the poll failed.')]
  ),
  event(
    'clearinghouse.recovered',
    'Clearinghouse Recovered',
    "The agency's clearinghouse connection works again: its poll succeeded after failing.",
    [CONNECTION]
  ),
  ...LEDGER_EVENTS,
  event(
    'claim.classified',
    'Claim Classified',
    'A claim was classified as an emergency, scheduled, treat-no-transport, refusal or not-billable trip.',
    [CLAIM, p('classification', 'string', 'Classification', 'How the trip is billed.')]
  ),
  event('claim.status_changed', 'Claim Status Changed', "A claim's status changed.", [
    CLAIM,
    STATUS('from', 'From', 'The status before.'),
    STATUS('to', 'To', 'The status now.')
  ]),
  event('claim.paid', 'Claim Paid', 'A claim was paid in full and closed as paid.', [CLAIM]),
  event('task.completed', 'Task Completed', 'A biller completed a task.', [
    p('taskId', { id: 'task' }, 'Task', 'The task completed.'),
    CLAIM,
    p('queue', 'string', 'Queue', 'The work queue the task was in.'),
    p('outcome', 'string', 'Outcome', 'The option the biller chose.')
  ])
];
