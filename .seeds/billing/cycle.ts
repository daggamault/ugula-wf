import {
  CLAIM_FIX_FIELDS,
  CLAIM_SIGNAL,
  CLAIM_STEPS,
  MIN_WAIT_MS,
  STEP_STATUSES
} from '@ugula/billing';
import type { GraphDef, PinSpec } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { graph, p } from './glossary.ts';
import {
  above,
  asRule,
  asStage,
  asWorkflow,
  atMost,
  type Builder,
  below,
  d,
  dollars,
  expr,
  field,
  is,
  issuesSummary,
  named,
  P,
  rule,
  shared,
  subject,
  summarize,
  T,
  table
} from './shared.ts';

const CLAIM_CONTEXT = `{
  claimId: claimId,
  coverageId: coverageId,
  payer: payer,
  balanceCents: balanceCents,
  issues: checked.issues,
  claim: checked.claim
}`;

const FILING_CONTEXT = `{
  claimId: claimId,
  coverageId: coverageId,
  payer: payer,
  balanceCents: balanceCents,
  whyNotFiled: reason,
  claim: checked.claim
}`;

const PAYER = named('context?.payer', "'the patient'");

const THE_PAYER = named('context?.payer', "'The payer'");

const TOTAL = 'context?.claim?.totalCents';

const BALANCE = 'context?.balanceCents';

const WARNINGS = 'filter(context?.issues ?? [], i => i?.severity != "blocking")';

const REVIEW_SUMMARY = issuesSummary(
  'context?.issues',
  PAYER,
  `'Approve billing ' + ${PAYER} + (${TOTAL} != null ? ' ' + ${dollars(TOTAL)} : '') +
    (len(${WARNINGS}) == 0
      ? ', or fix, skip or void the claim'
      : len(${WARNINGS}) == 1
        ? ' after checking its warning: ' + first(${WARNINGS})?.message
        : ' after checking its ' + text(len(${WARNINGS})) + ' warnings, first: ' + first(${WARNINGS})?.message)`
);

const CONFIRM_PAYERS_SUMMARY = `'The report names no payer to bill' +
  (${TOTAL} != null ? ' for ' + ${dollars(TOTAL)} : '') +
  '; add one from the directory with the member ID, or confirm the patient pays'`;

const SUBMIT_SUMMARY = `'The 837P to ' + ${named('context?.payer', "'the payer'")} + ' could not be created: ' +
  ${named('context?.whyNotFiled', "'no reason was given'")} + '; fix it and try again, or skip the payer'`;

const RECONCILE_SUMMARY = `${THE_PAYER} + ' answered and ' +
  (${BALANCE} != null ? ${dollars(BALANCE)} + (${TOTAL} != null ? ' of ' + ${dollars(TOTAL)} : '') + ' is' : 'a balance is') +
  ' still open; reconcile it, move on or write it off'`;

const FOLLOW_UP_SUMMARY = `${THE_PAYER} + ' has not answered this claim in time' +
  (${named('context?.claimStatus', 'null')} != null ? ' (latest status: ' + context?.claimStatus + ')' : '') +
  '; resubmit it, keep waiting or move on'`;

const STATEMENT = `(statementNumber != null
  ? 'statement ' + text(statementNumber) + (statementCount != null ? ' of ' + text(statementCount) : '')
  : 'a statement')`;

const PROFILE_SUMMARY = `'Add the billing profile in Settings so ' + ${STATEMENT} + ' can go to the patient' +
  (${BALANCE} != null ? ' for ' + ${dollars(BALANCE)} : '')`;

const ADDRESS_PARTS = `join(filter([
  (context?.claim?.patient?.addressLine ?? '') == '' ? 'street address' : null,
  (context?.claim?.patient?.city ?? '') == '' ? 'city' : null,
  (context?.claim?.patient?.state ?? '') == '' ? 'state' : null,
  (context?.claim?.patient?.postalCode ?? '') == '' ? 'ZIP code' : null
], x => x != null), ', ')`;

const ADDRESS_SUMMARY = `'The patient address has no ' + (${ADDRESS_PARTS} == '' ? 'usable mailing address' : ${ADDRESS_PARTS}) +
  ', so ' + ${STATEMENT} + ' cannot be sent; enter it or write off ' +
  (${BALANCE} != null ? ${dollars(BALANCE)} : 'the balance')`;

const UNKNOWN_STEP_SUMMARY = `'The claim cycle has no branch for the step "' + text(step) + '"; correct the Claim Steps table, then retry'`;

const COLLECTIONS_SUMMARY = `(${BALANCE} != null ? ${dollars(BALANCE)} : 'A balance') +
  ' is still unpaid after every payer and patient statement; write it off or send it to collections'`;

const FACILITY_SUMMARY = `'The facility has not paid its invoice for this trip' +
  (${BALANCE} != null ? ' (' + ${dollars(BALANCE)} + ' open)' : '') +
  '; contact it, then keep waiting, write it off or send it to collections'`;

const PATIENT_ADDRESS_FIELDS = ['AddressLine', 'City', 'State', 'PostalCode'].map((part) => ({
  name: `patient${part}`,
  type: 'string',
  label: `Patient ${part === 'AddressLine' ? 'street address' : part === 'PostalCode' ? 'ZIP code' : part.toLowerCase()}`,
  required: ['save']
}));

const recordEvent = (g: Builder, id: string, kind: string, label: string) =>
  g.add(id, 'billing.record-claim-event', { label, values: { kind } });

const claimStep = (execOut: string[], about: PinSpec[] = [p('coverageId', 'string', true)]) =>
  graph({
    execIn: ['exec'],
    execOut,
    inputs: [
      p('claimId', 'string'),
      ...about,
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: []
  });

const reviewClaim = (): GraphDef => {
  const g = claimStep(['done', 'void']);
  g.add('review', 'std.human.task', {
    label: 'Review Claim',
    config: {
      title: 'Review claim',
      queue: 'billing-review',
      instructions:
        'Check the claim before it goes to this payer, or before the patient is billed when no payer is left: patient, member ID, service, charges, diagnoses and trip details, with any warnings. Approve it to make it ready, fix its data, skip this payer, or void the claim.',
      outcomes: ['approve', 'fixData', 'skipPayer', 'void'],
      hints: {
        approve:
          'Approves the claim, so it is filed to this payer next, or the patient is billed when no payer is left.',
        fixData:
          'Closes this review and opens a Fix Claim Data task to edit the claim; it comes back for review after.',
        skipPayer:
          'Skips this payer; the claim moves on to the next payer, or to the patient when none is left.',
        void: 'Voids the claim and closes it; it is never billed.'
      }
    }
  });
  recordEvent(g, 'approve', 'approved', 'Approve');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to Next Payer');
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data on Request', values: { all: true } });
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'review.exec');
  g.wire('entry.subject', 'review.subject', 'fix.subject');
  g.wire('entry.context', 'review.context', 'fix.context');
  summarize(g, 'review', REVIEW_SUMMARY, { context: 'entry.context' });
  g.wire('entry.claimId', 'approve.claimId', 'skip.claimId', 'fix.claimId');
  g.wire('entry.coverageId', 'approve.coverageId', 'skip.coverageId');
  g.wire('review.approve', 'approve.exec');
  g.wire('review.fixData', 'fix.exec');
  g.wire('review.skipPayer', 'skip.exec');
  g.wire('review.void', 'voidReturn.exec');
  for (const done of ['approve.then', 'skip.then', 'fix.fixed', 'fix.backToReview'] as const) {
    g.wire(done, 'doneReturn.exec');
  }
  g.wire('fix.voided', 'voidReturn.exec');
  return g.def;
};

const CONFIRM_PAYER_PINS = [
  'payerId',
  'memberId',
  'relationship',
  'insuredFirstName',
  'insuredLastName'
];

const confirmPayers = (): GraphDef => {
  const g = claimStep(['done', 'void']);
  g.add('choices', 'billing.fix-claim-form', {
    label: 'Directory Choices',
    values: { all: true, issues: [] }
  });
  g.add('directory', 'std.object.pick', {
    label: 'Directory Payers',
    values: { keys: ['payerId'] }
  });
  g.add('confirm', 'std.human.task', {
    label: 'Confirm Payers',
    config: {
      title: 'Confirm payers',
      queue: 'billing-review',
      instructions:
        'The report named no payer the claim can be billed to. Add the payer from the directory with the member ID, or confirm the patient pays themselves.',
      fields: CLAIM_FIX_FIELDS.filter((f) => CONFIRM_PAYER_PINS.includes(f.name)).map((f) =>
        f.name === 'payerId' || f.name === 'memberId' ? { ...f, required: ['save'] } : f
      ),
      outcomes: ['save', 'selfPay'],
      hints: {
        save: 'Adds this payer to the claim, reprices the charges if needed, and goes on to bill it.',
        selfPay: 'Approves the claim with no payer; the patient is billed.'
      }
    }
  });
  for (const pin of ['claimId', 'subject', 'context']) g.input(`${pin}ToReprice`, pin);
  g.add('addPayer', 'billing.patch-claim', { label: 'Add the Payer' });
  g.add('triggers', 'billing.reprice-triggers', { label: 'Reprice Triggers' });
  g.add('repriceNeeded', 'std.flow.branch', { label: 'Reprice?' });
  g.add('reprice', 'billing.reprice-claim', { label: 'Price for the New Payer' });
  recordEvent(g, 'selfPay', 'approved', 'Bill the Patient');
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'choices.exec');
  g.wire('entry.claimId', 'choices.claimId', 'addPayer.claimId', 'selfPay.claimId');
  g.wire('claimIdToReprice.claimId', 'reprice.claimId');
  g.wire('entry.coverageId', 'selfPay.coverageId');
  g.wire('entry.subject', 'confirm.subject');
  g.wire('entry.context', 'confirm.context');
  summarize(g, 'confirm', CONFIRM_PAYERS_SUMMARY, { context: 'entry.context' });
  g.wire('subjectToReprice.subject', 'reprice.subject');
  g.wire('contextToReprice.context', 'reprice.context');
  g.wire('choices.then', 'confirm.exec');
  g.wire('choices.options', 'directory.object');
  g.wire('directory.object', 'confirm.options');
  g.wire('confirm.save', 'addPayer.exec');
  for (const pin of CONFIRM_PAYER_PINS) g.wire(`confirm.${pin}`, `addPayer.${pin}`);
  g.wire('confirm.selfPay', 'selfPay.exec');
  g.wire('addPayer.then', 'repriceNeeded.exec');
  g.wire('addPayer.changes', 'triggers.changes');
  g.wire('triggers.reprice', 'repriceNeeded.condition');
  g.wire('repriceNeeded.true', 'reprice.exec');
  g.wire('addPayer.tripType', 'reprice.tripType');
  g.wire('addPayer.service', 'reprice.service');
  g.wire('addPayer.payerId', 'reprice.payerId');
  for (const done of ['repriceNeeded.false', 'reprice.repriced', 'selfPay.then'] as const) {
    g.wire(done, 'doneReturn.exec');
  }
  g.wire('reprice.voided', 'voidReturn.exec');
  return g.def;
};

const submitClaim = (): GraphDef => {
  const g = claimStep(['done', 'void']);
  g.add('submit', 'std.human.task', {
    label: 'Claim Could Not Be Filed',
    config: {
      title: 'Claim could not be filed',
      queue: 'billing-review',
      instructions:
        'This claim was approved, but its 837P file could not be created for the reason in the details. Fix what it names (the billing profile is in Settings) and try again, fix the claim data (it is reviewed again), skip this payer, or mark it submitted if it went out another way.',
      outcomes: ['tryAgain', 'fixData', 'skipPayer', 'submitted'],
      hints: {
        tryAgain:
          'Creates and files the 837P again; this task comes back if it still cannot be filed.',
        fixData:
          'Opens a Fix Claim Data task to edit the claim; it is reviewed again before it is filed.',
        skipPayer:
          'Skips this payer; the claim moves on to the next payer, or to the patient when none is left.',
        submitted:
          'Records the claim as sent to this payer outside the app; the claim then waits for the payer.'
      }
    }
  });
  recordEvent(g, 'submitted', 'submitted', 'Submitted Outside the App');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to Next Payer');
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data on Request', values: { all: true } });
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'submit.exec');
  g.wire('entry.subject', 'submit.subject', 'fix.subject');
  g.wire('entry.context', 'submit.context', 'fix.context');
  summarize(g, 'submit', SUBMIT_SUMMARY, { context: 'entry.context' });
  g.wire('entry.claimId', 'submitted.claimId', 'skip.claimId', 'fix.claimId');
  g.wire('entry.coverageId', 'submitted.coverageId', 'skip.coverageId');
  g.wire('submit.submitted', 'submitted.exec');
  g.wire('submit.fixData', 'fix.exec');
  g.wire('submit.skipPayer', 'skip.exec');
  for (const done of [
    'submit.tryAgain',
    'submitted.then',
    'skip.then',
    'fix.fixed',
    'fix.backToReview'
  ] as const) {
    g.wire(done, 'doneReturn.exec');
  }
  g.wire('fix.voided', 'voidReturn.exec');
  return g.def;
};

const reconcilePayment = (): GraphDef => {
  const g = claimStep(['done', 'writeOff']);
  g.add('reconcile', 'std.human.task', {
    label: 'Reconcile Payment',
    config: {
      title: 'Reconcile payment',
      queue: 'billing-reconcile',
      instructions:
        'The payer answered and a balance remains. Check what they paid and adjusted, with their reason codes, against the claim, and record anything missing. Continue to the next payer or the patient, write off the rest, or correct the claim and resubmit it to this payer as a replacement of their claim.',
      outcomes: ['continue', 'writeOff', 'resubmitCorrected'],
      hints: {
        continue:
          'Marks the response reconciled; the claim moves on to the next payer, or to the patient.',
        writeOff:
          'Writes off the balance and closes the claim, once approved when it is above the approval limit.',
        resubmitCorrected:
          'Queues a corrected claim to this payer, sent in the next batch as a replacement of their claim.'
      }
    }
  });
  recordEvent(g, 'reconciled', 'reconciled', 'Mark the Response Reconciled');
  recordEvent(g, 'correct', 'resubmit_queued', 'Resubmit as a Corrected Claim');
  g.ret('doneReturn', 'done');
  g.ret('writeOffReturn', 'writeOff');
  g.wire('entry.exec', 'reconcile.exec');
  g.wire('entry.subject', 'reconcile.subject');
  g.wire('entry.context', 'reconcile.context');
  summarize(g, 'reconcile', RECONCILE_SUMMARY, { context: 'entry.context' });
  g.wire('entry.claimId', 'reconciled.claimId', 'correct.claimId');
  g.wire('entry.coverageId', 'reconciled.coverageId', 'correct.coverageId');
  g.wire('reconcile.continue', 'reconciled.exec');
  g.wire('reconcile.resubmitCorrected', 'correct.exec');
  g.wire('reconcile.writeOff', 'writeOffReturn.exec');
  g.wire('reconciled.then', 'doneReturn.exec');
  g.wire('correct.then', 'doneReturn.exec');
  return g.def;
};

const FOLLOW_UPS = [
  [
    'resubmit',
    'resubmit_queued',
    'Queue for the Next Batch',
    'Queues the claim for the next 837P batch to this payer, replacing their claim when its number is entered.'
  ],
  [
    'keepWaiting',
    'follow_up',
    'Keep Waiting on Payer',
    'Keeps waiting on this payer; the claim is followed up again if it still does not answer.'
  ],
  [
    'nextPayer',
    'payer_skipped',
    'Move On From the Payer',
    'Moves on from this payer to the next payer, or to the patient when none is left.'
  ]
] as const;

const STATUS_WAIT_MS = 86_400_000;

const followUpPayer = (): GraphDef => {
  const g = claimStep(['done']);
  g.add('ask', 'billing.send-276', { label: 'Ask the Payer for Claim Status' });
  g.add('wait', 'std.flow.wait-signal', {
    label: 'Await the Claim Status',
    values: { name: CLAIM_SIGNAL, timeoutMs: STATUS_WAIT_MS }
  });
  g.add('latest', 'billing.latest-claim-status', { label: 'Latest Claim Status' });
  g.add('withStatus', 'std.object.set', {
    label: 'Show the Claim Status',
    values: { path: 'claimStatus' }
  });
  g.add('followUp', 'std.human.task', {
    label: 'Follow Up with Payer',
    config: {
      title: 'Follow up on claim',
      queue: 'billing-followup',
      instructions:
        "The payer has not responded in time. The payer's latest claim status (277), when it gave one, is in the details. Resubmit in the next 837P batch, keep waiting, or move on to the next payer. When the payer has the claim on file, enter its claim number so the resubmission replaces it.",
      fields: [{ name: 'payerClaimNumber', type: 'string', label: 'Payer claim number' }],
      outcomes: FOLLOW_UPS.map(([outcome]) => outcome),
      hints: Object.fromEntries(FOLLOW_UPS.map(([outcome, , , hint]) => [outcome, hint]))
    }
  });
  g.ret('doneReturn');
  g.wire('entry.exec', 'ask.exec');
  g.wire('entry.claimId', 'ask.claimId', 'wait.key', 'latest.claimId');
  g.wire('entry.coverageId', 'ask.coverageId');
  g.wire('ask.sent', 'wait.exec');
  g.wire('ask.signalsSeen', 'wait.after');
  for (const exec of [
    'ask.answered',
    'ask.unavailable',
    'wait.received',
    'wait.timeout'
  ] as const) {
    g.wire(exec, 'latest.exec');
  }
  g.wire('latest.then', 'followUp.exec');
  g.wire('entry.subject', 'followUp.subject');
  g.wire('entry.context', 'withStatus.object');
  g.wire('latest.status', 'withStatus.value');
  g.wire('withStatus.object', 'followUp.context');
  summarize(g, 'followUp', FOLLOW_UP_SUMMARY, { context: 'withStatus.object' });
  for (const [outcome, kind, label] of FOLLOW_UPS) {
    recordEvent(g, outcome, kind, label);
    g.wire(`followUp.${outcome}`, `${outcome}.exec`);
    g.wire('entry.claimId', `${outcome}.claimId`);
    g.wire('entry.coverageId', `${outcome}.coverageId`);
    g.wire('followUp.payerClaimNumber', `${outcome}.payerClaimNumber`);
    g.wire(`${outcome}.then`, 'doneReturn.exec');
  }
  return g.def;
};

const sendStatement = (): GraphDef => {
  const g = claimStep(
    ['done', 'writeOff'],
    [p('statementNumber', 'integer'), p('statementCount', 'integer')]
  );
  g.add('balance', 'billing.read-patient-balance', { label: 'Read Patient Balance' });
  g.add('responsibility', 'billing.patient-responsibility', { label: 'Patient Responsibility' });
  g.add('why', 'std.expr', expr('Why Protected', 'join(reasons, "; ")'));
  g.add('protect', 'billing.protect-balance', { label: 'Protect Patient Balance' });
  g.add('owes', 'std.expr', expr('Anything to Bill', 'responsibilityCents > 0'));
  g.add('billable', 'std.flow.branch', { label: 'Bill the Patient?' });
  g.add('statement', 'billing.issue-statement', { label: 'Send Patient Statement' });
  g.add('missing', 'std.flow.switch', {
    label: 'What the Statement Needs',
    config: { cases: ['profile', 'patientAddress'] }
  });
  g.add('profileNeeded', 'std.human.task', {
    label: 'Billing Profile Needed',
    config: {
      title: 'Billing profile needed',
      queue: 'billing-review',
      instructions:
        "Patient statements carry the agency's name, address, phone and time zone from the billing profile, and there is none. Add it in Settings, then continue.",
      outcomes: ['continue'],
      hints: {
        continue:
          'Tries the statement again; this task comes back if there is still no billing profile.'
      }
    }
  });
  g.add('addressNeeded', 'std.human.task', {
    label: 'Patient Address Needed',
    config: {
      title: 'Patient address needed',
      queue: 'billing-review',
      instructions:
        "The patient's mailing address is incomplete, so a statement cannot be sent. Enter it and save, or write off the balance.",
      fields: PATIENT_ADDRESS_FIELDS,
      outcomes: ['save', 'writeOff'],
      hints: {
        save: "Saves the patient's address on the claim; the statement is sent next.",
        writeOff:
          'Writes off the balance and closes the claim, once approved when it is above the approval limit.'
      }
    }
  });
  g.add('addAddress', 'billing.patch-claim', { label: 'Save the Patient Address' });
  g.ret('doneReturn', 'done');
  g.ret('writeOffReturn', 'writeOff');
  g.wire('entry.exec', 'balance.exec');
  g.wire(
    'entry.claimId',
    'balance.claimId',
    'protect.claimId',
    'statement.claimId',
    'addAddress.claimId'
  );
  g.wire('balance.patientBalance', 'responsibility.patientBalance');
  g.wire('responsibility.reasons', 'why.reasons');
  g.wire('why.result', 'protect.note');
  g.wire('responsibility.excessCents', 'protect.adjustedCents');
  g.wire('responsibility.responsibilityCents', 'owes.responsibilityCents');
  g.wire('balance.then', 'protect.exec');
  g.wire('protect.then', 'billable.exec');
  g.wire('owes.result', 'billable.condition');
  g.wire('billable.true', 'statement.exec');
  g.wire('billable.false', 'doneReturn.exec');
  g.wire('entry.statementNumber', 'statement.statementNumber');
  g.wire('entry.statementCount', 'statement.statementCount');
  g.wire('entry.subject', 'profileNeeded.subject', 'addressNeeded.subject');
  g.wire('entry.context', 'profileNeeded.context', 'addressNeeded.context');
  for (const [id, summary] of [
    ['profileNeeded', PROFILE_SUMMARY],
    ['addressNeeded', ADDRESS_SUMMARY]
  ] as const) {
    summarize(g, id, summary, {
      context: 'entry.context',
      statementNumber: 'entry.statementNumber',
      statementCount: 'entry.statementCount'
    });
  }
  g.wire('statement.issued', 'doneReturn.exec');
  g.wire('statement.missing', 'missing.exec');
  g.wire('statement.need', 'missing.value');
  g.wire('missing.profile', 'profileNeeded.exec');
  g.wire('missing.patientAddress', 'addressNeeded.exec');
  g.wire('missing.default', 'doneReturn.exec');
  g.wire('profileNeeded.continue', 'doneReturn.exec');
  g.wire('addressNeeded.save', 'addAddress.exec');
  for (const { name } of PATIENT_ADDRESS_FIELDS) {
    g.wire(`addressNeeded.${name}`, `addAddress.${name}`);
  }
  g.wire('addressNeeded.writeOff', 'writeOffReturn.exec');
  g.wire('addAddress.then', 'doneReturn.exec');
  return g.def;
};

const CLOSINGS = [
  ['closeWrittenOff', 'written_off', 'Close as Written Off'],
  ['closeCollections', 'collections', 'Close as Sent to Collections'],
  ['closePaid', 'paid', 'Close as Paid'],
  ['closeVoid', 'void', 'Close as Void']
] as const;

const DAY_MS = 86_400_000;

const POLICY_FIELDS = [
  field('payerWaitDays', 'number', 'Days to wait for a payer before following up'),
  field('statementCount', 'integer', 'Patient statements to send'),
  field('statementIntervalDays', 'number', 'Days between patient statements'),
  field(
    'facilityWaitDays',
    'number',
    'Days to wait for a facility after its invoice before following up'
  ),
  field(
    'collectionsThresholdCents',
    'integer',
    'Smallest balance sent to collections review (cents)'
  ),
  field(
    'autoWriteOffCents',
    'integer',
    'Largest patient balance written off without statements (cents)'
  ),
  field('reviewRequired', 'boolean', 'A biller reviews the claim before it goes to the payer'),
  field('writeOffApprovalCents', 'integer', 'Largest write-off closed without approval (cents)'),
  field(
    'collectionsApprovalCents',
    'integer',
    'Largest balance sent to collections without approval (cents)'
  )
];

const STEP_INPUTS = [
  field('balanceCents', 'integer', 'Balance (cents)'),
  field('reconciling', 'boolean', 'A payer response waits to be reconciled'),
  field('denialOpen', 'boolean', 'A payer denial waits to be worked'),
  field('billFacility', 'boolean', 'A facility is responsible for the trip'),
  field('hasPayer', 'boolean', 'A payer is still to be billed'),
  field('contacted', 'boolean', 'The payer has the claim'),
  field('approved', 'boolean', 'Approved for the payer'),
  field('reviewRequired', 'boolean', 'Review required'),
  field('payerWaitLeftMs', 'integer', 'Time left to wait for the payer (ms)'),
  field('withinWriteOff', 'boolean', 'The balance is within the write-off limit'),
  field('statements', 'integer', 'Statements sent'),
  field('patientApproved', 'boolean', 'Approved for billing the patient'),
  field('coverageCount', 'integer', 'Payers on the claim'),
  field('statementWaitLeftMs', 'integer', 'Time left before the next statement (ms)'),
  field('facilityWaitLeftMs', 'integer', 'Time left to wait for the facility (ms)'),
  field('statementsLeft', 'integer', 'Statements left to send'),
  field('underCollections', 'boolean', 'The balance is under the collections threshold')
];

const step = (
  label: string,
  when: Record<string, ReturnType<typeof is>>,
  name: string,
  check = false,
  patientOnly = false
) => ({ label, when, set: { step: name, check, patientOnly } });

const DERIVED: [string, string, string][] = [
  ['hasPayer', 'A Payer to Bill', 'coverageId != null'],
  ['reconciling', 'A Response to Reconcile', 'unreconciledCoverageId != null'],
  ['denialOpen', 'A Denial to Work', 'denialRoute != null'],
  [
    'payerWaitLeftMs',
    'Payer Wait Left',
    `contacted ? round(payerWaitDays * ${DAY_MS}) - (sinceContactMs ?? 0) : 0`
  ],
  [
    'statementWaitLeftMs',
    'Statement Wait Left',
    `statements > 0 && sinceStatementMs != null ? round(statementIntervalDays * ${DAY_MS}) - sinceStatementMs : 0`
  ],
  [
    'facilityWaitLeftMs',
    'Facility Wait Left',
    `round(facilityWaitDays * ${DAY_MS}) - (sinceFacilityContactMs ?? 0)`
  ],
  ['statementsLeft', 'Statements Left', 'statementCount - statements'],
  ['withinWriteOff', 'Within the Write-Off Limit', 'balanceCents <= autoWriteOffCents'],
  [
    'underCollections',
    'Under the Collections Threshold',
    'balanceCents < collectionsThresholdCents'
  ]
];

const PAYER_STEPS = ['review', 'submit', 'await', 'followUp'];

const nextClaimStep = (): GraphDef => {
  const g = rule(
    [d('ledger', T.ledger, 'Claim Ledger', 'Where the claim stands, read from its history.')],
    [
      d('step', 'string', 'Step', `The next step: ${CLAIM_STEPS.join(', ')}.`),
      d('coverageId', 'string', 'Payer', 'The payer the step is about, if any.', true),
      d('payer', 'string', 'Payer Name', 'The name of that payer.', true),
      d('waitMs', 'integer', 'Wait Milliseconds', 'How long to wait on the await steps.', true),
      d('statementNumber', 'integer', 'Statement', 'Which patient statement to send.', true),
      d('statementCount', 'integer', 'Statements', 'How many patient statements the policy sends.'),
      d(
        'writeOffApprovalCents',
        'integer',
        'Write-Off Approval Threshold',
        'The largest write-off closed without approval (cents).'
      ),
      d(
        'collectionsApprovalCents',
        'integer',
        'Collections Approval Threshold',
        'The largest balance sent to collections without approval (cents).'
      ),
      d('check', 'boolean', 'Check First', 'Whether the claim checks run before the step.'),
      d(
        'patientOnly',
        'boolean',
        'Patient Billing',
        'Whether only issues that matter for billing the patient count.'
      ),
      P.reasons('the claim is on this step')
    ]
  );
  g.add('ledger', 'billing.claim-ledger.break');
  g.add('policy', 'std.table.decide', {
    label: 'Claim Policy',
    config: shared.decision(
      'billing.claim-policy',
      'Claim Policy',
      'The waits (payer, statements and facility), statements, collections threshold, write-off limit, review rule and approval thresholds (write-offs and collections above them need someone with claims:approve) of the claim cycle, by the kind of payer being billed (its claim filing indicator, or patient).',
      table(
        [field('payerKind', 'string', 'Claim filing indicator of the payer billed, or patient')],
        POLICY_FIELDS,
        [],
        {
          payerWaitDays: 30,
          statementCount: 3,
          statementIntervalDays: 30,
          facilityWaitDays: 60,
          collectionsThresholdCents: 0,
          autoWriteOffCents: 0,
          reviewRequired: true,
          writeOffApprovalCents: 50_000,
          collectionsApprovalCents: 0
        }
      )
    )
  });
  for (const [id, label, expression] of DERIVED) g.add(id, 'std.expr', expr(label, expression));
  g.add('decide', 'std.table.decide', {
    label: 'Claim Steps',
    config: shared.decision(
      'billing.claim-steps',
      'Claim Steps',
      'Decides the next step of the claim cycle from its ledger and policy, top to bottom.',
      table(
        STEP_INPUTS,
        [
          field('step', 'string', 'Step'),
          field('check', 'boolean', 'Run the claim checks first'),
          field('patientOnly', 'boolean', 'Only patient issues count')
        ],
        [
          step('More was paid than charged', { balanceCents: below(0) }, 'overpaid'),
          step('Nothing is owed', { balanceCents: atMost(0) }, 'closed'),
          step('A payer denial waits to be worked', { denialOpen: is(true) }, 'workDenial'),
          step('A payer response waits to be reconciled', { reconciling: is(true) }, 'reconcile'),
          step(
            'Waiting on the responsible facility',
            { billFacility: is(true), facilityWaitLeftMs: above(0) },
            'facility'
          ),
          step('The facility has not paid in time', { billFacility: is(true) }, 'followUpFacility'),
          step(
            'Review before this payer',
            {
              hasPayer: is(true),
              contacted: is(false),
              approved: is(false),
              reviewRequired: is(true)
            },
            'review',
            true
          ),
          step(
            'Ready for this payer',
            { hasPayer: is(true), contacted: is(false) },
            'submit',
            true
          ),
          step('Waiting on the payer', { hasPayer: is(true), payerWaitLeftMs: above(0) }, 'await'),
          step('The payer has not answered in time', { hasPayer: is(true) }, 'followUp'),
          step('Small balance written off', { withinWriteOff: is(true) }, 'writeOff'),
          step(
            'Review before billing the patient',
            { statements: atMost(0), patientApproved: is(false), coverageCount: above(0) },
            'reviewPatient',
            true,
            true
          ),
          step(
            'No payer to bill',
            { statements: atMost(0), patientApproved: is(false) },
            'confirmPayers',
            true,
            true
          ),
          step('Waiting between statements', { statementWaitLeftMs: above(0) }, 'awaitPatient'),
          step('Statements left to send', { statementsLeft: above(0) }, 'statement'),
          step(
            'Balance under the collections threshold',
            { underCollections: is(true) },
            'writeOff'
          )
        ],
        { step: 'collections', check: false, patientOnly: false }
      )
    )
  });
  g.add(
    'waitMs',
    'std.expr',
    expr(
      'How Long to Wait',
      `step == "await" ? max(payerWaitLeftMs, ${MIN_WAIT_MS}) : step == "awaitPatient" ? max(statementWaitLeftMs, ${MIN_WAIT_MS}) : step == "facility" ? max(facilityWaitLeftMs, ${MIN_WAIT_MS}) : null`
    )
  );
  g.add(
    'statementNumber',
    'std.expr',
    expr('Next Statement', 'step == "statement" ? statements + 1 : null')
  );
  g.add(
    'coverage',
    'std.expr',
    expr(
      'Payer of the Step',
      `step == "reconcile" || step == "workDenial" ? { id: unreconciledCoverageId, name: unreconciledPayer } : contains(${JSON.stringify(PAYER_STEPS)}, step) ? { id: coverageId, name: payer } : { id: null, name: null }`
    )
  );
  g.add('coverageId', 'std.object.get', { label: 'Payer ID', values: { path: 'id' } });
  g.add('payerName', 'std.object.get', { label: 'Payer Name', values: { path: 'name' } });
  g.ret('return');
  g.wire('entry.ledger', 'ledger.ledger');
  g.wire('ledger.payerKind', 'policy.payerKind');
  const uses: Record<string, string[]> = {
    hasPayer: ['coverageId'],
    reconciling: ['unreconciledCoverageId'],
    denialOpen: ['denialRoute'],
    payerWaitLeftMs: ['contacted', 'sinceContactMs'],
    statementWaitLeftMs: ['statements', 'sinceStatementMs'],
    facilityWaitLeftMs: ['sinceFacilityContactMs'],
    statementsLeft: ['statements'],
    withinWriteOff: ['balanceCents'],
    underCollections: ['balanceCents']
  };
  for (const [id, fields] of Object.entries(uses)) {
    for (const f of fields) g.wire(`ledger.${f}`, `${id}.${f}`);
  }
  g.wire('policy.payerWaitDays', 'payerWaitLeftMs.payerWaitDays');
  g.wire('policy.statementIntervalDays', 'statementWaitLeftMs.statementIntervalDays');
  g.wire('policy.facilityWaitDays', 'facilityWaitLeftMs.facilityWaitDays');
  g.wire('policy.statementCount', 'statementsLeft.statementCount', 'return.statementCount');
  g.wire('policy.autoWriteOffCents', 'withinWriteOff.autoWriteOffCents');
  g.wire('policy.collectionsThresholdCents', 'underCollections.collectionsThresholdCents');
  g.wire('policy.reviewRequired', 'decide.reviewRequired');
  g.wire('policy.writeOffApprovalCents', 'return.writeOffApprovalCents');
  g.wire('policy.collectionsApprovalCents', 'return.collectionsApprovalCents');
  for (const [id] of DERIVED) g.wire(`${id}.result`, `decide.${id}`);
  for (const f of [
    'balanceCents',
    'contacted',
    'approved',
    'statements',
    'patientApproved',
    'coverageCount',
    'billFacility'
  ]) {
    g.wire(`ledger.${f}`, `decide.${f}`);
  }
  g.wire('decide.step', 'waitMs.step', 'statementNumber.step', 'coverage.step', 'return.step');
  g.wire('payerWaitLeftMs.result', 'waitMs.payerWaitLeftMs');
  g.wire('statementWaitLeftMs.result', 'waitMs.statementWaitLeftMs');
  g.wire('facilityWaitLeftMs.result', 'waitMs.facilityWaitLeftMs');
  g.wire('ledger.statements', 'statementNumber.statements');
  for (const f of ['unreconciledCoverageId', 'unreconciledPayer', 'coverageId', 'payer']) {
    g.wire(`ledger.${f}`, `coverage.${f}`);
  }
  g.wire('coverage.result', 'coverageId.object', 'payerName.object');
  g.wire('coverageId.value', 'return.coverageId');
  g.wire('payerName.value', 'return.payer');
  g.wire('waitMs.result', 'return.waitMs');
  g.wire('statementNumber.result', 'return.statementNumber');
  g.wire('decide.check', 'return.check');
  g.wire('decide.patientOnly', 'return.patientOnly');
  g.wire('decide.rules', 'return.reasons');
  return g.def;
};

const ROUTES = [
  'review',
  'reviewPatient',
  'confirmPayers',
  'submit',
  'reconcile',
  'workDenial',
  'overpaid',
  'facility',
  'followUpFacility',
  'await',
  'awaitPatient',
  'followUp',
  'statement',
  'collections',
  'writeOff',
  'closed'
];

const UNCHECKED = { issues: [], claim: null };

const cycleClaim = (): GraphDef => {
  const g = graph(
    { execIn: ['exec'], execOut: [], inputs: [p('claimId', 'string')], outputs: [] },
    [
      { name: 'active', type: 'boolean', default: true },
      { name: 'checked', type: { object: {} }, default: UNCHECKED }
    ]
  );
  g.add('active', 'std.var.get', { label: 'Still Cycling', config: { name: 'active' } });
  g.add('loop', 'std.flow.while', { label: 'Until the Claim Closes' });
  g.add('ledger', 'billing.read-claim-ledger', { label: 'Read Claim Ledger' });
  g.add('next', 'billing.next-claim-step', { label: 'Next Claim Step' });
  g.add('status', 'std.table.lookup', {
    label: 'Status for the Step',
    config: {
      type: 'string',
      rows: Object.entries(STEP_STATUSES).map(([key, value]) => ({ key, value }))
    }
  });
  g.add('record', 'billing.record-claim-step', { label: 'Record Claim Step' });
  g.add('clear', 'std.var.set', {
    label: 'No Checks Yet',
    config: { name: 'checked' },
    values: { value: UNCHECKED }
  });
  g.add('checkFirst', 'std.flow.branch', { label: 'Check the Claim First?' });
  g.add(
    'rejection',
    'std.expr',
    expr('Rejection to Show', 'step == "review" ? ledger.rejection : null')
  );
  g.add('check', 'billing.check-claim', { label: 'Check Claim' });
  g.add('checks', 'std.expr', expr('Checks', '{ issues: issues, claim: claim }'));
  g.add('keepValid', 'std.var.set', { label: 'Keep the Checks', config: { name: 'checked' } });
  g.add('keepInvalid', 'std.var.set', {
    label: 'Keep the Blocking Checks',
    config: { name: 'checked' }
  });
  g.add('checked', 'std.var.get', { label: 'Checks of This Step', config: { name: 'checked' } });
  g.add('route', 'std.flow.switch', {
    label: 'By Step',
    config: { cases: ROUTES }
  });
  g.add('unknownStepContext', 'std.expr', expr('Step Not Handled', '{ step: step }'));
  g.add('unknownStep', 'std.human.task', {
    label: 'Claim Step Not Handled',
    config: {
      title: 'Claim step not handled',
      queue: 'billing-review',
      instructions:
        'The Next Claim Step rule chose a step this claim cycle has no branch for (the details name it), so the claim cannot move on. Correct the Claim Steps table or the rule override that returns it, then retry the cycle.',
      outcomes: ['retry'],
      hints: {
        retry: 'Runs the claim cycle again; this task comes back if the step is still not handled.'
      }
    }
  });
  g.add('payerSubject', 'std.expr', subject('reference', 'payer'));
  g.add('claimSubject', 'std.expr', subject('reference'));
  g.add('claimContext', 'std.expr', expr('Claim Context', CLAIM_CONTEXT));
  g.add('balance', 'std.object.get', { label: 'Balance', values: { path: 'balanceCents' } });
  g.add('wait', 'std.flow.wait-signal', {
    label: 'Await a Claim Change or Deadline',
    values: { name: CLAIM_SIGNAL }
  });
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data', values: { all: false } });
  g.add('review', 'billing.review-claim', { label: 'Review Claim' });
  g.add('confirmPayers', 'billing.confirm-payers', { label: 'Confirm Payers' });
  g.add('prepare', 'billing.prepare-837p', { label: 'Prepare 837P Claim' });
  g.add('map', 'billing.map-837p', { label: 'Map 837P Claim' });
  g.add('file', 'billing.file-837p', { label: 'File 837P Claim' });
  g.add('send', 'billing.send-837p', { label: 'Send 837P to Clearinghouse' });
  g.add('filingContext', 'std.expr', expr('Filing Context', FILING_CONTEXT));
  g.add('submit', 'billing.submit-claim', { label: 'Claim Could Not Be Filed' });
  g.add('reconcile', 'billing.reconcile-payment', { label: 'Reconcile Payment' });
  g.add('denialInputs', 'std.expr', {
    label: 'Denial Inputs',
    config: {
      expression: '{ claimId: claimId, coverageId: coverageId, subject: subject, context: context }'
    }
  });
  g.add('denial', 'std.flow.run-workflow', {
    label: 'Work Denial',
    config: { workflow: 'billing.work-denial', version: 1 }
  });
  g.add('denied', 'std.flow.switch', {
    label: 'How the Denial Ended',
    config: { cases: ['writeOff', 'void'] }
  });
  g.add('refundInputs', 'std.expr', {
    label: 'Refund Inputs',
    config: { expression: '{ claimId: claimId, subject: subject, context: context }' }
  });
  g.add('overpaid', 'std.flow.run-workflow', {
    label: 'Refund Overpayment',
    config: { workflow: 'billing.refund-overpayment', version: 1 }
  });
  g.add('refunded', 'std.flow.switch', {
    label: 'How the Refund Ended',
    config: { cases: ['keptCredit'] }
  });
  g.add('approveWriteOff', 'billing.approve-closing', {
    label: 'Approve Write-Off',
    values: { closing: 'writeOff' }
  });
  g.add('approveCollections', 'billing.approve-closing', {
    label: 'Approve Collections',
    values: { closing: 'collections' }
  });
  g.add('followUp', 'billing.follow-up-payer', { label: 'Follow Up with Payer' });
  g.add('statement', 'billing.send-statement', { label: 'Send Patient Statement' });
  g.add('collections', 'std.human.task', {
    label: 'Collections Review',
    config: {
      title: 'Review unpaid balance',
      queue: 'billing-collections',
      instructions:
        'Every payer and patient statement is done and a balance remains. Write it off or send it to collections. If it has been paid in the meantime, either choice closes it as paid.',
      outcomes: ['writeOff', 'sendToCollections'],
      hints: {
        writeOff:
          'Writes off the balance and closes the claim, once approved when it is above the approval limit.',
        sendToCollections:
          'Closes the claim as sent to collections, once approved when the balance needs approval.'
      }
    }
  });
  g.add('facilityFollowUp', 'std.human.task', {
    label: 'Follow Up with Facility',
    config: {
      title: 'Follow up with facility',
      queue: 'billing-followup',
      instructions:
        'The facility responsible for this trip has not paid its invoice in time. Contact the facility, then keep waiting, write off the balance, or send it to collections.',
      outcomes: ['keepWaiting', 'writeOff', 'sendToCollections'],
      hints: {
        keepWaiting: 'Logs the follow-up and waits on the facility for another period.',
        writeOff:
          'Writes off the balance and closes the claim, once approved when it is above the approval limit.',
        sendToCollections:
          'Closes the claim as sent to collections, once approved when the balance needs approval.'
      }
    }
  });
  recordEvent(g, 'facilityKeepWaiting', 'facility_follow_up', 'Keep Waiting on Facility');
  for (const [id, status, label] of CLOSINGS) {
    g.add(id, 'billing.close-claim', { label, values: { status } });
  }
  g.add('stop', 'std.var.set', {
    label: 'Stop Cycling',
    config: { name: 'active' },
    values: { value: false }
  });
  g.ret('done');

  g.wire('entry.exec', 'loop.exec');
  g.wire('active.value', 'loop.condition');
  g.wire('loop.body', 'ledger.exec');
  g.wire('loop.completed', 'done.exec');
  g.wire('entry.claimId', 'ledger.claimId', 'record.claimId', 'check.claimId', 'wait.key');
  g.wire('ledger.ledger', 'next.ledger', 'rejection.ledger', 'balance.object');
  g.wire('next.step', 'status.key', 'rejection.step', 'route.value');
  g.wire('ledger.then', 'record.exec');
  g.wire('status.value', 'record.status');
  g.wire('ledger.signalsSeen', 'record.signalsSeen', 'wait.after');
  g.wire('record.recorded', 'clear.exec');
  g.wire('clear.then', 'checkFirst.exec');
  g.wire('next.check', 'checkFirst.condition');
  g.wire('checkFirst.true', 'check.exec');
  g.wire('checkFirst.false', 'route.exec');
  g.wire('next.patientOnly', 'check.patientOnly', 'fix.patientOnly');
  g.wire('rejection.result', 'check.rejection');
  g.wire('next.coverageId', 'check.rejectedCoverageId');
  g.wire('check.issues', 'checks.issues');
  g.wire('check.claim', 'checks.claim');
  g.wire('checks.result', 'keepValid.value', 'keepInvalid.value');
  g.wire('check.valid', 'keepValid.exec');
  g.wire('check.invalid', 'keepInvalid.exec');
  g.wire('keepValid.then', 'route.exec');
  g.wire('keepInvalid.then', 'fix.exec');

  g.wire('entry.claimId', 'claimContext.claimId', 'filingContext.claimId');
  g.wire('next.coverageId', 'claimContext.coverageId', 'filingContext.coverageId');
  g.wire('next.payer', 'claimContext.payer', 'filingContext.payer', 'payerSubject.payer');
  g.wire('balance.value', 'claimContext.balanceCents', 'filingContext.balanceCents');
  g.wire('checked.value', 'claimContext.checked', 'filingContext.checked');
  g.wire('ledger.reference', 'payerSubject.reference', 'claimSubject.reference');

  g.wire('route.await', 'wait.exec');
  g.wire('route.awaitPatient', 'wait.exec');
  g.wire('next.waitMs', 'wait.timeoutMs');

  const steps = [
    ['fix', 'payer'],
    ['review', 'payer'],
    ['confirmPayers', 'claim'],
    ['submit', 'payer'],
    ['reconcile', 'payer'],
    ['followUp', 'payer'],
    ['statement', 'claim']
  ] as const;
  for (const [id, about] of steps) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire(`${about}Subject.result`, `${id}.subject`);
    g.wire(id === 'submit' ? 'filingContext.result' : 'claimContext.result', `${id}.context`);
    if (id !== 'fix' && id !== 'statement') g.wire('next.coverageId', `${id}.coverageId`);
  }
  g.wire('claimSubject.result', 'collections.subject', 'refundInputs.subject');
  g.wire('claimContext.result', 'collections.context', 'refundInputs.context');
  g.wire('entry.claimId', 'denialInputs.claimId', 'refundInputs.claimId');
  g.wire('next.coverageId', 'denialInputs.coverageId');
  g.wire('payerSubject.result', 'denialInputs.subject');
  g.wire('claimContext.result', 'denialInputs.context');
  for (const id of ['approveWriteOff', 'approveCollections']) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire('balance.value', `${id}.balanceCents`);
    g.wire('claimSubject.result', `${id}.subject`);
    g.wire('claimContext.result', `${id}.context`);
  }
  g.wire('next.writeOffApprovalCents', 'approveWriteOff.thresholdCents');
  g.wire('next.collectionsApprovalCents', 'approveCollections.thresholdCents');
  g.wire('route.review', 'review.exec');
  g.wire('route.reviewPatient', 'review.exec');
  g.wire('route.confirmPayers', 'confirmPayers.exec');
  g.wire('route.submit', 'prepare.exec');
  g.wire('entry.claimId', 'prepare.claimId', 'file.claimId', 'send.claimId');
  g.wire('next.coverageId', 'prepare.coverageId', 'file.coverageId');
  g.wire('file.filed', 'send.exec');
  g.wire('file.controlNumber', 'send.controlNumber');
  g.wire('prepare.ready', 'file.exec');
  g.wire('prepare.claim', 'map.claim');
  g.wire('map.x837', 'file.x837');
  g.wire('file.blocked', 'submit.exec');
  g.wire('file.reason', 'filingContext.reason');
  g.wire('route.reconcile', 'reconcile.exec');
  g.wire('route.workDenial', 'denial.exec');
  g.wire('denialInputs.result', 'denial.inputs');
  g.wire('denial.then', 'denied.exec');
  g.wire('denial.pin', 'denied.value');
  g.wire('denied.writeOff', 'approveWriteOff.exec');
  g.wire('denied.void', 'closeVoid.exec');
  g.wire('route.overpaid', 'overpaid.exec');
  g.wire('refundInputs.result', 'overpaid.inputs');
  g.wire('overpaid.then', 'refunded.exec');
  g.wire('overpaid.pin', 'refunded.value');
  g.wire('refunded.keptCredit', 'closePaid.exec');
  g.wire('route.facility', 'wait.exec');
  g.wire('route.followUp', 'followUp.exec');
  g.wire('route.statement', 'statement.exec');
  g.wire('next.statementNumber', 'statement.statementNumber');
  g.wire('next.statementCount', 'statement.statementCount');
  g.wire('route.collections', 'collections.exec');
  g.wire('route.followUpFacility', 'facilityFollowUp.exec');
  g.wire('claimSubject.result', 'facilityFollowUp.subject');
  g.wire('claimContext.result', 'facilityFollowUp.context');
  g.wire('facilityFollowUp.keepWaiting', 'facilityKeepWaiting.exec');
  g.wire('entry.claimId', 'facilityKeepWaiting.claimId');
  g.wire('facilityFollowUp.writeOff', 'approveWriteOff.exec');
  g.wire('facilityFollowUp.sendToCollections', 'approveCollections.exec');
  g.wire('route.writeOff', 'approveWriteOff.exec');
  g.wire('route.closed', 'closePaid.exec');
  g.wire('route.default', 'unknownStep.exec');
  g.wire('claimSubject.result', 'unknownStep.subject');
  g.wire('next.step', 'unknownStepContext.step');
  g.wire('unknownStepContext.result', 'unknownStep.context');
  summarize(g, 'unknownStep', UNKNOWN_STEP_SUMMARY, { step: 'next.step' });
  summarize(g, 'collections', COLLECTIONS_SUMMARY, { context: 'claimContext.result' });
  summarize(g, 'facilityFollowUp', FACILITY_SUMMARY, { context: 'claimContext.result' });

  for (const id of ['fix.voided', 'review.void', 'confirmPayers.void', 'submit.void'] as const) {
    g.wire(id, 'closeVoid.exec');
  }
  for (const id of ['reconcile.writeOff', 'statement.writeOff', 'collections.writeOff'] as const) {
    g.wire(id, 'approveWriteOff.exec');
  }
  g.wire('approveWriteOff.approved', 'closeWrittenOff.exec');
  g.wire('collections.sendToCollections', 'approveCollections.exec');
  g.wire('approveCollections.approved', 'closeCollections.exec');
  for (const [id] of CLOSINGS) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire(`${id}.then`, 'stop.exec');
  }
  return g.def;
};

export const cycleGraphs: SeedGraph[] = [
  asRule(
    'billing.next-claim-step',
    'Next Claim Step',
    'Decides what a claim needs next from its ledger (Claim Steps table) under the Claim Policy table: refund an overpayment, work a payer denial, reconcile a payer response, wait on a facility that is responsible and follow up when it has not paid in time, review before a payer and submit once approved, wait out the payer and follow up, review before the patient is billed or confirm payers, send or wait on patient statements, write off a small balance, balance review, or close.',
    nextClaimStep()
  ),
  asStage(
    'billing.review-claim',
    'Review Claim',
    'Asks a biller to approve the claim before it goes to a payer or the patient, fix its data, skip the payer or void it.',
    reviewClaim()
  ),
  asStage(
    'billing.confirm-payers',
    'Confirm Payers',
    'Asks a biller to add a directory payer to a claim without one, repricing it for that payer when the Reprice Triggers rule says so, or to bill the patient.',
    confirmPayers()
  ),
  asStage(
    'billing.submit-claim',
    'Claim Could Not Be Filed',
    'Asks a biller what to do about an approved claim whose 837P file could not be created: try again once the reason is fixed, fix its data, skip the payer, or mark it submitted elsewhere.',
    submitClaim()
  ),
  asStage(
    'billing.reconcile-payment',
    'Reconcile Payment',
    'Asks a biller to reconcile a payer response that leaves a balance: continue, resubmit a corrected claim, or write off the rest.',
    reconcilePayment()
  ),
  asStage(
    'billing.follow-up-payer',
    'Follow Up with Payer',
    'Asks the payer for the claim status (276, real time or batch, waiting up to a day for the 277), then asks a biller what to do about a payer that has not responded, showing the latest status: resubmit, keep waiting, or move to the next payer.',
    followUpPayer()
  ),
  asStage(
    'billing.send-statement',
    'Send Patient Statement',
    'Takes off what balance-billing law keeps off the patient (Patient Responsibility), then sends the next patient statement for what is left, or asks for the billing profile or patient address it needs first.',
    sendStatement()
  ),
  asWorkflow(
    'billing.cycle-claim',
    'Cycle Claim',
    "Bills each payer in claim order, one step at a time: reads the claim ledger, decides the Next Claim Step and records it as the claim's status, runs Check Claim before a review or submission (fixing what blocks the claim), has it reviewed, files each approved claim as its own 837P (asking a biller when it cannot), follows up, works denials (Work Denial), reconciles responses (or resubmits a corrected claim), refunds credit balances (Refund Overpayment), waits on a responsible facility (following up when it has not paid within the Claim Policy wait after its invoice), confirms payers when there are none, reviews before the first patient statement, sends statements before collections review, and has write-offs and collections placements above the Claim Policy thresholds approved. Sleeps until a claim change or a deadline.",
    cycleClaim()
  )
];
