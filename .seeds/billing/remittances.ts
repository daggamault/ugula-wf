import { ACKNOWLEDGMENT_KINDS } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
  anyOf,
  asRule,
  asWorkflow,
  type Builder,
  type Criterion,
  code,
  d,
  fixed,
  flow,
  greaterThan,
  ID,
  isCode,
  listOf,
  makeList,
  n,
  not,
  type Port,
  QUEUE,
  reasonsOf,
  rule,
  type Source,
  select
} from './shared.ts';

const OUTCOME = code('paymentOutcome');

const STEP = code('nextStep');

const STEP_LABELS: Readonly<Record<string, string>> = {
  reversal: 'Reversed',
  denial: 'Denied',
  awaitForwarded: 'Forwarded',
  billNext: 'Next Payer Owes',
  patientBalance: 'Patient Owes'
};

const FILE_INPUTS = [
  d('fileId', ID.clearinghouseFile, 'File', 'The file received.'),
  d('kind', code('fileKind'), 'Kind', 'What the file is.'),
  d('fileName', 'string', 'File Name', 'The name of the file on the clearinghouse server.')
];

const counted = (name: string, label: string, description: string) =>
  d(name, 'integer', label, description, true);

const acknowledgments = (): GraphDef => {
  const g = flow(FILE_INPUTS, [
    counted('accepted', 'Accepted', 'How many claims or files the file accepted.'),
    counted('rejected', 'Rejected', 'How many claims or files the file rejected.')
  ]);
  g.trigger({
    kind: 'event',
    event: 'clearinghouse_file.received',
    where: { kind: { op: 'oneOf', value: [...ACKNOWLEDGMENT_KINDS] } }
  });
  g.add('apply', 'clearinghouse-file.acknowledge', {
    label: 'Apply Acknowledgments',
    note: 'Marks each claim accepted, or rejected with why.'
  });
  g.ret('applied');
  g.wire('entry.exec', 'apply.exec');
  g.wire('entry.fileId', 'apply.fileId');
  g.wire('apply.then', 'applied.exec');
  g.wire('apply.accepted', 'applied.accepted');
  g.wire('apply.rejected', 'applied.rejected');
  return g.def;
};

const remittanceFile = (): GraphDef => {
  const g = flow(FILE_INPUTS, [
    counted('posted', 'Posted', 'How many claim payments were posted.'),
    counted('unmatched', 'Unmatched', 'How many claim payments matched no claim.')
  ]);
  g.trigger({
    kind: 'event',
    event: 'clearinghouse_file.received',
    where: { kind: { op: 'is', value: '835' } }
  });
  g.add('post', 'clearinghouse-file.post-remittance', {
    label: 'Post Remittance',
    note: 'Posts each claim payment to the payer that has the claim.'
  });
  g.ret('posted');
  g.wire('entry.exec', 'post.exec');
  g.wire('entry.fileId', 'post.fileId');
  g.wire('post.then', 'posted.exec');
  g.wire('post.posted', 'posted.posted');
  g.wire('post.unmatched', 'posted.unmatched');
  return g.def;
};

const notReady = (g: Builder, id: string): Port => {
  g.add(id, 'std.flow.fail', {
    label: 'Not Ready to Send',
    note: 'Stops for a person when the claim lacks something the 837P needs; retry once it is fixed.',
    values: {
      message:
        'The claim lacks something the 837P needs; its page lists what. Fix it, then retry this run.'
    }
  });
  return `${id}.exec`;
};

const SEND_ENDINGS = ['sent', 'selfPay', 'nothingToSend'] as const;

const sendTo = (g: Builder, id: string, from: Port, claim: Port) => {
  g.add(id, 'claim.send', {
    label: 'Send Claim',
    note: 'Sends the claim to its current payer.'
  });
  g.wire(from, `${id}.exec`);
  g.wire(claim, `${id}.claimId`);
  g.wire(`${id}.notReady`, notReady(g, `${id}NotReady`));
};

const rejectedClaim = (): GraphDef => {
  const g = flow(
    [
      d('claimId', ID.claim, 'Claim', 'The claim rejected.'),
      d('encounterId', ID.encounter, 'Encounter', 'The encounter the claim bills.'),
      d('position', 'integer', 'Payer', 'Which payer of the claim rejected it.'),
      d('reason', 'string', 'Reason', 'Why it was rejected.')
    ],
    [d('claimId', ID.claim, 'Claim', 'The claim rejected.')]
  );
  g.trigger({ kind: 'event', event: 'claim.rejected', where: {} });
  g.add('fix', 'std.human.task', {
    label: 'Fix the Rejected Claim',
    note: 'A biller fixes what the clearinghouse or payer rejected, or sends it again.',
    config: {
      title: 'Fix the Rejected Claim',
      queue: QUEUE,
      permission: 'claims:update',
      instructions:
        'The clearinghouse or the payer rejected this claim before deciding it, for the reason shown. When the claim itself is wrong, edit it: the correction goes back to review and out again once approved. When the problem was elsewhere, such as payer enrollment or the clearinghouse, fix that and send the claim again as it is.',
      outcomes: ['resend', 'corrected'],
      hints: {
        resend: 'Send it again as it is.',
        corrected: 'I edited the claim; its review sends it.'
      }
    }
  });
  g.wire('entry.exec', 'fix.exec');
  g.wire('entry.reason', 'fix.subject');
  g.wire(
    makeList(g, 'why', n('Why It Was Rejected', 'The reason, for the biller.'), 'string', [
      'entry.reason'
    ]),
    'fix.context'
  );
  sendTo(g, 'send', 'fix.resend', 'entry.claimId');
  for (const ending of SEND_ENDINGS) {
    g.ret(ending);
    g.wire(`send.${ending}`, `${ending}.exec`);
    g.wire('entry.claimId', `${ending}.claimId`);
  }
  g.ret('corrected');
  g.wire('fix.corrected', 'corrected.exec');
  g.wire('entry.claimId', 'corrected.claimId');
  return g.def;
};

const nextStep = (): GraphDef => {
  const g = rule(
    [
      d('outcome', OUTCOME, 'Outcome', 'What the payer did with the claim.'),
      d('patientCents', 'integer', 'Patient Responsibility', 'What it left the patient, in cents.'),
      d('hasNextPayer', 'boolean', 'Has Next Payer', 'Whether another payer comes after it.')
    ],
    [
      d('step', STEP, 'Next Step', 'What happens to the claim now.'),
      d('reasons', listOf('string'), 'Reasons', 'Why that is the next step.')
    ]
  );
  const is = (id: string, label: string, value: string) =>
    isCode(
      g,
      id,
      n(label, `The payer ${label.toLowerCase()} the claim.`),
      'paymentOutcome',
      'entry.outcome',
      value
    );
  const reversed = is('reversed', 'Reversed', 'reversed');
  const denied = is('denied', 'Denied', 'denied');
  const forwarded = is('forwarded', 'Forwarded', 'forwarded');
  const owed = greaterThan(
    g,
    'owed',
    n('Patient Owes Something', 'The payer left part of the charge to the patient.'),
    'integer',
    'entry.patientCents',
    0
  );
  const waitForwarded = allOf(
    g,
    'waitForwarded',
    n('Forwarded to the Next Payer', 'The payer sent the claim on itself (a crossover).'),
    [forwarded, 'entry.hasNextPayer']
  );
  const billNext = allOf(
    g,
    'billNext',
    n('Bill the Next Payer', 'The patient owes something and another payer comes next.'),
    [
      owed,
      'entry.hasNextPayer',
      not(g, 'notForwarded', n('Not Forwarded', 'Not a crossover.'), waitForwarded)
    ]
  );
  const patientBalance = allOf(
    g,
    'patientBalance',
    n('Patient Owes the Rest', 'The patient owes something and no payer comes next.'),
    [
      owed,
      not(g, 'lastPayer', n('No Next Payer', 'This was the last payer.'), 'entry.hasNextPayer')
    ]
  );
  const choose = (value: string, holds: Port, otherwise: Source) =>
    select(
      g,
      `when${value[0]?.toUpperCase()}${value.slice(1)}`,
      n(
        `Step When ${STEP_LABELS[value]}`,
        'Gives this step when its test holds, else the step after.'
      ),
      STEP,
      holds,
      fixed(value),
      otherwise
    );
  const step = choose(
    'reversal',
    reversed,
    choose(
      'denial',
      denied,
      choose(
        'awaitForwarded',
        waitForwarded,
        choose('billNext', billNext, choose('patientBalance', patientBalance, fixed('close')))
      )
    )
  );
  const criteria: Criterion[] = [
    {
      id: 'reversalReason',
      label: 'Reversed',
      reason: 'The payer took back what it paid: review the reversal and its corrected payment',
      holds: reversed
    },
    {
      id: 'denialReason',
      label: 'Denied',
      reason: 'The payer denied the claim: appeal it, bill the next payer or write it off',
      holds: denied
    },
    {
      id: 'forwardedReason',
      label: 'Forwarded',
      reason: 'The payer forwarded the claim to the next payer, so wait for its remittance',
      holds: waitForwarded
    },
    {
      id: 'billNextReason',
      label: 'Bill Next',
      reason: 'The patient still owes part of the charge, so bill the next payer',
      holds: billNext
    },
    {
      id: 'patientReason',
      label: 'Patient Balance',
      reason: 'No payer comes next, so the patient owes what the payer left',
      holds: patientBalance
    }
  ];
  g.ret('return');
  g.wire(step, 'return.step');
  g.wire(
    reasonsOf(g, 'reasons', n('Next Step Reasons', 'Why the step was chosen.'), criteria),
    'return.reasons'
  );
  return g.def;
};

const settle = (
  g: Builder,
  id: string,
  label: string,
  settlement: string,
  from: Port,
  note?: Port
) => {
  g.add(id, 'claim.settle', {
    label,
    note: 'Gives the claim its status now its payers are done.',
    values: { settlement }
  });
  g.wire(from, `${id}.exec`);
  g.wire('payment.claimId', `${id}.claimId`);
  if (note) g.wire(note, `${id}.note`);
};

const paymentPosted = (): GraphDef => {
  const g = flow(
    [
      d('claimId', ID.claim, 'Claim', 'The claim the payment is for.'),
      d('encounterId', ID.encounter, 'Encounter', 'The encounter the claim bills.'),
      d('paymentId', ID.payment, 'Payment', 'The payment posted.'),
      d('outcome', OUTCOME, 'Outcome', 'What the payer did with the claim.')
    ],
    [d('claimId', ID.claim, 'Claim', 'The claim the payment is for.')]
  );
  g.trigger({ kind: 'event', event: 'claim.adjudicated', where: {} });
  g.add('payment', 'payment.read', {
    label: 'Read Payment',
    note: 'What the payer paid and left, and whether another payer comes next.'
  });
  g.add('missing', 'std.flow.fail', {
    label: 'Payment Missing',
    note: 'Stops for inspection when the payment the event names is gone.',
    values: { message: 'The payment the event names was not found' }
  });
  g.add('step', 'billing.next-step-after-payment', {
    label: 'Next Step After Payment',
    note: 'Bill the next payer, wait, settle, or ask a biller.'
  });
  g.add('route', 'std.flow.switch', {
    label: 'Next Step',
    note: 'Goes the way of the step decided.',
    config: {
      cases: ['billNext', 'awaitForwarded', 'patientBalance', 'denial', 'reversal']
    }
  });
  g.wire('entry.exec', 'payment.exec');
  g.wire('entry.paymentId', 'payment.paymentId');
  g.wire('payment.notFound', 'missing.exec');
  g.wire('payment.found', 'route.exec');
  for (const pin of ['outcome', 'patientCents', 'hasNextPayer']) {
    g.wire(`payment.${pin}`, `step.${pin}`);
  }
  g.wire('step.step', 'route.value');
  sendTo(g, 'next', 'route.billNext', 'payment.claimId');
  settle(g, 'balance', 'Patient Balance', 'patient_balance', 'route.patientBalance');
  settle(g, 'close', 'Close the Claim', 'closed', 'route.default');
  g.add('denial', 'std.human.task', {
    label: 'Work the Denial',
    note: 'A biller decides what to do about a denial.',
    config: {
      title: 'Work the Denial',
      queue: QUEUE,
      permission: 'claims:update',
      instructions:
        'The payer denied this claim for the reasons shown. Bill the next payer when the denial says another payer is responsible; appeal when the denial is wrong, noting what you sent; or write the claim off, noting why.',
      fields: [{ name: 'note', type: 'string', label: 'Note', required: ['appeal', 'writeOff'] }],
      outcomes: ['billNext', 'appeal', 'writeOff'],
      hints: {
        billNext: 'Bill the next payer on the claim.',
        appeal: 'Keep it denied while the appeal is open.',
        writeOff: 'Close the claim, writing off what is left.'
      }
    }
  });
  g.wire('route.denial', 'denial.exec');
  g.wire('payment.claimNumber', 'denial.subject', 'reversal.subject');
  g.wire('payment.reasons', 'denial.context', 'reversal.context');
  sendTo(g, 'nextAfterDenial', 'denial.billNext', 'payment.claimId');
  settle(g, 'appeal', 'Keep Denied for Appeal', 'denied', 'denial.appeal', 'denial.note');
  settle(g, 'writeOff', 'Write Off', 'closed', 'denial.writeOff', 'denial.note');
  g.add('reversal', 'std.human.task', {
    label: 'Review the Reversal',
    note: 'A biller checks a payment the payer took back.',
    config: {
      title: 'Review the Reversal',
      queue: QUEUE,
      permission: 'claims:update',
      instructions:
        'The payer took back what it paid on this claim, usually with a corrected payment in the same remittance. Check the claim and its payments, and follow up with the payer when no corrected payment came.',
      outcomes: ['done'],
      hints: { done: 'The reversal is understood.' }
    }
  });
  g.wire('route.reversal', 'reversal.exec');
  const endings: [string, Port[]][] = [
    ['sent', ['next.sent', 'nextAfterDenial.sent']],
    [
      'nothingToSend',
      [
        'next.nothingToSend',
        'nextAfterDenial.nothingToSend',
        'next.selfPay',
        'nextAfterDenial.selfPay'
      ]
    ],
    ['waiting', ['route.awaitForwarded']],
    ['settled', ['balance.settled', 'close.settled', 'appeal.settled', 'writeOff.settled']],
    ['changed', ['balance.changed', 'close.changed', 'appeal.changed', 'writeOff.changed']],
    ['reviewed', ['reversal.done']]
  ];
  for (const [ret, from] of endings) {
    g.ret(ret);
    for (const f of from) g.wire(f, `${ret}.exec`);
    g.wire('entry.claimId', `${ret}.claimId`);
  }
  return g.def;
};

const remittanceReceived = (): GraphDef => {
  const g = flow(
    [d('remittanceId', ID.remittance, 'Remittance', 'The remittance posted.')],
    [d('remittanceId', ID.remittance, 'Remittance', 'The remittance reconciled.')]
  );
  g.trigger({ kind: 'event', event: 'remittance.received', where: {} });
  g.add('read', 'remittance.read', {
    label: 'Read Remittance',
    note: 'Whether it balances and every payment matched a claim.'
  });
  g.add('missing', 'std.flow.fail', {
    label: 'Remittance Missing',
    note: 'Stops for inspection when the remittance the event names is gone.',
    values: { message: 'The remittance the event names was not found' }
  });
  const attention = anyOf(
    g,
    'attention',
    n('Needs a Person', 'It does not balance, or a payment matched no claim.'),
    [
      not(
        g,
        'unbalanced',
        n('Does Not Balance', 'Payments less adjustments differ from the total.'),
        'read.balanced'
      ),
      greaterThan(
        g,
        'unmatched',
        n('Payments Unmatched', 'Some payment matched no claim.'),
        'integer',
        'read.unmatched',
        0
      )
    ]
  );
  g.add('check', 'std.flow.branch', {
    label: 'Needs a Person',
    note: 'A clean remittance reconciles itself.'
  });
  g.add('auto', 'remittance.reconcile', {
    label: 'Reconcile Remittance',
    note: 'It balanced and every payment matched a claim.'
  });
  g.add('ask', 'std.human.task', {
    label: 'Reconcile the Remittance',
    note: 'A biller matches payments and explains a difference.',
    config: {
      title: 'Reconcile the Remittance',
      queue: QUEUE,
      permission: 'claims:update',
      instructions:
        'This remittance does not balance, or some of its payments matched no claim. Open it under Remittances, match each unmatched payment to its claim or find why it is not ours, and explain any difference between the payments and the deposit. Note what you found.',
      fields: [{ name: 'note', type: 'string', label: 'What You Found', required: ['reconciled'] }],
      outcomes: ['reconciled'],
      hints: { reconciled: 'The remittance is accounted for.' }
    }
  });
  g.add('byBiller', 'remittance.reconcile', {
    label: 'Record the Reconciliation',
    note: 'By the biller, with their note.'
  });
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.remittanceId', 'read.remittanceId', 'auto.remittanceId', 'byBiller.remittanceId');
  g.wire('read.notFound', 'missing.exec');
  g.wire('read.found', 'check.exec');
  g.wire(attention, 'check.condition');
  g.wire('check.false', 'auto.exec');
  g.wire('check.true', 'ask.exec');
  g.wire('read.payerName', 'ask.subject');
  g.wire('ask.reconciled', 'byBiller.exec');
  g.wire('ask.completedBy', 'byBiller.reconciledBy');
  g.wire('ask.note', 'byBiller.note');
  g.ret('reconciled');
  g.wire('auto.then', 'reconciled.exec');
  g.wire('byBiller.then', 'reconciled.exec');
  g.wire('entry.remittanceId', 'reconciled.remittanceId');
  return g.def;
};

export const remittanceGraphs: SeedGraph[] = [
  asWorkflow(
    'billing.acknowledgment-received',
    'Acknowledgment Received',
    'When the clearinghouse sends a TA1, 999 or 277CA, applies it to the claims it answers: accepted claims are with their payer; a rejected claim gets a Fix the Rejected Claim task through Claim Rejected.',
    acknowledgments()
  ),
  asWorkflow(
    'billing.remittance-file-received',
    'Remittance File Received',
    'When the clearinghouse sends an 835, posts each claim payment to the payer that has the claim, which starts Payment Posted for each, and keeps payments it cannot match for reconciliation.',
    remittanceFile()
  ),
  asWorkflow(
    'billing.rejected-claim',
    'Rejected Claim',
    'When the clearinghouse or a payer rejects a claim, has a biller fix it: edit the claim, which sends it back through review, or send it again as it is.',
    rejectedClaim()
  ),
  asRule(
    'billing.next-step-after-payment',
    'Next Step After Payment',
    'What happens to a claim once a payer has decided it: bill the next payer when the patient still owes part and another payer comes next, wait when the payer forwarded the claim itself, the patient owes the rest when no payer comes next, close it when nothing is owed, or ask a biller about a denial or a reversal.',
    nextStep()
  ),
  asWorkflow(
    'billing.payment-posted',
    'Payment Posted',
    'When a remittance posts a payment on a claim, takes the next step: bills the next payer with what this one paid, waits for a forwarded claim, gives the claim a patient balance or closes it, or asks a biller to work a denial or review a reversal.',
    paymentPosted()
  ),
  asWorkflow(
    'billing.reconcile-remittance',
    'Reconcile Remittance',
    'When a remittance is posted, reconciles it: by itself when its payments balance and every one matched a claim, else through a Reconcile the Remittance task.',
    remittanceReceived()
  )
];
