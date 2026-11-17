import {
  CLAIM_FIX_FIELDS,
  CLAIM_SIGNAL,
  CLAIM_STEPS,
  MIN_WAIT_MS,
  STEP_STATUSES
} from '@ugula/billing';
import type { GraphDef, PinSpec, ValueType, VariableDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { graph, p } from './glossary.ts';
import {
  asRule,
  asStage,
  asWorkflow,
  type Builder,
  condition,
  d,
  exit,
  field,
  firstOf,
  fixed,
  getField,
  isListed,
  joinText,
  labelOf,
  MEDICARE_CLAIM_FILINGS,
  makeList,
  makeObject,
  money,
  orElse,
  P,
  type Port,
  recordEvent,
  rule,
  select,
  shared,
  summary,
  T,
  type Test,
  table,
  template
} from './shared.ts';

const ADDRESS: ValueType = {
  object: { addressLine: 'string', city: 'string', state: 'string', postalCode: 'string' }
};

const TASK_DETAILS: ValueType = {
  object: {
    payer: 'string',
    balanceCents: 'integer',
    issues: T.issues,
    claim: { object: { totalCents: 'integer', patient: ADDRESS } }
  }
};

const ALLOWED_FIELDS: Record<string, ValueType> = {
  compared: 'boolean',
  allowedCents: 'integer',
  rurality: 'string',
  carrier: 'string',
  locality: 'string',
  codesNotPriced: { list: { code: 'hcpcs' } },
  payerAllowedCents: 'integer',
  underpaidCents: 'integer',
  underpaid: 'boolean'
};

const MEDICARE_ALLOWED: ValueType = { object: ALLOWED_FIELDS };

const CLAIM_PAYER: ValueType = {
  object: { coverageId: { id: 'coverage' }, claimFiling: 'string' }
};

const PRICED_LINES: ValueType = {
  list: { object: { code: { code: 'hcpcs' }, units: 'number', chargeCents: 'integer' } }
};

const RURALITY_WORDS = { urban: 'urban', rural: 'rural', superRural: 'super-rural' };

const DETAILS_PIN = d(
  'context',
  TASK_DETAILS,
  'Task Details',
  'What tasks show a biller about the claim.',
  true
);

const SUMMARY_PIN = d('summary', 'string', 'Task Summary', 'The sentence the task shows a biller.');

const pathOf = (g: Builder, id: string, label: string, path: string, object: Port) => {
  g.add(id, 'std.object.get', { label, values: { path } });
  g.wire(object, `${id}.object`);
  return `${id}.value` as const;
};

const payerOr = (g: Builder, context: Port, fallback: string, label: string) =>
  orElse(
    g,
    'payer',
    label,
    getField(g, 'payerName', 'Payer Name', TASK_DETAILS, 'payer', context),
    fixed(fallback)
  );

const totalOf = (g: Builder, context: Port) =>
  money(
    g,
    'total',
    'Claim Total',
    getField(g, 'totalCents', 'Claim Total (Cents)', TASK_DETAILS, 'claim.totalCents', context)
  );

const balanceOf = (g: Builder, context: Port) =>
  money(
    g,
    'balance',
    'Balance',
    getField(g, 'balanceCents', 'Balance (Cents)', TASK_DETAILS, 'balanceCents', context)
  );

const PATIENT_ADDRESS_FIELDS = [
  ['AddressLine', 'Street Address'],
  ['City', 'City'],
  ['State', 'State'],
  ['PostalCode', 'ZIP Code']
].map(([part, label]) => ({
  name: `patient${part}`,
  type: 'string',
  label: `Patient ${label}`,
  required: ['save']
}));

const claimStep = (
  execOut: string[],
  about: PinSpec[] = [p('coverageId', { id: 'coverage' }, true)],
  variables: VariableDef[] = []
) =>
  graph(
    {
      execIn: ['exec'],
      execOut,
      inputs: [
        p('claimId', { id: 'claim' }),
        ...about,
        p('subject', 'string', true),
        p('context', 'any', true)
      ],
      outputs: []
    },
    variables
  );

const reviewSummary = (): GraphDef => {
  const g = rule([DETAILS_PIN], [SUMMARY_PIN]);
  const billed = payerOr(g, 'entry.context', 'the patient', 'Payer, Else the Patient');
  g.add('warnings', 'std.list.where', {
    label: 'Warnings',
    config: { field: 'severity', op: 'isNot', value: 'blocking' }
  });
  g.add('messages', 'std.list.pluck', { label: 'Warning Messages', values: { field: 'message' } });
  g.add('preview', 'billing.list-preview', {
    label: 'First Two Warnings',
    values: { shown: 2, separator: '; ' }
  });
  g.add('orFix', 'std.logic.choose', {
    label: 'Or Fix, When No Warnings',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '0' }] },
    values: { case1: ', or fix, skip or void the claim' }
  });
  const several = template(g, 'several', 'Several Warnings', 'its {count} warnings', {
    count: 'preview.count'
  });
  g.add('which', 'std.logic.choose', {
    label: 'Its Warning or Warnings',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '0' }, { when: '1' }] },
    values: { case2: 'its warning' }
  });
  const approve = template(
    g,
    'approve',
    'Approve Text',
    'Approve billing {billed}[ for {total}]{orFix}[ after checking {which}: {listed}][; and {more} more]',
    {
      billed,
      total: totalOf(g, 'entry.context'),
      orFix: 'orFix.value',
      which: 'which.value',
      listed: 'preview.listed',
      more: 'preview.more'
    }
  );
  g.add('blocking', 'billing.blocking-summary', { label: 'Blocking, Else Approve Text' });
  g.ret('return');
  g.wire(
    getField(g, 'issues', 'Issues', TASK_DETAILS, 'issues', 'entry.context'),
    'warnings.list',
    'blocking.issues'
  );
  g.wire('warnings.list', 'messages.list');
  g.wire('messages.list', 'preview.items');
  g.wire('preview.count', 'orFix.key', 'which.key');
  g.wire(several, 'which.otherwise');
  g.wire(billed, 'blocking.billed');
  g.wire(approve, 'blocking.otherwise');
  g.wire('blocking.summary', 'return.summary');
  return g.def;
};

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
  g.add('reviewSummary', 'billing.review-summary', { label: 'Task Summary' });
  recordEvent(g, 'approve', 'approved', 'Approve the Claim');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to the Next Payer');
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data on Request', values: { all: true } });
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'review.exec');
  g.wire('entry.subject', 'review.subject', 'fix.subject');
  g.wire('entry.context', 'review.context', 'fix.context', 'reviewSummary.context');
  g.wire('reviewSummary.summary', 'review.summary');
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
  summary(
    g,
    'confirm',
    'The report names no payer to bill[ for {total}]; add one from the directory with the member ID, or confirm the patient pays',
    { total: totalOf(g, 'entry.context') }
  );
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
  g.wire('addPayer.classification', 'reprice.classification');
  g.wire('addPayer.service', 'reprice.service');
  g.wire('addPayer.payerId', 'reprice.payerId');
  for (const done of ['repriceNeeded.false', 'reprice.repriced', 'selfPay.then'] as const) {
    g.wire(done, 'doneReturn.exec');
  }
  g.wire('reprice.voided', 'voidReturn.exec');
  return g.def;
};

const SUBMIT_EXITS = {
  sent: exit('Sent', 'The 837P was filed and sent, or a biller marked it sent another way.'),
  skipped: exit('Skipped', 'A biller skipped the payer; the claim moves on to the next payer.'),
  retry: exit('Retry', 'A biller fixed what kept the 837P from being filed; file it again.'),
  stale: exit(
    'Stale',
    'The claim changed, or the payer is no longer the one being billed, before it was filed.'
  ),
  void: exit('Void', 'A biller voided the claim.')
};

const submitToPayer = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: Object.keys(SUBMIT_EXITS),
      inputs: [
        p('claimId', { id: 'claim' }),
        p('coverageId', { id: 'coverage' }),
        d(
          'frequency',
          'string',
          'Frequency',
          'A claim frequency to file with instead of the one Claim Frequency gives, such as 8 to void the claim.',
          true
        ),
        p('subject', 'string', true),
        p('context', 'any', true)
      ],
      outputs: [],
      exits: SUBMIT_EXITS
    },
    [{ name: 'whyNotFiled', type: 'string', default: null }]
  );
  g.add('prepare', 'billing.prepare-837p', { label: 'Prepare 837P Claim' });
  g.add('map', 'billing.map-837p', { label: 'Map 837P Claim' });
  g.add('frequency', 'billing.with-frequency', { label: 'Claim Frequency to File' });
  g.add('file', 'billing.file-837p', { label: 'File 837P Claim' });
  g.add('send', 'billing.send-837p', { label: 'Send 837P to Clearinghouse' });
  g.add('why', 'std.var.set', {
    label: 'Keep Why It Was Not Filed',
    config: { name: 'whyNotFiled' }
  });
  g.add('reason', 'std.var.get', {
    label: 'Why It Was Not Filed',
    config: { name: 'whyNotFiled' }
  });
  g.add('filingContext', 'std.object.set', {
    label: 'Details with Why It Was Not Filed',
    values: { path: 'whyNotFiled' }
  });
  g.add('submit', 'std.human.task', {
    label: 'Claim Could Not Be Filed',
    config: {
      title: 'Claim could not be filed',
      queue: 'billing-review',
      instructions:
        'The 837P of this claim could not be created for the reason in the details. Fix what it names (the billing profile is in Settings) and try again, fix the claim data, skip this payer, or mark it submitted if it went out another way.',
      outcomes: ['tryAgain', 'fixData', 'skipPayer', 'submitted'],
      hints: {
        tryAgain: 'Files the 837P again; this task comes back if it still cannot be filed.',
        fixData: 'Opens a Fix Claim Data task to edit the claim, then files it again.',
        skipPayer:
          'Skips this payer without filing; the claim moves on to the next payer, or to the patient when none is left.',
        submitted: 'Records the 837P as sent to this payer outside the app.'
      }
    }
  });
  recordEvent(g, 'submitted', 'submitted', 'Mark Submitted Outside the App');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to the Next Payer');
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data on Request', values: { all: true } });
  g.ret('sentReturn', 'sent');
  g.ret('skippedReturn', 'skipped');
  g.ret('retryReturn', 'retry');
  g.ret('staleReturn', 'stale');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'prepare.exec');
  g.wire(
    'entry.claimId',
    'prepare.claimId',
    'file.claimId',
    'send.claimId',
    'submitted.claimId',
    'skip.claimId',
    'fix.claimId'
  );
  g.wire(
    'entry.coverageId',
    'prepare.coverageId',
    'file.coverageId',
    'submitted.coverageId',
    'skip.coverageId'
  );
  g.wire('prepare.ready', 'file.exec');
  g.wire('prepare.stale', 'staleReturn.exec');
  g.wire('prepare.claim', 'map.claim');
  g.wire('map.x837', 'frequency.x837');
  g.wire('entry.frequency', 'frequency.frequency');
  g.wire('frequency.x837', 'file.x837');
  g.wire('file.filed', 'send.exec');
  g.wire('file.controlNumber', 'send.controlNumber');
  g.wire('file.stale', 'staleReturn.exec');
  g.wire('file.blocked', 'why.exec');
  g.wire('file.reason', 'why.value');
  g.wire('why.then', 'submit.exec');
  g.wire('send.sent', 'sentReturn.exec');
  g.wire('send.manual', 'sentReturn.exec');
  g.wire('entry.context', 'filingContext.object', 'fix.context');
  g.wire('reason.value', 'filingContext.value');
  g.wire('entry.subject', 'submit.subject', 'fix.subject');
  g.wire('filingContext.object', 'submit.context');
  summary(
    g,
    'submit',
    'The 837P to {payer} could not be created: {reason}; fix it and try again, or skip the payer',
    {
      payer: payerOr(g, 'filingContext.object', 'the payer', 'Payer, Else the Payer'),
      reason: orElse(
        g,
        'reasonGiven',
        'Reason, Else None Given',
        'reason.value',
        fixed('no reason was given')
      )
    }
  );
  g.wire('submit.tryAgain', 'retryReturn.exec');
  g.wire('submit.fixData', 'fix.exec');
  g.wire('submit.skipPayer', 'skip.exec');
  g.wire('submit.submitted', 'submitted.exec');
  g.wire('submitted.then', 'sentReturn.exec');
  g.wire('skip.then', 'skippedReturn.exec');
  g.wire('fix.fixed', 'retryReturn.exec');
  g.wire('fix.backToReview', 'retryReturn.exec');
  g.wire('fix.voided', 'voidReturn.exec');
  return g.def;
};

const UNDERPAID_PRIORITY = 2;

type Uncompared = {
  id: string;
  label: string;
  reason: string;
  inputs: Record<string, [ValueType, Port]>;
  test: Test;
};

const UNCOMPARED: Uncompared[] = [
  {
    id: 'notMedicare',
    label: 'The Payer Is Not Medicare',
    reason: 'The payer is not Medicare',
    inputs: { medicare: ['boolean', 'medicare.found'] },
    test: { field: 'medicare', op: 'isNot', value: true }
  },
  {
    id: 'secondary',
    label: 'Medicare Pays After Another Payer',
    reason: 'Medicare pays after another payer',
    inputs: { primary: ['boolean', 'entry.primary'] },
    test: { field: 'primary', op: 'is', value: false }
  },
  {
    id: 'severalPatients',
    label: 'Several Patients Shared the Trip',
    reason: 'Several patients shared the trip (GM)',
    inputs: { severalPatients: ['boolean', 'entry.severalPatients'] },
    test: { field: 'severalPatients', op: 'is', value: true }
  },
  {
    id: 'denialExpected',
    label: 'Medicare Is Expected to Deny the Trip',
    reason: 'Medicare is expected to deny the trip (GZ)',
    inputs: { denialExpected: ['boolean', 'entry.denialExpected'] },
    test: { field: 'denialExpected', op: 'is', value: true }
  },
  {
    id: 'noReasonCodes',
    label: 'No Reason Codes Came',
    reason: 'The response came without reason codes',
    inputs: { reasonCoded: ['boolean', 'entry.reasonCoded'] },
    test: { field: 'reasonCoded', op: 'is', value: false }
  },
  {
    id: 'notPriced',
    label: 'No Fee Schedule for the Year',
    reason: 'There is no fee schedule for the year of service',
    inputs: { priced: ['boolean', 'priced.result'] },
    test: { field: 'priced', op: 'is', value: false }
  }
];

const underpayment = (): GraphDef => {
  const g = rule(
    [
      d(
        'payerKind',
        'string',
        'Payer Kind',
        'The claim filing indicator of the payer that answered.',
        true
      ),
      d(
        'primary',
        'boolean',
        'Primary Payer',
        'The payer that answered is the first payer on the claim.'
      ),
      d(
        'severalPatients',
        'boolean',
        'Several Patients',
        'The trip carried more than one patient, so Medicare pays a share of the rates (GM).'
      ),
      d(
        'denialExpected',
        'boolean',
        'Denial Expected',
        'Medicare is expected to deny the transport (GZ).'
      ),
      d(
        'reasonCoded',
        'boolean',
        'Reason Codes Sent',
        'The payer sent reason codes, so what it allowed can be worked out.'
      ),
      d(
        'medicareAllowedCents',
        'integer',
        'Medicare Fee Schedule (Cents)',
        'What the Medicare ambulance fee schedule of the year of service allows for the trip at its pickup locality, never more than charged.'
      ),
      d(
        'payerAllowedCents',
        'integer',
        'Payer Allowed (Cents)',
        "What the payer allowed: its payments, the patient's deductible, coinsurance and copay, and sequestration."
      )
    ],
    [
      d(
        'compared',
        'boolean',
        'Compared',
        'Whether the response can be held against the Medicare fee schedule at all.'
      ),
      d(
        'underpaidCents',
        'integer',
        'Underpaid (Cents)',
        'How far the payer allowed less than the fee schedule.'
      ),
      d('underpaid', 'boolean', 'Underpaid', 'Whether a biller should take the shortfall up.'),
      d('priority', 'integer', 'Task Priority', 'The priority of the reconcile task.'),
      P.reasons('the response is or is not an underpayment')
    ]
  );
  g.add('difference', 'std.math.subtract', { label: 'Allowed Below the Fee Schedule' });
  g.add('shortfall', 'std.math.max', { label: 'Shortfall, at Least Zero', values: { b: 0 } });
  condition(
    g,
    'priced',
    'Fee Schedule Found',
    { medicareAllowedCents: ['integer', 'entry.medicareAllowedCents'] },
    [{ field: 'medicareAllowedCents', op: 'gt', value: 0 }]
  );
  isListed(g, 'medicare', 'Medicare Payer', MEDICARE_CLAIM_FILINGS, 'entry.payerKind');
  const exclusions = UNCOMPARED.map((u) => ({
    ...u,
    when: condition(g, u.id, u.label, u.inputs, [u.test])
  }));
  const compared = condition(
    g,
    'compared',
    'Held Against the Fee Schedule',
    Object.fromEntries(exclusions.map((u) => [u.id, ['boolean', u.when]])),
    exclusions.map((u) => ({ field: u.id, op: 'is', value: false }))
  );
  g.add('threshold', 'std.table.lookup', {
    label: 'Underpayment Threshold',
    config: shared.lookup(
      'billing.underpayment-limits',
      'Underpayment Limits',
      'How far below the Medicare fee schedule a Medicare primary payer may allow before a biller takes it up. Underpayment Threshold (Cents): a shortfall above it is an underpayment.',
      { type: 'integer', rows: [{ key: 'Underpayment Threshold (Cents)', value: 100 }] }
    ),
    values: { key: 'Underpayment Threshold (Cents)' }
  });
  const underpaid = condition(
    g,
    'underpaid',
    'Allowed Too Far Below the Fee Schedule',
    {
      compared: ['boolean', compared],
      shortfallCents: ['integer', 'shortfall.result'],
      thresholdCents: ['integer', 'threshold.value']
    },
    [
      { field: 'compared', op: 'is', value: true },
      { field: 'shortfallCents', op: 'gt', input: 'thresholdCents' }
    ]
  );
  const underpaidText = template(
    g,
    'underpaidText',
    'Underpaid Reason',
    'The payer allowed {shortfall} below the Medicare fee schedule, more than the {threshold} limit',
    {
      shortfall: money(g, 'shortfallText', 'Shortfall', 'shortfall.result'),
      threshold: money(g, 'thresholdText', 'Limit', 'threshold.value')
    }
  );
  const reasons = makeList(g, 'reasons', 'Reasons', 'string', [
    ...exclusions.map((u) => select(g, `${u.id}Why`, `${u.label}, Why`, u.when, fixed(u.reason))),
    select(g, 'underpaidWhy', 'Underpaid', underpaid, underpaidText)
  ]);
  g.ret('return');
  g.wire('entry.medicareAllowedCents', 'difference.a');
  g.wire('entry.payerAllowedCents', 'difference.b');
  g.wire('difference.result', 'shortfall.a');
  g.wire('shortfall.result', 'return.underpaidCents');
  g.wire(compared, 'return.compared');
  g.wire(underpaid, 'return.underpaid');
  g.wire(
    select(g, 'priority', 'Raised When Underpaid', underpaid, fixed(UNDERPAID_PRIORITY), fixed(0)),
    'return.priority'
  );
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const payerIsCoverage = (): GraphDef => {
  const g = rule(
    [
      d('payer', CLAIM_PAYER, 'Claim Payer', 'A payer on the claim.', true),
      d('coverageId', { id: 'coverage' }, 'Payer', 'The coverage to look for.', true)
    ],
    [d('matches', 'boolean', 'Matches', 'Whether the payer is that coverage.')]
  );
  g.add('matches', 'std.logic.equal', { label: 'Same Coverage' });
  g.ret('return');
  g.wire(
    getField(g, 'payerCoverage', 'Coverage of the Payer', CLAIM_PAYER, 'coverageId', 'entry.payer'),
    'matches.a'
  );
  g.wire('entry.coverageId', 'matches.b');
  g.wire('matches.result', 'return.matches');
  return g.def;
};

const feeScheduleFacts = (): GraphDef => {
  const g = rule(
    [
      d('claim', { object: {} }, 'Claim', 'The saved claim, as Read Claim for Checks gives it.'),
      d('coverageId', { id: 'coverage' }, 'Payer', 'The payer whose response is reconciled.', true)
    ],
    [
      d(
        'priceable',
        'boolean',
        'Can Be Priced',
        'The claim has lines, a pickup ZIP code and a date of service, so the fee schedule can price it.'
      ),
      d('lines', PRICED_LINES, 'Charge Lines', "Each line's code, units and charge."),
      d('pickupZip', 'string', 'Pickup ZIP Code', 'The ZIP code the trip started at.', true),
      d('serviceDate', 'string', 'Date of Service', 'The date of the trip.', true),
      d('payerKind', 'string', 'Payer Kind', 'The claim filing indicator of the payer.', true),
      d('primary', 'boolean', 'Primary Payer', 'The payer is the first payer on the claim.'),
      d(
        'severalPatients',
        'boolean',
        'Several Patients',
        'The trip carried more than one patient.'
      ),
      d('denialExpected', 'boolean', 'Denial Expected', 'Medicare is expected to deny the trip.')
    ]
  );
  const claim = 'entry.claim';
  const documentation = 'details.documentation';
  const lines = pathOf(g, 'claimLines', 'Claim Lines', 'lines', claim);
  const zip = pathOf(g, 'pickupZip', 'Pickup ZIP Code', 'details.pickup.postalCode', claim);
  const date = pathOf(g, 'serviceDate', 'Date of Service', 'details.serviceDate', claim);
  const priceable = condition(
    g,
    'priceable',
    'Lines, Pickup ZIP and Date of Service Are Known',
    { lines: [{ list: 'any' }, lines], pickupZip: ['string', zip], serviceDate: ['string', date] },
    [
      { field: 'lines', op: 'present' },
      { field: 'pickupZip', op: 'present' },
      { field: 'serviceDate', op: 'present' }
    ]
  );
  g.add('chargeLines', 'std.list.reshape', {
    label: 'Charge Lines',
    config: {
      fields: [
        { name: 'code', type: { code: 'hcpcs' }, from: 'code' },
        { name: 'units', type: 'number', from: 'units' },
        { name: 'chargeCents', type: 'integer', from: 'totalCents' }
      ]
    }
  });
  g.add('payer', 'std.list.find-rule', {
    label: 'Payer That Answered',
    config: { rule: 'billing.payer-is-coverage', version: 1, item: 'payer', test: 'matches' }
  });
  const primary = condition(
    g,
    'primary',
    'Payer Is First on the Claim',
    { position: ['integer', 'payer.index'] },
    [{ field: 'position', op: 'is', value: 0 }]
  );
  const severalPatients = condition(
    g,
    'severalPatients',
    'More Than One Patient',
    {
      patientCount: [
        'integer',
        pathOf(g, 'patientCount', 'Patient Count', `${documentation}.patientCount`, claim)
      ]
    },
    [{ field: 'patientCount', op: 'gt', value: 1 }]
  );
  const denialExpected = condition(
    g,
    'denialExpected',
    'Denial Expected',
    {
      denialExpected: [
        'boolean',
        pathOf(g, 'denialFlag', 'Denial Expected Flag', `${documentation}.denialExpected`, claim)
      ]
    },
    [{ field: 'denialExpected', op: 'is', value: true }]
  );
  g.ret('return');
  g.wire(lines, 'chargeLines.list');
  g.wire(pathOf(g, 'payers', 'Claim Payers', 'payers', claim), 'payer.list');
  g.wire('entry.coverageId', 'payer.coverageId');
  g.wire(
    getField(g, 'payerKind', 'Payer Kind', CLAIM_PAYER, 'claimFiling', 'payer.item'),
    'return.payerKind'
  );
  g.wire(priceable, 'return.priceable');
  g.wire('chargeLines.list', 'return.lines');
  g.wire(zip, 'return.pickupZip');
  g.wire(date, 'return.serviceDate');
  g.wire(primary, 'return.primary');
  g.wire(severalPatients, 'return.severalPatients');
  g.wire(denialExpected, 'return.denialExpected');
  return g.def;
};

const reconcileSummary = (): GraphDef => {
  const g = rule(
    [
      DETAILS_PIN,
      d(
        'medicareAllowed',
        MEDICARE_ALLOWED,
        'Medicare Allowed',
        'What the Medicare fee schedule allows for the trip and how the payer compares, when Medicare pays first.',
        true
      )
    ],
    [SUMMARY_PIN]
  );
  g.add('allowed', 'std.object.break', {
    label: 'Medicare Allowed',
    config: {
      fields: Object.entries(ALLOWED_FIELDS).map(([name, type]) => ({ name, type }))
    }
  });
  const balance = balanceOf(g, 'entry.context');
  const ofTotal = template(g, 'balanceOfTotal', 'Balance of Total', '[{balance} of {total} is]', {
    balance,
    total: totalOf(g, 'entry.context')
  });
  const alone = template(g, 'balanceAlone', 'Balance Alone', '[{balance} is]', { balance });
  g.add('open', 'std.logic.choose', {
    label: 'What Is Open',
    config: { mode: 'first', type: 'string', count: 3 },
    values: { option3: 'a balance is' }
  });
  g.add('rurality', 'std.table.lookup', {
    label: 'Kind of Trip',
    config: {
      type: 'string',
      rows: Object.entries(RURALITY_WORDS).map(([key, value]) => ({ key, value })),
      fallback: 'ambulance'
    }
  });
  const amounts = {
    allowed: money(g, 'allowedText', 'Medicare Allows', 'allowed.allowedCents'),
    rurality: 'rurality.value' as const
  };
  const underpaidNote = template(
    g,
    'underpaidNote',
    'Underpaid Note',
    '; underpaid: the payer allowed {payerAllowed}, {underpaid} less than the {allowed} Medicare allows for this {rurality} trip; reopen or appeal it, or',
    {
      ...amounts,
      payerAllowed: money(g, 'payerAllowedText', 'Payer Allowed', 'allowed.payerAllowedCents'),
      underpaid: money(g, 'underpaidText', 'Underpaid', 'allowed.underpaidCents')
    }
  );
  const allowsNote = template(
    g,
    'allowsNote',
    'Fee Schedule Note',
    '; Medicare allows {allowed} for this {rurality} trip;',
    amounts
  );
  g.add('medicareNote', 'std.logic.choose', {
    label: 'Underpaid or Fee Schedule Note',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] }
  });
  g.add('medicare', 'std.logic.choose', {
    label: 'Medicare Note When Compared',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { otherwise: ';' }
  });
  const text = template(
    g,
    'text',
    'Task Summary',
    '{payer} answered and {open} still open{medicare} reconcile it, move on or write it off',
    {
      payer: payerOr(g, 'entry.context', 'The payer', 'Payer, Else the Payer'),
      open: 'open.value',
      medicare: 'medicare.value'
    }
  );
  g.ret('return');
  g.wire('entry.medicareAllowed', 'allowed.object');
  g.wire(ofTotal, 'open.option1');
  g.wire(alone, 'open.option2');
  g.wire('allowed.rurality', 'rurality.key');
  g.wire('allowed.underpaid', 'medicareNote.key');
  g.wire(underpaidNote, 'medicareNote.case1');
  g.wire(allowsNote, 'medicareNote.otherwise');
  g.wire('allowed.compared', 'medicare.key');
  g.wire('medicareNote.value', 'medicare.case1');
  g.wire(text, 'return.summary');
  return g.def;
};

const reconcilePayment = (): GraphDef => {
  const g = claimStep(
    ['done', 'writeOff', 'void'],
    [p('coverageId', { id: 'coverage' }, true)],
    [
      { name: 'medicareAllowed', type: 'any', default: null },
      { name: 'priority', type: 'integer', default: 0 }
    ]
  );
  g.add('readClaim', 'billing.read-claim', { label: 'Read the Claim' });
  g.add('facts', 'billing.fee-schedule-facts', { label: 'Fee Schedule Facts' });
  g.add('price', 'std.flow.branch', { label: 'Can Medicare Price It?' });
  g.add('locality', 'billing.find-medicare-locality', { label: 'Pickup Locality' });
  g.add('allowed', 'billing.medicare-allowed', { label: 'Medicare Allowed' });
  g.add('response', 'billing.read-payer-response', { label: 'Read Payer Response' });
  g.add('amounts', 'billing.payer-response-amounts', { label: 'What the Payer Allowed' });
  g.add('underpayment', 'billing.underpayment', { label: 'Underpayment' });
  const allowedFacts = makeObject(g, 'allowedFacts', 'What Medicare Allows', {
    compared: ['boolean', 'underpayment.compared'],
    allowedCents: ['integer', 'allowed.totalCents'],
    rurality: ['string', 'locality.rurality'],
    carrier: ['string', 'locality.carrier'],
    locality: ['string', 'locality.locality'],
    codesNotPriced: [{ list: { code: 'hcpcs' } }, 'allowed.missing'],
    payerAllowedCents: ['integer', 'amounts.allowedCents'],
    underpaidCents: ['integer', 'underpayment.underpaidCents'],
    underpaid: ['boolean', 'underpayment.underpaid']
  });
  g.add('keepPriority', 'std.var.set', {
    label: 'Keep the Priority',
    config: { name: 'priority' }
  });
  g.add('priority', 'std.var.get', { label: 'Task Priority', config: { name: 'priority' } });
  g.add('keepAllowed', 'std.var.set', {
    label: 'Keep What Medicare Allows',
    config: { name: 'medicareAllowed' }
  });
  g.add('medicareAllowed', 'std.var.get', {
    label: 'Medicare Allowed for the Trip',
    config: { name: 'medicareAllowed' }
  });
  g.add('taskContext', 'std.object.set', {
    label: 'Details with Medicare Allowed',
    values: { path: 'medicareAllowed' }
  });
  g.add('reconcile', 'std.human.task', {
    label: 'Reconcile Payment',
    config: {
      title: 'Reconcile payment',
      queue: 'billing-reconcile',
      instructions:
        'The payer answered and a balance remains. Check what they paid and adjusted, with their reason codes, against the claim, and record anything missing. When Medicare pays first, the details show what the Medicare ambulance fee schedule allows for the trip at its pickup locality (urban, rural or super-rural), so an underpayment stands out. Continue to the next payer or the patient, write off the rest, or correct the claim the way this payer takes corrections.',
      outcomes: ['continue', 'writeOff', 'resubmitCorrected'],
      hints: {
        continue:
          'Marks the response reconciled; the claim moves on to the next payer, or to the patient.',
        writeOff:
          'Writes off the balance and closes the claim, once approved when it is above the approval limit.',
        resubmitCorrected:
          'Corrects the claim the way this payer takes corrections (Correct Claim): a replacement or new claim after the data is corrected, or a reopening request.'
      }
    }
  });
  g.add('reconcileSummary', 'billing.reconcile-summary', { label: 'Task Summary' });
  recordEvent(g, 'reconciled', 'reconciled', 'Mark the Response Reconciled');
  g.add('correct', 'billing.correct-claim', { label: 'Correct Claim' });
  g.ret('doneReturn', 'done');
  g.ret('writeOffReturn', 'writeOff');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'readClaim.exec');
  g.wire('entry.claimId', 'readClaim.claimId', 'response.claimId');
  g.wire('entry.coverageId', 'response.coverageId', 'facts.coverageId');
  g.wire('readClaim.claim', 'facts.claim');
  g.wire('readClaim.then', 'price.exec');
  g.wire('facts.priceable', 'price.condition');
  g.wire('price.true', 'locality.exec');
  g.wire('price.false', 'reconcile.exec');
  g.wire('facts.pickupZip', 'locality.postalCode');
  g.wire('locality.found', 'allowed.exec');
  g.wire('locality.notFound', 'reconcile.exec');
  g.wire('facts.lines', 'allowed.lines');
  g.wire('facts.serviceDate', 'allowed.serviceDate');
  g.wire('locality.carrier', 'allowed.carrier');
  g.wire('locality.locality', 'allowed.locality');
  g.wire('locality.rurality', 'allowed.rurality');
  for (const pin of ['payerKind', 'primary', 'severalPatients', 'denialExpected']) {
    g.wire(`facts.${pin}`, `underpayment.${pin}`);
  }
  g.wire('allowed.totalCents', 'underpayment.medicareAllowedCents');
  g.wire('allowed.then', 'response.exec');
  g.wire('response.then', 'keepAllowed.exec');
  g.wire('response.paidCents', 'amounts.paidCents');
  g.wire('response.adjustments', 'amounts.adjustments');
  g.wire('amounts.allowedCents', 'underpayment.payerAllowedCents');
  g.wire('amounts.reasonCoded', 'underpayment.reasonCoded');
  g.wire('underpayment.priority', 'keepPriority.value');
  g.wire('priority.value', 'reconcile.priority');
  g.wire(allowedFacts, 'keepAllowed.value');
  g.wire('keepAllowed.then', 'keepPriority.exec');
  g.wire('keepPriority.then', 'reconcile.exec');
  g.wire('medicareAllowed.value', 'taskContext.value', 'reconcileSummary.medicareAllowed');
  g.wire('entry.context', 'taskContext.object', 'correct.context');
  g.wire('entry.subject', 'reconcile.subject', 'correct.subject');
  g.wire('taskContext.object', 'reconcile.context', 'reconcileSummary.context');
  g.wire('reconcileSummary.summary', 'reconcile.summary');
  g.wire('entry.claimId', 'reconciled.claimId', 'correct.claimId');
  g.wire('entry.coverageId', 'reconciled.coverageId', 'correct.coverageId');
  g.wire('reconcile.continue', 'reconciled.exec');
  g.wire('reconcile.resubmitCorrected', 'correct.exec');
  g.wire('reconcile.writeOff', 'writeOffReturn.exec');
  g.wire('reconciled.then', 'doneReturn.exec');
  g.wire('correct.done', 'doneReturn.exec');
  g.wire('correct.void', 'voidReturn.exec');
  return g.def;
};

const RESUBMIT_HINT =
  'Resubmits the claim the way this payer takes corrections (Correct Claim): a new claim, or a replacement or reopening when the payer has its claim number.';

const FOLLOW_UPS = [
  [
    'keepWaiting',
    'follow_up',
    'Keep Waiting on the Payer',
    'Keeps waiting on this payer; the claim is followed up again if it still does not answer.'
  ],
  [
    'nextPayer',
    'payer_skipped',
    'Move On from the Payer',
    'Moves on from this payer to the next payer, or to the patient when none is left.'
  ]
] as const;

const followUpPayer = (): GraphDef => {
  const g = claimStep(
    ['done', 'void'],
    [
      p('coverageId', { id: 'coverage' }, true),
      d(
        'statusWaitMs',
        'integer',
        'Claim Status Wait (Milliseconds)',
        'How long to wait for the payer to answer the claim status request, from the Claim Policy.'
      )
    ]
  );
  g.add('ask', 'billing.send-276', { label: 'Ask the Payer for the Claim Status' });
  g.add('wait', 'std.flow.wait-signal', {
    label: 'Await the Claim Status',
    values: { name: CLAIM_SIGNAL }
  });
  g.add('latest', 'billing.latest-claim-status', { label: 'Latest Claim Status' });
  g.add('withStatus', 'std.object.set', {
    label: 'Details with the Claim Status',
    values: { path: 'claimStatus' }
  });
  g.add('followUp', 'std.human.task', {
    label: 'Follow Up with Payer',
    config: {
      title: 'Follow up on claim',
      queue: 'billing-followup',
      instructions:
        "The payer has not responded in time. The payer's latest claim status (277), when it gave one, is in the details. Resubmit it, keep waiting, or move on to the next payer. A resubmission goes through Correct Claim: when the payer has the claim on file, enter its claim number so it is replaced or reopened the way the payer takes corrections, else it goes as a new claim.",
      fields: [{ name: 'payerClaimNumber', type: 'string', label: 'Payer Claim Number' }],
      outcomes: ['resubmit', ...FOLLOW_UPS.map(([outcome]) => outcome)],
      hints: {
        resubmit: RESUBMIT_HINT,
        ...Object.fromEntries(FOLLOW_UPS.map(([outcome, , , hint]) => [outcome, hint]))
      }
    }
  });
  g.add('correct', 'billing.correct-claim', { label: 'Correct Claim' });
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'ask.exec');
  g.wire('followUp.resubmit', 'correct.exec');
  g.wire('entry.claimId', 'correct.claimId');
  g.wire('entry.coverageId', 'correct.coverageId');
  g.wire('entry.subject', 'correct.subject');
  g.wire('entry.context', 'correct.context');
  g.wire('followUp.payerClaimNumber', 'correct.payerClaimNumber');
  g.wire('correct.done', 'doneReturn.exec');
  g.wire('correct.void', 'voidReturn.exec');
  g.wire('entry.claimId', 'ask.claimId', 'wait.key', 'latest.claimId');
  g.wire('entry.coverageId', 'ask.coverageId');
  g.wire('ask.sent', 'wait.exec');
  g.wire('entry.statusWaitMs', 'wait.timeoutMs');
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
  summary(
    g,
    'followUp',
    '{payer} has not answered this claim in time[ (latest status: {context.claimStatus})]; resubmit it, keep waiting or move on',
    {
      payer: payerOr(g, 'withStatus.object', 'The payer', 'Payer, Else the Payer'),
      context: 'withStatus.object'
    }
  );
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

const statementSummaries = (): GraphDef => {
  const g = rule(
    [p('statementNumber', 'integer', true), p('statementCount', 'integer', true), DETAILS_PIN],
    [
      d(
        'profileNeeded',
        'string',
        'Billing Profile Needed',
        'The summary of the task asking for the billing profile.'
      ),
      d(
        'addressNeeded',
        'string',
        'Patient Address Needed',
        "The summary of the task asking for the patient's mailing address."
      )
    ]
  );
  const ofCount = template(g, 'ofCount', 'Statement of Count', '[statement {number} of {count}]', {
    number: 'entry.statementNumber',
    count: 'entry.statementCount'
  });
  const alone = template(g, 'alone', 'Statement Alone', '[statement {number}]', {
    number: 'entry.statementNumber'
  });
  g.add('statement', 'std.logic.choose', {
    label: 'Which Statement',
    config: { mode: 'first', type: 'string', count: 3 },
    values: { option3: 'a statement' }
  });
  g.add('gaps', 'billing.address-gaps', { label: 'Address Gaps' });
  g.add('missingText', 'std.text.join', {
    label: 'Missing Parts',
    values: { separator: ', ', last: ' or ' }
  });
  const balance = balanceOf(g, 'entry.context');
  const profile = template(
    g,
    'profileText',
    'Profile Needed Text',
    'Add the billing profile in Settings so {statement} can go to the patient[ for {balance}]',
    { statement: 'statement.value', balance }
  );
  const address = template(
    g,
    'addressText',
    'Address Needed Text',
    '{missing}, so {statement} cannot be sent; enter it or write off {balance}',
    {
      missing: orElse(
        g,
        'missing',
        'Missing Parts, Else No Usable Address',
        template(g, 'missingParts', 'Address Lacks Parts', '[The patient address has no {parts}]', {
          parts: 'missingText.text'
        }),
        fixed('The patient has no usable mailing address')
      ),
      statement: 'statement.value',
      balance: orElse(
        g,
        'balanceOrRest',
        'Balance, Else the Balance',
        balance,
        fixed('the balance')
      )
    }
  );
  g.ret('return');
  g.wire('gaps.missing', 'missingText.items');
  g.wire(ofCount, 'statement.option1');
  g.wire(alone, 'statement.option2');
  g.wire(
    getField(g, 'address', 'Patient Address', TASK_DETAILS, 'claim.patient', 'entry.context'),
    'gaps.place'
  );
  g.wire(profile, 'return.profileNeeded');
  g.wire(address, 'return.addressNeeded');
  return g.def;
};

const billPatient = (): GraphDef => {
  const g = claimStep(
    ['done', 'writeOff'],
    [p('statementNumber', 'integer'), p('statementCount', 'integer')]
  );
  g.add('balance', 'billing.read-patient-balance', { label: 'Read Patient Balance' });
  g.add('responsibility', 'billing.patient-responsibility', { label: 'Patient Responsibility' });
  g.add('protect', 'billing.protect-balance', { label: 'Protect Patient Balance' });
  const owes = condition(
    g,
    'owes',
    'The Patient Owes Something',
    { responsibilityCents: ['integer', 'responsibility.responsibilityCents'] },
    [{ field: 'responsibilityCents', op: 'gt', value: 0 }]
  );
  g.add('billable', 'std.flow.branch', { label: 'Bill the Patient?' });
  g.add('statement', 'billing.issue-statement', { label: 'Send Patient Statement' });
  g.add('missing', 'std.flow.switch', {
    label: 'What the Statement Needs',
    config: { cases: ['profile', 'patientAddress'] }
  });
  g.add('summaries', 'billing.statement-task-summaries', { label: 'Task Summaries' });
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
  g.wire(joinText(g, 'why', 'Why Protected', '; ', 'responsibility.reasons'), 'protect.note');
  g.wire('responsibility.excessCents', 'protect.adjustedCents');
  g.wire('balance.then', 'protect.exec');
  g.wire('protect.then', 'billable.exec');
  g.wire(owes, 'billable.condition');
  g.wire('billable.true', 'statement.exec');
  g.wire('billable.false', 'doneReturn.exec');
  g.wire('entry.statementNumber', 'statement.statementNumber', 'summaries.statementNumber');
  g.wire('entry.statementCount', 'statement.statementCount', 'summaries.statementCount');
  g.wire('entry.subject', 'profileNeeded.subject', 'addressNeeded.subject');
  g.wire('entry.context', 'profileNeeded.context', 'addressNeeded.context', 'summaries.context');
  g.wire('summaries.profileNeeded', 'profileNeeded.summary');
  g.wire('summaries.addressNeeded', 'addressNeeded.summary');
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
  field('payerWaitDays', 'number', 'Payer Wait (Days)'),
  field('statementCount', 'integer', 'Statements to Send'),
  field('statementIntervalDays', 'number', 'Days Between Statements'),
  field('facilityWaitDays', 'number', 'Facility Wait (Days)'),
  field('reviewWaitDays', 'number', 'Payer File Review Wait (Days)'),
  field('statusWaitDays', 'number', 'Claim Status Wait (Days)'),
  field('collectionsThresholdCents', 'integer', 'Collections Threshold (Cents)'),
  field('autoWriteOffCents', 'integer', 'Auto Write-Off Limit (Cents)'),
  field('reviewRequired', 'boolean', 'Review Required'),
  field('writeOffApprovalCents', 'integer', 'Write-Off Approval Limit (Cents)'),
  field('collectionsApprovalCents', 'integer', 'Collections Approval Limit (Cents)')
];

type Situation = {
  id: string;
  label: string;
  reason: string;
  step: string;
  stepLabel?: string;
  inputs: Record<string, [ValueType, Port]>;
  rules: Test[];
};

const ledgerPin = (name: string, type: ValueType): [ValueType, Port] => [type, `ledger.${name}`];

const BALANCE = ledgerPin('balanceCents', 'integer');

const BILLED = ledgerPin('coverageId', { id: 'coverage' });

const DECISION: ValueType = { object: { step: 'string', reason: 'string' } };

const SITUATIONS: Situation[] = [
  {
    id: 'creditInReview',
    label: 'A Credit Waits on a Payer File Line',
    reason: 'There is a credit balance while a payer file line on the claim waits for a biller',
    step: 'awaitReview',
    inputs: {
      pendingReview: ledgerPin('pendingReview', 'boolean'),
      balanceCents: BALANCE
    },
    rules: [
      { field: 'pendingReview', op: 'is', value: true },
      { field: 'balanceCents', op: 'lt', value: 0 }
    ]
  },
  {
    id: 'overpaid',
    label: 'More Was Paid Than Charged',
    reason: 'More was paid than charged',
    step: 'overpaid',
    inputs: { balanceCents: BALANCE },
    rules: [{ field: 'balanceCents', op: 'lt', value: 0 }]
  },
  {
    id: 'denialOpen',
    label: 'A Denial Waits to Be Worked',
    reason: 'A payer denial waits to be worked',
    step: 'workDenial',
    inputs: { denialRoute: ledgerPin('denialRoute', 'string') },
    rules: [{ field: 'denialRoute', op: 'present' }]
  },
  {
    id: 'nothingOwed',
    label: 'Nothing Is Owed',
    reason: 'Nothing is owed',
    step: 'closed',
    inputs: { balanceCents: BALANCE },
    rules: [{ field: 'balanceCents', op: 'lte', value: 0 }]
  },
  {
    id: 'reconciling',
    label: 'A Response Waits to Be Reconciled',
    reason: 'A payer response waits to be reconciled',
    step: 'reconcile',
    inputs: { unreconciledCoverageId: ledgerPin('unreconciledCoverageId', { id: 'coverage' }) },
    rules: [{ field: 'unreconciledCoverageId', op: 'present' }]
  },
  {
    id: 'facilityHasTime',
    label: 'The Facility Still Has Time to Pay',
    reason: 'The responsible facility still has time to pay',
    step: 'facility',
    inputs: {
      billFacility: ledgerPin('billFacility', 'boolean'),
      facilityWaitLeftMs: ['integer', 'facilityWaitLeftMs.leftMs']
    },
    rules: [
      { field: 'billFacility', op: 'is', value: true },
      { field: 'facilityWaitLeftMs', op: 'gt', value: 0 }
    ]
  },
  {
    id: 'facilityResponsible',
    label: 'A Facility Is Responsible',
    reason: 'A facility is responsible and its time to pay is up',
    step: 'followUpFacility',
    inputs: { billFacility: ledgerPin('billFacility', 'boolean') },
    rules: [{ field: 'billFacility', op: 'is', value: true }]
  },
  {
    id: 'needsReview',
    label: 'The Claim Needs Review Before the Payer',
    reason: 'The claim needs review before it goes to this payer',
    step: 'review',
    inputs: {
      coverageId: BILLED,
      contacted: ledgerPin('contacted', 'boolean'),
      approved: ledgerPin('approved', 'boolean'),
      reviewRequired: ['boolean', 'policy.reviewRequired']
    },
    rules: [
      { field: 'coverageId', op: 'present' },
      { field: 'contacted', op: 'is', value: false },
      { field: 'approved', op: 'is', value: false },
      { field: 'reviewRequired', op: 'is', value: true }
    ]
  },
  {
    id: 'readyToFile',
    label: 'The Payer Does Not Have the Claim Yet',
    reason: 'The claim is ready to file to this payer',
    step: 'submit',
    inputs: { coverageId: BILLED, contacted: ledgerPin('contacted', 'boolean') },
    rules: [
      { field: 'coverageId', op: 'present' },
      { field: 'contacted', op: 'is', value: false }
    ]
  },
  {
    id: 'payerHasTime',
    label: 'The Payer Still Has Time to Answer',
    reason: 'The payer still has time to answer',
    step: 'await',
    inputs: { coverageId: BILLED, payerWaitLeftMs: ['integer', 'payerWaitLeftMs.result'] },
    rules: [
      { field: 'coverageId', op: 'present' },
      { field: 'payerWaitLeftMs', op: 'gt', value: 0 }
    ]
  },
  {
    id: 'payerBilled',
    label: 'A Payer Is Being Billed',
    reason: 'A payer is being billed and its time to answer is up',
    step: 'followUp',
    inputs: { coverageId: BILLED },
    rules: [{ field: 'coverageId', op: 'present' }]
  },
  {
    id: 'smallBalance',
    label: 'The Balance Is Within the Auto Write-Off Limit',
    reason: 'The balance is small enough to write off',
    step: 'writeOff',
    stepLabel: 'Write Off a Small Balance',
    inputs: { balanceCents: BALANCE, autoWriteOffCents: ['integer', 'policy.autoWriteOffCents'] },
    rules: [{ field: 'balanceCents', op: 'lte', input: 'autoWriteOffCents' }]
  },
  {
    id: 'reviewPatient',
    label: 'The Claim Needs Review Before the Patient',
    reason: 'The claim needs review before the patient is billed',
    step: 'reviewPatient',
    inputs: {
      statements: ledgerPin('statements', 'integer'),
      patientApproved: ledgerPin('patientApproved', 'boolean'),
      coverageCount: ledgerPin('coverageCount', 'integer')
    },
    rules: [
      { field: 'statements', op: 'lte', value: 0 },
      { field: 'patientApproved', op: 'is', value: false },
      { field: 'coverageCount', op: 'gt', value: 0 }
    ]
  },
  {
    id: 'patientNotApproved',
    label: 'The Patient Is Not Approved Before the First Statement',
    reason: 'The patient is not approved before the first statement',
    step: 'confirmPayers',
    inputs: {
      statements: ledgerPin('statements', 'integer'),
      patientApproved: ledgerPin('patientApproved', 'boolean')
    },
    rules: [
      { field: 'statements', op: 'lte', value: 0 },
      { field: 'patientApproved', op: 'is', value: false }
    ]
  },
  {
    id: 'statementNotDue',
    label: 'The Next Statement Is Not Due Yet',
    reason: 'The next statement is not due yet',
    step: 'awaitPatient',
    inputs: { statementWaitLeftMs: ['integer', 'statementWaitLeftMs.result'] },
    rules: [{ field: 'statementWaitLeftMs', op: 'gt', value: 0 }]
  },
  {
    id: 'statementsLeft',
    label: 'Statements Are Left to Send',
    reason: 'Statements are left to send',
    step: 'statement',
    inputs: {
      statementCount: ['integer', 'policy.statementCount'],
      statements: ledgerPin('statements', 'integer')
    },
    rules: [{ field: 'statementCount', op: 'gt', input: 'statements' }]
  },
  {
    id: 'underCollections',
    label: 'The Balance Is Under the Collections Threshold',
    reason: 'The balance is under the collections threshold',
    step: 'writeOff',
    stepLabel: 'Write Off Below Collections',
    inputs: {
      balanceCents: BALANCE,
      collectionsThresholdCents: ['integer', 'policy.collectionsThresholdCents']
    },
    rules: [{ field: 'balanceCents', op: 'lt', input: 'collectionsThresholdCents' }]
  }
];

const PAYER_STEPS = [
  ['workDenial', 'unreconciled'],
  ['reconcile', 'unreconciled'],
  ['review', 'billed'],
  ['submit', 'billed'],
  ['await', 'billed'],
  ['followUp', 'billed']
] as const;

const WAIT_STEPS = [
  ['await', 'payerWaitLeftMs.result'],
  ['awaitPatient', 'statementWaitLeftMs.result'],
  ['facility', 'facilityWaitLeftMs.leftMs'],
  ['awaitReview', 'reviewWait.leftMs']
] as const;

const claimWaitLeft = (): GraphDef => {
  const g = rule(
    [
      d('waitDays', 'number', 'Wait (Days)', 'How many days the Claim Policy waits.', true),
      d(
        'elapsedMs',
        'integer',
        'Elapsed (Milliseconds)',
        'How long ago the wait started, in milliseconds, or nothing when it has not been timed.',
        true
      )
    ],
    [
      d(
        'leftMs',
        'integer',
        'Wait Left (Milliseconds)',
        'How much of the wait is still to go, in milliseconds.',
        true
      )
    ]
  );
  g.add('waitMs', 'std.math.multiply', { label: 'Wait (Milliseconds)', values: { b: DAY_MS } });
  g.add('wholeMs', 'std.math.round', { label: 'Whole Milliseconds' });
  g.add('elapsed', 'std.logic.coalesce', { label: 'Elapsed, Else Zero', values: { fallback: 0 } });
  g.add('left', 'std.math.subtract', { label: 'Wait Left' });
  g.ret('return');
  g.wire('entry.waitDays', 'waitMs.a');
  g.wire('waitMs.result', 'wholeMs.value');
  g.wire('entry.elapsedMs', 'elapsed.value');
  g.wire('wholeMs.result', 'left.a');
  g.wire('elapsed.result', 'left.b');
  g.wire('left.result', 'return.leftMs');
  return g.def;
};

const nextClaimStep = (): GraphDef => {
  const g = rule(
    [d('ledger', T.ledger, 'Claim Ledger', 'Where the claim stands, read from its history.')],
    [
      d('step', 'string', 'Step', `The next step: ${CLAIM_STEPS.join(', ')}.`),
      d('coverageId', { id: 'coverage' }, 'Payer', 'The payer the step is about, if any.', true),
      d('payer', 'string', 'Payer Name', 'The name of that payer.', true),
      d(
        'waitMs',
        'integer',
        'How Long to Wait (Milliseconds)',
        'How long the await steps wait, in milliseconds.',
        true
      ),
      d(
        'statusWaitMs',
        'integer',
        'Claim Status Wait (Milliseconds)',
        'How long a follow-up waits for the payer to answer a claim status request, in milliseconds.',
        true
      ),
      d('statementNumber', 'integer', 'Statement', 'Which patient statement to send.', true),
      d('statementCount', 'integer', 'Statements', 'How many patient statements the policy sends.'),
      d(
        'writeOffApprovalCents',
        'integer',
        'Write-Off Approval Limit (Cents)',
        'The largest write-off closed without approval.'
      ),
      d(
        'collectionsApprovalCents',
        'integer',
        'Collections Approval Limit (Cents)',
        'The largest balance sent to collections without approval.'
      ),
      d('check', 'boolean', 'Check First', 'Whether the claim checks run before the step.'),
      d(
        'patientOnly',
        'boolean',
        'Patient Issues Only',
        'Whether only issues that matter for billing the patient count.'
      ),
      d(
        'reasons',
        { list: 'string' },
        'Reasons',
        'Why the claim is on this step: the situation that decided it.'
      )
    ]
  );
  g.add('ledger', 'billing.claim-ledger.break', { label: 'Claim Ledger' });
  g.add('policy', 'std.table.decide', {
    label: 'Claim Policy',
    config: shared.decision(
      'billing.claim-policy',
      'Claim Policy',
      'How the claim cycle works for each kind of payer billed (its claim filing indicator, or patient once no payer is left): how long it waits on a payer, a facility and a payer file line before acting, how long a follow-up waits for a claim status from the payer, how many patient statements it sends and how far apart, which balances it writes off or sends to collections review, whether a biller reviews the claim first, and the largest write-off and collections placement closed without approval from someone with claims:approve.',
      table([field('payerKind', 'string', 'Payer Kind')], POLICY_FIELDS, [], {
        payerWaitDays: 30,
        statementCount: 3,
        statementIntervalDays: 30,
        facilityWaitDays: 60,
        reviewWaitDays: 1,
        statusWaitDays: 1,
        collectionsThresholdCents: 0,
        autoWriteOffCents: 0,
        reviewRequired: true,
        writeOffApprovalCents: 50_000,
        collectionsApprovalCents: 0
      })
    )
  });
  const waitLeft = (id: string, label: string, days: string, elapsed?: string) => {
    g.add(id, 'billing.claim-wait-left', { label });
    g.wire(`policy.${days}`, `${id}.waitDays`);
    if (elapsed) g.wire(`ledger.${elapsed}`, `${id}.elapsedMs`);
    return `${id}.leftMs` as const;
  };
  const payerHasClaim = condition(
    g,
    'payerHasClaim',
    'The Payer Has the Claim',
    { contacted: ['boolean', 'ledger.contacted'] },
    [{ field: 'contacted', op: 'is', value: true }]
  );
  select(
    g,
    'payerWaitLeftMs',
    'Payer Wait Left, Else None',
    payerHasClaim,
    waitLeft('payerWait', 'Payer Wait Since Contact', 'payerWaitDays', 'sinceContactMs'),
    fixed(0)
  );
  const statementTimed = condition(
    g,
    'statementTimed',
    'A Statement Was Sent',
    {
      statements: ['integer', 'ledger.statements'],
      sinceStatementMs: ['integer', 'ledger.sinceStatementMs']
    },
    [
      { field: 'statements', op: 'gt', value: 0 },
      { field: 'sinceStatementMs', op: 'present' }
    ]
  );
  select(
    g,
    'statementWaitLeftMs',
    'Statement Wait Left, Else None',
    statementTimed,
    waitLeft(
      'statementWait',
      'Statement Wait Since the Last',
      'statementIntervalDays',
      'sinceStatementMs'
    ),
    fixed(0)
  );
  waitLeft(
    'facilityWaitLeftMs',
    'Facility Wait Left',
    'facilityWaitDays',
    'sinceFacilityContactMs'
  );
  waitLeft('reviewWait', 'Payer File Review Wait', 'reviewWaitDays');
  const held = SITUATIONS.map((s) => ({
    ...s,
    when: condition(g, s.id, s.label, s.inputs, s.rules)
  }));
  const decided = firstOf(
    g,
    'decided',
    'First Situation That Applies',
    DECISION,
    held.map((s) => ({
      id: `${s.id}Step`,
      label: s.stepLabel ?? `${labelOf(s.step)} Step`,
      when: s.when,
      value: fixed({ step: s.step, reason: s.reason })
    })),
    fixed({
      step: 'collections',
      reason: 'Every payer and statement is done and a balance remains'
    })
  );
  g.add('decision', 'std.object.break', {
    label: 'Step and Why',
    config: {
      fields: [
        { name: 'step', type: 'string' },
        { name: 'reason', type: 'string' }
      ]
    }
  });
  g.wire(decided, 'decision.object');
  const step = 'decision.step';
  const why = 'decision.reason';
  const stepIs = (id: string, label: string, steps: string[]) =>
    condition(g, id, label, { step: ['string', step] }, [
      { field: 'step', op: 'oneOf', value: steps }
    ]);
  g.add('waitLeft', 'std.logic.choose', {
    label: 'Wait Left for the Step',
    config: {
      mode: 'byCase',
      type: 'integer',
      cases: WAIT_STEPS.map(([when]) => ({ when }))
    }
  });
  g.add('waitMs', 'std.math.max', {
    label: 'At Least the Shortest Wait',
    values: { b: MIN_WAIT_MS }
  });
  g.add('nextStatement', 'std.math.add', { label: 'Next Statement', values: { b: 1 } });
  g.add('statementNumber', 'std.logic.choose', {
    label: 'Statement to Send',
    config: { mode: 'byCase', type: 'integer', cases: [{ when: 'statement' }] }
  });
  g.add('coverageId', 'std.logic.choose', {
    label: 'Payer of the Step',
    config: {
      mode: 'byCase',
      type: { id: 'coverage' },
      cases: PAYER_STEPS.map(([when]) => ({ when }))
    }
  });
  g.add('payerName', 'std.logic.choose', {
    label: 'Payer Name of the Step',
    config: { mode: 'byCase', type: 'string', cases: PAYER_STEPS.map(([when]) => ({ when })) }
  });
  g.ret('return');
  g.wire('entry.ledger', 'ledger.ledger');
  g.wire('ledger.payerKind', 'policy.payerKind');
  g.wire('policy.statementCount', 'return.statementCount');
  g.wire('ledger.statements', 'nextStatement.a');
  g.wire('policy.writeOffApprovalCents', 'return.writeOffApprovalCents');
  g.wire('policy.collectionsApprovalCents', 'return.collectionsApprovalCents');
  g.wire(waitLeft('statusWait', 'Claim Status Wait', 'statusWaitDays'), 'return.statusWaitMs');
  g.wire(step, 'statementNumber.key', 'waitLeft.key', 'coverageId.key', 'payerName.key');
  g.wire(step, 'return.step');
  for (const [i, [, port]] of WAIT_STEPS.entries()) g.wire(port, `waitLeft.case${i + 1}`);
  g.wire('waitLeft.value', 'waitMs.a');
  g.wire('nextStatement.result', 'statementNumber.case1');
  for (const [i, [, whose]] of PAYER_STEPS.entries()) {
    const response = whose === 'unreconciled';
    g.wire(
      response ? 'ledger.unreconciledCoverageId' : 'ledger.coverageId',
      `coverageId.case${i + 1}`
    );
    g.wire(response ? 'ledger.unreconciledPayer' : 'ledger.payer', `payerName.case${i + 1}`);
  }
  g.wire('coverageId.value', 'return.coverageId');
  g.wire('payerName.value', 'return.payer');
  g.wire('waitMs.result', 'return.waitMs');
  g.wire('statementNumber.value', 'return.statementNumber');
  g.wire(
    stepIs('checkFirst', 'The Step Checks the Claim First', [
      'review',
      'submit',
      'reviewPatient',
      'confirmPayers'
    ]),
    'return.check'
  );
  g.wire(
    stepIs('patientOnly', 'The Step Bills the Patient', ['reviewPatient', 'confirmPayers']),
    'return.patientOnly'
  );
  g.wire(makeList(g, 'reasons', 'Reasons', 'string', [why]), 'return.reasons');
  return g.def;
};

const claimTaskDetails = (): GraphDef => {
  const g = rule(
    [
      p('claimId', { id: 'claim' }),
      d('reference', 'string', 'Claim Reference', 'The claim number and patient name.', true),
      d('coverageId', { id: 'coverage' }, 'Payer', 'The payer the step is about, if any.', true),
      d('payer', 'string', 'Payer Name', 'The name of that payer.', true),
      d('balanceCents', 'integer', 'Balance (Cents)', 'What is still owed on the claim.', true),
      d('issues', T.issues, 'Issues', 'The issues the claim checks found, if they ran.', true),
      d('claim', { object: {} }, 'Claim', 'The saved claim the checks read, if they ran.', true)
    ],
    [
      d('subject', 'string', 'Task Subject', 'How tasks about the claim name it.'),
      d(
        'payerSubject',
        'string',
        'Payer Task Subject',
        'How tasks about one payer name the claim and the payer.'
      ),
      p('context', 'any')
    ]
  );
  const parts = makeList(g, 'parts', 'Claim and Payer', 'string', [
    'entry.reference',
    'entry.payer'
  ]);
  const context = makeObject(g, 'context', 'Task Details', {
    claimId: [{ id: 'claim' }, 'entry.claimId'],
    coverageId: [{ id: 'coverage' }, 'entry.coverageId'],
    payer: ['string', 'entry.payer'],
    balanceCents: ['integer', 'entry.balanceCents'],
    issues: [T.issues, 'entry.issues'],
    claim: [{ object: {} }, 'entry.claim']
  });
  g.ret('return');
  g.wire('entry.reference', 'return.subject');
  g.wire(joinText(g, 'payerSubject', 'Claim · Payer', ' · ', parts), 'return.payerSubject');
  g.wire(context, 'return.context');
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
  'awaitReview',
  'followUp',
  'statement',
  'collections',
  'writeOff',
  'closed'
];

const UNCHECKED = { issues: [], claim: null };

const cycleClaim = (): GraphDef => {
  const g = graph(
    { execIn: ['exec'], execOut: [], inputs: [p('claimId', { id: 'claim' })], outputs: [] },
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
    label: 'Claim Status for the Step',
    config: {
      type: 'string',
      rows: Object.entries(STEP_STATUSES).map(([key, value]) => ({ key, value }))
    }
  });
  g.add('record', 'billing.record-claim-step', { label: 'Record Claim Step' });
  g.add('clear', 'std.var.set', {
    label: 'Clear the Checks',
    config: { name: 'checked' },
    values: { value: UNCHECKED }
  });
  g.add('checkFirst', 'std.flow.branch', { label: 'Check the Claim First?' });
  g.add('rejection', 'std.logic.choose', {
    label: 'Last Rejection, When Reviewing',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'review' }] }
  });
  g.add('check', 'billing.check-claim', { label: 'Check Claim' });
  const checks = makeObject(g, 'checks', 'Issues and Claim Checked', {
    issues: [T.issues, 'check.issues'],
    claim: [{ object: {} }, 'check.claim']
  });
  g.add('keepValid', 'std.var.set', { label: 'Keep the Checks', config: { name: 'checked' } });
  g.add('keepInvalid', 'std.var.set', {
    label: 'Keep the Blocking Checks',
    config: { name: 'checked' }
  });
  g.add('checked', 'std.var.get', { label: 'Checks of This Step', config: { name: 'checked' } });
  g.add('route', 'std.flow.switch', { label: 'By Step', config: { cases: ROUTES } });
  const unhandled = makeObject(g, 'unknownStepContext', 'Unhandled Step', {
    step: ['string', 'next.step']
  });
  g.add('unknownStep', 'std.human.task', {
    label: 'Claim Step Not Handled',
    config: {
      title: 'Claim step not handled',
      queue: 'billing-review',
      instructions:
        'The Next Claim Step rule chose a step this claim cycle has no branch for (the details name it), so the claim cannot move on. Correct the Next Claim Step override that returns it, then retry the cycle.',
      outcomes: ['retry'],
      hints: {
        retry: 'Runs the claim cycle again; this task comes back if the step is still not handled.'
      }
    }
  });
  g.add('checkedParts', 'std.object.break', {
    label: 'Issues and Claim Checked',
    config: {
      fields: [
        { name: 'issues', type: T.issues },
        { name: 'claim', type: { object: {} } }
      ]
    }
  });
  g.add('details', 'billing.claim-task-details', { label: 'Claim Task Details' });
  const balance = getField(
    g,
    'balance',
    'Balance (Cents)',
    T.ledger,
    'balanceCents',
    'ledger.ledger'
  );
  g.add('wait', 'std.flow.wait-signal', {
    label: 'Await a Claim Change or Deadline',
    values: { name: CLAIM_SIGNAL }
  });
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data', values: { all: false } });
  g.add('review', 'billing.review-claim', { label: 'Review Claim' });
  g.add('confirmPayers', 'billing.confirm-payers', { label: 'Confirm Payers' });
  g.add('submit', 'billing.submit-to-payer', { label: 'Submit to Payer' });
  g.add('reconcile', 'billing.reconcile-payment', { label: 'Reconcile Payment' });
  const subject = 'details.subject';
  const context = 'details.context';
  const denialInputs = makeObject(g, 'denialInputs', 'Work Denial Inputs', {
    claimId: [{ id: 'claim' }, 'entry.claimId'],
    coverageId: [{ id: 'coverage' }, 'next.coverageId'],
    subject: ['string', 'details.payerSubject'],
    context: ['any', context]
  });
  g.add('denial', 'std.flow.run-workflow', {
    label: 'Work Denial',
    config: { workflow: 'billing.work-denial', version: 1 }
  });
  g.add('denied', 'std.flow.switch', {
    label: 'How the Denial Ended',
    config: { cases: ['writeOff', 'void'] }
  });
  const refundInputs = makeObject(g, 'refundInputs', 'Refund Inputs', {
    claimId: [{ id: 'claim' }, 'entry.claimId'],
    subject: ['string', subject],
    context: ['any', context]
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
  g.add('statement', 'billing.bill-patient', { label: 'Bill Patient' });
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
  recordEvent(g, 'facilityKeepWaiting', 'facility_follow_up', 'Keep Waiting on the Facility');
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
  g.wire('ledger.ledger', 'next.ledger');
  g.wire('next.step', 'status.key', 'rejection.key', 'route.value');
  g.wire(
    getField(g, 'lastRejection', 'Last Rejection', T.ledger, 'rejection', 'ledger.ledger'),
    'rejection.case1'
  );
  g.wire('ledger.then', 'record.exec');
  g.wire('status.value', 'record.status');
  g.wire('ledger.signalsSeen', 'record.signalsSeen', 'wait.after');
  g.wire(joinText(g, 'stepReason', 'Why This Step', '; ', 'next.reasons'), 'record.reason');
  g.wire('record.recorded', 'clear.exec');
  g.wire('clear.then', 'checkFirst.exec');
  g.wire('next.check', 'checkFirst.condition');
  g.wire('checkFirst.true', 'check.exec');
  g.wire('checkFirst.false', 'route.exec');
  g.wire('next.patientOnly', 'check.patientOnly', 'fix.patientOnly');
  g.wire('rejection.value', 'check.rejection');
  g.wire('next.coverageId', 'check.rejectedCoverageId');
  g.wire(checks, 'keepValid.value', 'keepInvalid.value');
  g.wire('check.valid', 'keepValid.exec');
  g.wire('check.invalid', 'keepInvalid.exec');
  g.wire('keepValid.then', 'route.exec');
  g.wire('keepInvalid.then', 'fix.exec');

  g.wire('entry.claimId', 'details.claimId');
  g.wire('ledger.reference', 'details.reference');
  g.wire('next.coverageId', 'details.coverageId');
  g.wire('next.payer', 'details.payer');
  g.wire(balance, 'details.balanceCents');
  g.wire('checked.value', 'checkedParts.object');
  g.wire('checkedParts.issues', 'details.issues');
  g.wire('checkedParts.claim', 'details.claim');

  g.wire('route.await', 'wait.exec');
  g.wire('route.awaitPatient', 'wait.exec');
  g.wire('route.awaitReview', 'wait.exec');
  g.wire('next.waitMs', 'wait.timeoutMs');

  const steps = [
    ['fix', 'payerSubject'],
    ['review', 'payerSubject'],
    ['confirmPayers', 'subject'],
    ['submit', 'payerSubject'],
    ['reconcile', 'payerSubject'],
    ['followUp', 'payerSubject'],
    ['statement', 'subject']
  ] as const;
  for (const [id, named] of steps) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire(`details.${named}`, `${id}.subject`);
    g.wire(context, `${id}.context`);
    if (id !== 'fix' && id !== 'statement') g.wire('next.coverageId', `${id}.coverageId`);
  }
  g.wire(subject, 'collections.subject');
  g.wire(context, 'collections.context');
  for (const id of ['approveWriteOff', 'approveCollections']) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire(balance, `${id}.balanceCents`);
    g.wire(subject, `${id}.subject`);
    g.wire(context, `${id}.context`);
  }
  g.wire('next.writeOffApprovalCents', 'approveWriteOff.thresholdCents');
  g.wire('next.collectionsApprovalCents', 'approveCollections.thresholdCents');
  g.wire('route.review', 'review.exec');
  g.wire('route.reviewPatient', 'review.exec');
  g.wire('route.confirmPayers', 'confirmPayers.exec');
  g.wire('route.submit', 'submit.exec');
  g.wire('route.reconcile', 'reconcile.exec');
  g.wire('route.workDenial', 'denial.exec');
  g.wire(denialInputs, 'denial.inputs');
  g.wire('denial.then', 'denied.exec');
  g.wire('denial.pin', 'denied.value');
  g.wire('denied.writeOff', 'approveWriteOff.exec');
  g.wire('denied.void', 'closeVoid.exec');
  g.wire('route.overpaid', 'overpaid.exec');
  g.wire(refundInputs, 'overpaid.inputs');
  g.wire('overpaid.then', 'refunded.exec');
  g.wire('overpaid.pin', 'refunded.value');
  g.wire('refunded.keptCredit', 'closePaid.exec');
  g.wire('route.facility', 'wait.exec');
  g.wire('route.followUp', 'followUp.exec');
  g.wire('route.statement', 'statement.exec');
  g.wire('next.statementNumber', 'statement.statementNumber');
  g.wire('next.statementCount', 'statement.statementCount');
  g.wire('next.statusWaitMs', 'followUp.statusWaitMs');
  g.wire('route.collections', 'collections.exec');
  g.wire('route.followUpFacility', 'facilityFollowUp.exec');
  g.wire(subject, 'facilityFollowUp.subject');
  g.wire(context, 'facilityFollowUp.context');
  g.wire('facilityFollowUp.keepWaiting', 'facilityKeepWaiting.exec');
  g.wire('entry.claimId', 'facilityKeepWaiting.claimId');
  g.wire('facilityFollowUp.writeOff', 'approveWriteOff.exec');
  g.wire('facilityFollowUp.sendToCollections', 'approveCollections.exec');
  g.wire('route.writeOff', 'approveWriteOff.exec');
  g.wire('route.closed', 'closePaid.exec');
  g.wire('route.default', 'unknownStep.exec');
  g.wire(subject, 'unknownStep.subject');
  g.wire(unhandled, 'unknownStep.context');
  g.wire(
    template(
      g,
      'unknownStepSummary',
      'Unhandled Step Summary',
      'The claim cycle has no branch for the step "{step}"; correct the Next Claim Step rule, then retry',
      { step: 'next.step' }
    ),
    'unknownStep.summary'
  );
  const balanceText = money(g, 'balanceText', 'Balance', balance);
  g.wire(
    template(
      g,
      'collectionsSummary',
      'Collections Summary',
      '{balance} is still unpaid after every payer and patient statement; write it off or send it to collections',
      {
        balance: orElse(
          g,
          'balanceOrAny',
          'Balance Amount, Else "A Balance"',
          balanceText,
          fixed('A balance')
        )
      }
    ),
    'collections.summary'
  );
  g.wire(
    template(
      g,
      'facilityFollowUpSummary',
      'Facility Follow-Up Summary',
      'The facility has not paid its invoice for this trip[ ({balance} open)]; contact it, then keep waiting, write it off or send it to collections',
      { balance: balanceText }
    ),
    'facilityFollowUp.summary'
  );

  for (const id of [
    'fix.voided',
    'review.void',
    'confirmPayers.void',
    'submit.void',
    'reconcile.void',
    'followUp.void'
  ] as const) {
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
    'billing.claim-wait-left',
    'Claim Wait Left',
    'How much of a claim cycle wait is still to go, in milliseconds: the wait the Claim Policy sets in days, less the time since it started (all of it when it has not been timed).',
    claimWaitLeft()
  ),
  asRule(
    'billing.payer-is-coverage',
    'Payer Is Coverage',
    'Whether a payer on the claim is the coverage asked about.',
    payerIsCoverage()
  ),
  asRule(
    'billing.next-claim-step',
    'Next Claim Step',
    'Decides what a claim needs next from where it stands, with the waits, statements and limits of the Claim Policy table, taking the first situation that applies, top to bottom, and saying why: refund an overpayment, work a payer denial, reconcile a payer response, wait on a responsible facility and follow up when it has not paid in time, review the claim before a payer and file it once approved, wait on the payer and follow up, review before the patient is billed or confirm payers, send or wait between patient statements, write off a small balance, review an unpaid balance for collections, or close.',
    nextClaimStep()
  ),
  asRule(
    'billing.claim-task-details',
    'Claim Task Details',
    'Names the claim for task lists, with its payer for tasks about one payer, and gathers what tasks show a biller about it: the payer, balance and the issues the claim checks found.',
    claimTaskDetails()
  ),
  asRule(
    'billing.review-summary',
    'Review Summary',
    'Says what the Review Claim task asks: what blocks billing, else to approve billing the payer or the patient for the claim total, naming the first warnings to check.',
    reviewSummary()
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
    'billing.submit-to-payer',
    'Submit to Payer',
    'The one way a claim goes to a payer: prepares it for the payer being billed, maps it onto an 837P (Map 837P Claim), files it with the claim frequency asked for, if any (8 voids the claim the payer has), and sends it to the clearinghouse. When it cannot be filed, asks a biller to try again, fix its data, skip the payer or mark it sent another way. Used by the claim cycle and by Correct Claim for voids.',
    submitToPayer()
  ),
  asRule(
    'billing.underpayment',
    'Underpayment',
    'Holds what a Medicare primary payer allowed against what the Medicare ambulance fee schedule of the year of service allows for the trip, unless several patients shared the trip, a denial is expected, the response has no reason codes or the year has no schedule. Allowing more than the Underpayment Threshold below it (Underpayment Limits table, $1) is an underpayment, and its reconcile task is raised.',
    underpayment()
  ),
  asRule(
    'billing.fee-schedule-facts',
    'Fee Schedule Facts',
    'What holding a payer response against the Medicare fee schedule reads from the claim: its charge lines, pickup ZIP code and date of service, and whether the payer is Medicare, pays first, the trip carried several patients or a denial is expected.',
    feeScheduleFacts()
  ),
  asRule(
    'billing.reconcile-summary',
    'Reconcile Summary',
    'Says what the Reconcile Payment task asks: which payer answered, what is still open and, when Medicare pays first, what the fee schedule allows and any underpayment.',
    reconcileSummary()
  ),
  asStage(
    'billing.reconcile-payment',
    'Reconcile Payment',
    'Holds a payment against the Medicare fee schedule when Medicare pays first (Underpayment), then asks a biller to reconcile a payer response that leaves a balance: continue to the next payer or the patient, correct the claim (Correct Claim), or write off the rest. An underpaid response is handed out first.',
    reconcilePayment()
  ),
  asStage(
    'billing.follow-up-payer',
    'Follow Up with Payer',
    'Asks the payer for the claim status (276, in real time or in a batch) and waits for its answer (277) as long as the Claim Policy says, then asks a biller what to do about a payer that has not answered in time, showing the latest status: resubmit (Correct Claim), keep waiting, or move on to the next payer.',
    followUpPayer()
  ),
  asRule(
    'billing.statement-task-summaries',
    'Statement Task Summaries',
    'Says what the Bill Patient tasks ask when a statement cannot go out: add the billing profile, or complete the patient address, naming the parts it lacks.',
    statementSummaries()
  ),
  asStage(
    'billing.bill-patient',
    'Bill Patient',
    'Takes off what balance-billing law keeps off the patient (Patient Responsibility), then sends the next patient statement for what is left, or asks for the billing profile or patient address it needs first.',
    billPatient()
  ),
  asWorkflow(
    'billing.cycle-claim',
    'Cycle Claim',
    "Works a claim from its first bill until it closes, one step at a time: decides the Next Claim Step and shows it as the claim's status, checks the claim before a review or filing and asks a biller to fix what blocks it, has it reviewed, files it to each payer in order (asking a biller when it cannot), follows up on late payers, works denials (Work Denial), reconciles payments, refunds overpayments (Refund Overpayment), waits on a responsible facility and follows up when it has not paid in time, confirms payers when there are none, reviews before the first patient statement, sends statements, and has write-offs and collections above the Claim Policy limits approved. Between steps it sleeps until the claim changes or a wait runs out.",
    cycleClaim()
  )
];
