import { f, model } from './model-kit.ts';

export const CLAIM_LEDGER = model(
  'billing.claim-ledger',
  'ledger',
  'Claim Ledger',
  'where a claim stands from its history: balance, the payer being billed, approvals, responses and statements',
  [
    f('balanceCents', 'integer', 'Balance (cents)'),
    f('coverageId', 'string', 'Payer being billed (coverage ID)'),
    f('payer', 'string', 'Payer being billed'),
    f('payerKind', 'string', 'Claim filing indicator of the payer being billed, or patient'),
    f('coverageCount', 'integer', 'Payers on the claim'),
    f('contacted', 'boolean', 'The payer being billed has the claim'),
    f('sinceContactMs', 'integer', 'Milliseconds since the payer was last contacted'),
    f('approved', 'boolean', 'The claim is approved for the payer being billed'),
    f('unreconciledCoverageId', 'string', 'Payer whose response waits to be reconciled'),
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
    f('rejection', 'string', 'Why the last submission was rejected')
  ]
);

export const DENIAL_FACTS = model(
  'billing.denial-facts',
  'denial',
  'Denial Facts',
  'a payer denial waiting to be worked: the payer, how it was routed, its reason codes and the payer settings that decide how to correct or appeal it',
  [
    f('coverageId', 'string', 'Payer that denied (coverage ID)'),
    f('payer', 'string', 'Payer that denied'),
    f('payerKind', 'string', 'Claim filing indicator of the payer'),
    f('route', 'string', 'How Remittance Routing routed it: denial, appeal or fix'),
    f('note', 'string', 'What the routing said'),
    f('codes', { list: 'string' }, 'Group and reason codes of the denial (CO-50)'),
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
    f('coverageId', 'string', 'Payer that overpaid (coverage ID), or none for the patient'),
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
      'costShareCents',
      'integer',
      'Patient responsibility the payers stated (PR adjustments, cents)'
    ),
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

export const DEADLINE = model(
  'billing.deadline',
  'deadline',
  'Deadline',
  'a claim deadline coming up: timely filing, an appeal, a records request, a refund or a physician certification',
  [
    f('kind', 'string', 'timelyFiling, appeal, records, refund or pcs'),
    f('claimId', 'string', 'Claim'),
    f('coverageId', 'string', 'Payer (coverage ID)'),
    f('reference', 'string', 'Claim number and patient'),
    f('dueOn', 'string', 'Due date (YYYY-MM-DD)'),
    f('daysLeft', 'integer', 'Days left (negative once passed)'),
    f('taskId', 'string', 'The open task the deadline belongs to, if any'),
    f('priority', 'integer', 'Priority of that task'),
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
    f('reason', 'string', 'Reason code (CARC)'),
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
    f('claimId', 'string', 'Matched claim'),
    f('coverageId', 'string', 'Matched payer on the claim'),
    f('payerName', 'string', 'Payer name'),
    f('denied', 'boolean', 'The payer denied the claim'),
    f('reversal', 'boolean', 'The payer reversed an earlier payment'),
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
    f('route', 'string', 'Route (reconcile, review or unmatched)'),
    f('message', 'string', 'What a biller sees about the line'),
    f('adjustedCents', 'integer', 'Adjustments that lower the balance (cents)'),
    f('reasons', { list: 'string' }, 'Why')
  ]
);
