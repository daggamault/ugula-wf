import { ADJUSTMENT_TYPE, f, model } from './model-kit.ts';

export const CLAIM_LEDGER = model(
  'billing.claim-ledger',
  'ledger',
  'Claim Ledger',
  'where a claim stands from its history: balance, the payer being billed, approvals, responses and statements',
  [
    f('balanceCents', 'integer', 'Balance (cents)'),
    f('coverageId', { id: 'coverage' }, 'Payer being billed (coverage ID)'),
    f('payer', 'string', 'Payer being billed'),
    f('payerKind', 'string', 'Claim filing indicator of the payer being billed, or patient'),
    f('coverageCount', 'integer', 'Payers on the claim'),
    f('contacted', 'boolean', 'The payer being billed has the claim'),
    f('sinceContactMs', 'integer', 'Milliseconds since the payer was last contacted'),
    f('approved', 'boolean', 'The claim is approved for the payer being billed'),
    f('unreconciledCoverageId', { id: 'coverage' }, 'Payer whose response waits to be reconciled'),
    f('unreconciledPayer', 'string', 'Name of the payer whose response waits to be reconciled'),
    f(
      'denialRoute',
      'string',
      'How the denial waiting to be worked was routed: denial, appeal or fix'
    ),
    f('appeals', 'integer', 'Appeals already sent on that denial'),
    f('billFacility', 'boolean', 'A facility is responsible for the trip'),
    f('patientApproved', 'boolean', 'The claim is approved for billing the patient'),
    f('statements', 'integer', 'Patient statements sent'),
    f('sinceStatementMs', 'integer', 'Milliseconds since the last statement'),
    f(
      'sinceFacilityContactMs',
      'integer',
      'Milliseconds since the facility was last invoiced or followed up'
    ),
    f('rejection', 'string', 'Why the last submission was rejected'),
    f('pendingReview', 'boolean', 'A payer file line on the claim waits for a biller'),
    f('payerAnswered', 'boolean', 'A payer on the claim answered it (paid or denied)'),
    f('discoveryTried', 'boolean', 'Insurance discovery was tried on the claim'),
    f(
      'sinceEligibilityMs',
      'integer',
      'Milliseconds since the payer being billed last answered an eligibility check (271)'
    ),
    f('planActive', 'boolean', 'The patient pays on an active payment plan'),
    f('planInstallmentCents', 'integer', 'Installment of the payment plan (cents)'),
    f('planMisses', 'integer', 'Installments of the payment plan missed so far'),
    f('planDueOn', 'string', 'Date the next installment is due (YYYY-MM-DD)'),
    f(
      'untilPlanDueMs',
      'integer',
      'Milliseconds until the next installment is due (negative once past)'
    ),
    f(
      'planPaidCents',
      'integer',
      'What the patient paid toward that installment since the last one was due (cents)'
    ),
    f('planBilled', 'boolean', 'A plan statement was sent for that installment')
  ]
);

export const DENIAL_FACTS = model(
  'billing.denial-facts',
  'denial',
  'Denial Facts',
  'a payer denial waiting to be worked: the payer, how it was routed, its reason codes and the payer settings that decide how to correct or appeal it',
  [
    f('coverageId', { id: 'coverage' }, 'Payer that denied (coverage ID)'),
    f('payer', 'string', 'Payer that denied'),
    f('payerKind', 'string', 'Claim filing indicator of the payer'),
    f('route', 'string', 'How Route Remittance routed it: denial, appeal or fix'),
    f('note', 'string', 'What the routing said'),
    f('codes', { list: 'string' }, 'Group and reason codes of the denial (CO-50)'),
    f('remarks', { list: { code: 'rarc' } }, 'Remark codes (RARC) of the denial (MA130)'),
    f('paidCents', 'integer', 'Paid by the payer (cents)'),
    f('balanceCents', 'integer', 'Balance (cents)'),
    f('deniedOn', 'string', 'Date of the remittance that denied it (YYYY-MM-DD)'),
    f('appeals', 'integer', 'Appeals already sent on this denial'),
    f('payerClaimNumber', 'string', 'Payer claim control number'),
    f(
      'correctionMethod',
      'string',
      'How the payer takes corrections: replacement or reopening, if set'
    ),
    f('appealDays', 'integer', 'Days the payer allows to appeal, if set')
  ]
);

export const REFUND_FACTS = model(
  'billing.refund-facts',
  'refund',
  'Refund Facts',
  'a credit balance: how much more was paid than charged, by whom and when it was found',
  [
    f('overpaidCents', 'integer', 'Paid beyond the charges (cents)'),
    f(
      'coverageId',
      { id: 'coverage' },
      'Payer that overpaid (coverage ID), or none for the patient'
    ),
    f('payer', 'string', 'Payer that overpaid'),
    f('payerKind', 'string', 'Claim filing indicator of that payer, or patient'),
    f('paidCents', 'integer', 'What that payer or the patient paid in all (cents)'),
    f('identifiedOn', 'string', 'Date the credit balance appeared (YYYY-MM-DD)')
  ]
);

export const PATIENT_BALANCE_FACTS = model(
  'billing.patient-balance-facts',
  'patientBalance',
  'Patient Balance Facts',
  'what is left for the patient once every payer is done, with what decides whether state law protects it',
  [
    f('balanceCents', 'integer', 'Balance (cents)'),
    f(
      'adjustments',
      { list: ADJUSTMENT_TYPE },
      'Adjustments the last payer that answered sent, as it sent them'
    ),
    f('claimFilings', { list: 'string' }, 'Claim filing indicators of the payers on the claim'),
    f('state', 'string', 'State of the pickup'),
    f('serviceDate', 'string', 'Date of service (YYYY-MM-DD)'),
    f(
      'planType',
      'string',
      'Plan type of the last payer: fully_insured, self_funded or government'
    ),
    f('payerKind', 'string', 'Claim filing indicator of the last payer, or patient'),
    f(
      'protectedCents',
      'integer',
      'Already taken off the balance by balance-billing protection (cents)'
    )
  ]
);

const DEADLINE_CLAIM = [
  f('claimId', { id: 'claim' }, 'Claim'),
  f('patientId', { id: 'patient' }, 'Patient'),
  f('reference', 'string', 'Claim number and patient')
];

const DUE_FIELDS = [
  f('kind', 'string', 'timelyFiling, appeal, records, refund, task or pcs'),
  ...DEADLINE_CLAIM,
  f('coverageId', { id: 'coverage' }, 'Payer (coverage ID)'),
  f('dueOn', 'string', 'Due date (YYYY-MM-DD)'),
  f('taskId', { id: 'task' }, 'The open task the deadline belongs to, if any'),
  f('priority', 'integer', 'Priority of that task')
];

export const FILING_FACTS = model(
  'billing.filing-facts',
  'filing',
  'Filing Facts',
  'a claim its next payer has not been billed for yet, with what sets its filing limit',
  [
    ...DEADLINE_CLAIM,
    f('coverageId', { id: 'coverage' }, 'Payer not billed yet (coverage ID)'),
    f('claimFiling', 'string', 'Claim filing indicator of that payer in the payer directory'),
    f('filingLimitDays', 'integer', 'Days the payer directory allows to file, if set'),
    f('serviceDate', 'string', 'Date of service (YYYY-MM-DD)')
  ]
);

export const CERTIFICATION_FACTS = model(
  'billing.certification-facts',
  'certification',
  'Certification Facts',
  "a patient's last scheduled trip that has a physician certification on file",
  [
    ...DEADLINE_CLAIM,
    f('signedOn', 'string', 'Date the physician certification was signed (YYYY-MM-DD)'),
    f('serviceDate', 'string', 'Date of the last scheduled trip (YYYY-MM-DD)')
  ]
);

export const REMINDER_FACTS = model(
  'billing.reminder-facts',
  'reminder',
  'Reminder Facts',
  'a deadline reminder already opened on a claim, open or done',
  [
    f('kind', 'string', 'The deadline it reminds of: timelyFiling or pcs'),
    f('claimId', { id: 'claim' }, 'Claim'),
    f('patientId', { id: 'patient' }, 'Patient'),
    f('dueOn', 'string', 'Due date it reminds of (YYYY-MM-DD)'),
    f('openedOn', 'string', 'Date it was opened (YYYY-MM-DD)')
  ]
);

export const TASK_DUE = model(
  'billing.task-due',
  'task',
  'Task Due',
  'an open task on a claim with a due date, and the workflow that opened it',
  [
    f('workflow', 'string', 'Key of the workflow that opened the task'),
    ...DEADLINE_CLAIM,
    f('dueOn', 'string', 'Due date (YYYY-MM-DD)'),
    f('taskId', { id: 'task' }, 'The open task'),
    f('priority', 'integer', 'Priority of the task')
  ]
);

export const DUE_DATE = model(
  'billing.due-date',
  'due',
  'Due Date',
  'a claim deadline and the day it falls on: timely filing, an appeal, a records request, a refund or a physician certification',
  DUE_FIELDS
);

export const DEADLINE = model(
  'billing.deadline',
  'deadline',
  'Deadline',
  'a claim deadline coming up, with the days left and whether a reminder was already opened',
  [
    ...DUE_FIELDS,
    f('daysLeft', 'integer', 'Days left (negative once passed)'),
    f('reminded', 'boolean', 'A reminder for this deadline was already opened')
  ]
);

export const ADJUSTMENT = model(
  'billing.adjustment',
  'adjustment',
  'Adjustment',
  'one 835 adjustment: its group code, reason code (CARC) and amount',
  [
    f('group', 'string', 'Group code (CO, PR, OA, PI, CR)'),
    f('reason', { code: 'carc' }, 'Reason code (CARC)'),
    f('cents', 'integer', 'Amount (cents)')
  ]
);

export const REMITTANCE_LINE = model(
  'billing.remittance-line',
  'line',
  'Remittance Line',
  'one claim payment (CLP) of an 835, with the claim and payer it matched',
  [
    f('position', 'integer', 'Position in the file'),
    f('reference', 'string', 'Claim number the payer sent (CLP01)'),
    f('claimId', { id: 'claim' }, 'Matched claim'),
    f('coverageId', { id: 'coverage' }, 'Matched payer on the claim'),
    f('payerName', 'string', 'Payer name'),
    f('status', 'string', 'Claim status code the payer sent (CLP02)'),
    f('remarks', { list: { code: 'rarc' } }, 'Remark codes (RARC) of the claim payment'),
    f('crossoverPayer', 'string', 'Payer the claim was crossed over to (NM1*TT), if named'),
    f('denied', 'boolean', 'The payer denied the claim'),
    f('reversal', 'boolean', 'The payer reversed an earlier payment'),
    f(
      'reversesPosted',
      'boolean',
      'The payment the reversal takes back is posted on the claim (same payer and claim number)'
    ),
    f('takeback', 'boolean', 'The payment or an adjustment takes money back'),
    f('paidCents', 'integer', 'Paid (cents)'),
    f('adjustments', { list: ADJUSTMENT.type }, 'Adjustments, merged by group and reason')
  ]
);

export const REMITTANCE_POSTING = model(
  'billing.remittance-posting',
  'posting',
  'Remittance Posting',
  'how one 835 claim payment is posted: its route, what lowers the balance and why',
  [
    f('position', 'integer', 'Position in the file'),
    f('route', 'string', 'Route (reconcile, denial, appeal, fix, reversal, review or unmatched)'),
    f('message', 'string', 'What a biller sees about the line'),
    f('adjustedCents', 'integer', 'Adjustments that lower the balance (cents)'),
    f('crossover', 'boolean', 'The payer forwarded the claim to the next payer itself'),
    f('reasons', { list: 'string' }, 'Why')
  ]
);
