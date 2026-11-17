import {
  CLAIM_FIX_FIELDS,
  CLAIM_SIGNAL,
  CLAIM_STEPS,
  MIN_WAIT_MS,
  STEP_STATUSES
} from '@ugula/billing';
import type { GraphDef, Json, PinSpec, ValueType, VariableDef } from '@ugula/graph';
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
  exit,
  field,
  is,
  notOneOf,
  P,
  rule,
  shared,
  summary,
  T,
  table,
  template
} from './shared.ts';

type Port = `${string}.${string}`;

type Test = { field: string; op: string; value?: Json };

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

const MEDICARE_ALLOWED: ValueType = {
  object: {
    compared: 'boolean',
    allowedCents: 'integer',
    rurality: 'string',
    carrier: 'string',
    locality: 'string',
    codesNotPriced: { list: { code: 'hcpcs' } },
    payerAllowedCents: 'integer',
    underpaidCents: 'integer',
    underpaid: 'boolean'
  }
};

const CLAIM_PAYER: ValueType = {
  object: { coverageId: { id: 'coverage' }, claimFiling: 'string' }
};

const RURALITY_WORDS = { urban: 'urban', rural: 'rural', superRural: 'super-rural' };

const when = (
  g: Builder,
  id: string,
  label: string,
  inputs: Record<string, ValueType>,
  rules: Test[],
  from: Record<string, Port>
) => {
  g.add(id, 'std.logic.condition', {
    label,
    config: {
      inputs: Object.entries(inputs).map(([name, type]) => ({ name, type })),
      rules
    } as Json
  });
  for (const [pin, port] of Object.entries(from)) g.wire(port, `${id}.${pin}`);
  return `${id}.result` as const;
};

const money = (g: Builder, id: string, label: string, cents: Port) => {
  g.add(id, 'std.text.money', { label });
  g.wire(cents, `${id}.cents`);
  return `${id}.text` as const;
};

const orElse = (g: Builder, id: string, label: string, value: Port, fallback: Json) => {
  g.add(id, 'std.logic.choose', {
    label,
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: fallback }
  });
  g.wire(value, `${id}.option1`);
  return `${id}.value` as const;
};

const detail = (g: Builder, id: string, label: string, path: string, context: Port) => {
  g.add(id, 'std.object.get-field', { label, config: { record: TASK_DETAILS, path } });
  g.wire(context, `${id}.record`);
  return `${id}.value` as const;
};

const pathOf = (g: Builder, id: string, label: string, path: string, object: Port) => {
  g.add(id, 'std.object.get', { label, values: { path } });
  g.wire(object, `${id}.object`);
  return `${id}.value` as const;
};

const payerOr = (g: Builder, task: string, context: Port, fallback: string, label: string) =>
  orElse(
    g,
    `${task}Payer`,
    label,
    template(g, `${task}PayerName`, 'Payer Name', '{context.payer}', { context }),
    fallback
  );

const makeObject = (
  g: Builder,
  id: string,
  label: string,
  fields: Record<string, [Port, ValueType]>
) => {
  g.add(id, 'std.object.make', {
    label,
    config: {
      fields: Object.entries(fields).map(([name, [, type]]) => ({ name, type }))
    } as Json
  });
  for (const [name, [port]] of Object.entries(fields)) g.wire(port, `${id}.${name}`);
  return `${id}.object` as const;
};

const PATIENT_ADDRESS_FIELDS = ['AddressLine', 'City', 'State', 'PostalCode'].map((part) => ({
  name: `patient${part}`,
  type: 'string',
  label: `Patient ${part === 'AddressLine' ? 'street address' : part === 'PostalCode' ? 'ZIP code' : part.toLowerCase()}`,
  required: ['save']
}));

const recordEvent = (g: Builder, id: string, kind: string, label: string) =>
  g.add(id, 'billing.record-claim-event', { label, values: { kind } });

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

const reviewSummary = (g: Builder, context: Port) => {
  const billed = payerOr(g, 'review', context, 'the patient', 'Payer, Else the Patient');
  const totalCents = detail(g, 'totalCents', 'Claim Total (Cents)', 'claim.totalCents', context);
  g.add('warnings', 'std.list.where', {
    label: 'Warnings',
    config: { field: 'severity', op: 'isNot', value: 'blocking' }
  });
  g.add('warningMessages', 'std.list.pluck', {
    label: 'Warning Messages',
    values: { field: 'message' }
  });
  g.add('firstWarning', 'std.list.first', { label: 'First Warning' });
  g.add('orFix', 'std.logic.choose', {
    label: 'Or Fix When No Warnings',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '0' }] },
    values: { case1: ', or fix, skip or void the claim' }
  });
  template(g, 'oneWarning', 'One Warning', 'warning: {message}', {
    message: 'firstWarning.item'
  });
  template(g, 'severalWarnings', 'Several Warnings', '{count} warnings, first: {message}', {
    count: 'warnings.count',
    message: 'firstWarning.item'
  });
  g.add('checking', 'std.logic.choose', {
    label: 'Warnings to Check',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '0' }, { when: '1' }] }
  });
  template(
    g,
    'approveText',
    'Approve Text',
    'Approve billing {billed}[ {total}]{orFix}[ after checking its {checking}]',
    {
      billed,
      total: money(g, 'total', 'Claim Total', totalCents),
      orFix: 'orFix.value',
      checking: 'checking.value'
    }
  );
  g.add('reviewSummary', 'billing.blocking-summary', { label: 'Task Summary' });
  g.wire(detail(g, 'issues', 'Issues', 'issues', context), 'warnings.list', 'reviewSummary.issues');
  g.wire('warnings.list', 'warningMessages.list');
  g.wire('warningMessages.list', 'firstWarning.list');
  g.wire('warnings.count', 'orFix.key', 'checking.key');
  g.wire('oneWarning.text', 'checking.case2');
  g.wire('severalWarnings.text', 'checking.otherwise');
  g.wire(billed, 'reviewSummary.billed');
  g.wire('approveText.text', 'reviewSummary.otherwise');
  g.wire('reviewSummary.summary', 'review.summary');
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
  recordEvent(g, 'approve', 'approved', 'Approve');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to Next Payer');
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data on Request', values: { all: true } });
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'review.exec');
  g.wire('entry.subject', 'review.subject', 'fix.subject');
  g.wire('entry.context', 'review.context', 'fix.context');
  reviewSummary(g, 'entry.context');
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
    {
      total: money(
        g,
        'total',
        'Claim Total',
        detail(g, 'totalCents', 'Claim Total (Cents)', 'claim.totalCents', 'entry.context')
      )
    }
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
  g.add('why', 'std.var.set', { label: 'Why It Was Not Filed', config: { name: 'whyNotFiled' } });
  g.add('reason', 'std.var.get', { label: 'Why Not Filed', config: { name: 'whyNotFiled' } });
  g.add('filingContext', 'std.object.set', {
    label: 'Filing Context',
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
  recordEvent(g, 'submitted', 'submitted', 'Submitted Outside the App');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to Next Payer');
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
      payer: payerOr(g, 'submit', 'filingContext.object', 'the payer', 'Payer to Name'),
      reason: orElse(
        g,
        'reasonGiven',
        'Reason, Else None Given',
        'reason.value',
        'no reason was given'
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

const UNDERPAID_CENTS = 100;

const NOT_COMPARED = { compared: false, underpaid: false, priority: 0 };

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
        'Sent Reason Codes',
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
  g.add('shortfall', 'std.math.max', { label: 'Shortfall', values: { b: 0 } });
  when(
    g,
    'priced',
    'Fee Schedule Found',
    { medicareAllowedCents: 'integer' },
    [{ field: 'medicareAllowedCents', op: 'gt', value: 0 }],
    { medicareAllowedCents: 'entry.medicareAllowedCents' }
  );
  g.add('decide', 'std.table.decide', {
    label: 'Underpayment',
    config: shared.decision(
      'billing.underpayment',
      'Underpayment',
      'Decides whether a payer response can be held against the Medicare ambulance fee schedule, and whether it allowed less by enough to work: an underpaid reconcile task is raised so it is handed out first.',
      table(
        [
          field('payerKind', 'string', 'Payer kind'),
          field('primary', 'boolean', 'Primary payer'),
          field('severalPatients', 'boolean', 'Several patients'),
          field('denialExpected', 'boolean', 'Denial expected'),
          field('reasonCoded', 'boolean', 'Sent reason codes'),
          field('priced', 'boolean', 'Fee schedule found'),
          field('shortfallCents', 'integer', 'Allowed below the fee schedule (cents)')
        ],
        [
          field('compared', 'boolean', 'Compared'),
          field('underpaid', 'boolean', 'Underpaid'),
          field('priority', 'integer', 'Task priority')
        ],
        [
          { label: 'Not Medicare', when: { payerKind: notOneOf('MA', 'MB') }, set: NOT_COMPARED },
          {
            label: 'Medicare pays after another payer',
            when: { primary: is(false) },
            set: NOT_COMPARED
          },
          {
            label: 'Several patients on the trip (GM)',
            when: { severalPatients: is(true) },
            set: NOT_COMPARED
          },
          {
            label: 'Medicare is expected to deny (GZ)',
            when: { denialExpected: is(true) },
            set: NOT_COMPARED
          },
          {
            label: 'Posted without reason codes',
            when: { reasonCoded: is(false) },
            set: NOT_COMPARED
          },
          {
            label: 'No fee schedule for the year of service',
            when: { priced: is(false) },
            set: NOT_COMPARED
          },
          {
            label: 'Allowed more than $1 below the Medicare fee schedule',
            when: { shortfallCents: above(UNDERPAID_CENTS) },
            set: { compared: true, underpaid: true, priority: 2 }
          }
        ],
        { compared: true, underpaid: false, priority: 0 }
      )
    )
  });
  g.ret('return');
  g.wire('entry.medicareAllowedCents', 'difference.a');
  g.wire('entry.payerAllowedCents', 'difference.b');
  g.wire('difference.result', 'shortfall.a');
  g.wire('shortfall.result', 'decide.shortfallCents', 'return.underpaidCents');
  g.wire('priced.result', 'decide.priced');
  for (const pin of ['payerKind', 'primary', 'severalPatients', 'denialExpected', 'reasonCoded']) {
    g.wire(`entry.${pin}`, `decide.${pin}`);
  }
  g.wire('decide.compared', 'return.compared');
  g.wire('decide.underpaid', 'return.underpaid');
  g.wire('decide.priority', 'return.priority');
  g.wire('decide.rules', 'return.reasons');
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
  g.add('payerCoverage', 'std.object.get-field', {
    label: 'Coverage of the Payer',
    config: { record: CLAIM_PAYER, path: 'coverageId' }
  });
  g.add('matches', 'std.logic.equal', { label: 'Same Coverage' });
  g.ret('return');
  g.wire('entry.payer', 'payerCoverage.record');
  g.wire('payerCoverage.value', 'matches.a');
  g.wire('entry.coverageId', 'matches.b');
  g.wire('matches.result', 'return.matches');
  return g.def;
};

const claimFacts = (g: Builder) => {
  const claim = 'readClaim.claim';
  const lines = pathOf(g, 'lines', 'Claim Lines', 'lines', claim);
  const zip = pathOf(g, 'pickupZip', 'Pickup ZIP Code', 'details.pickup.postalCode', claim);
  const date = pathOf(g, 'serviceDate', 'Date of Service', 'details.serviceDate', claim);
  when(
    g,
    'priceable',
    'Lines, Pickup ZIP and Date of Service',
    { lines: { list: 'any' }, pickupZip: 'string', serviceDate: 'string' },
    [
      { field: 'lines', op: 'present' },
      { field: 'pickupZip', op: 'present' },
      { field: 'serviceDate', op: 'present' }
    ],
    { lines, pickupZip: zip, serviceDate: date }
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
  g.wire(lines, 'chargeLines.list');
  g.add('payerOfCoverage', 'std.list.find-rule', {
    label: 'Payer That Answered',
    config: { rule: 'billing.payer-is-coverage', version: 1, item: 'payer', test: 'matches' }
  });
  g.wire(pathOf(g, 'payers', 'Claim Payers', 'payers', claim), 'payerOfCoverage.list');
  g.wire('entry.coverageId', 'payerOfCoverage.coverageId');
  g.add('payerKind', 'std.object.get-field', {
    label: 'Payer Kind',
    config: { record: CLAIM_PAYER, path: 'claimFiling' }
  });
  g.wire('payerOfCoverage.item', 'payerKind.record');
  when(
    g,
    'primary',
    'Primary Payer',
    { position: 'integer' },
    [{ field: 'position', op: 'is', value: 0 }],
    { position: 'payerOfCoverage.index' }
  );
  const documentation = 'details.documentation';
  when(
    g,
    'severalPatients',
    'Several Patients',
    { patientCount: 'integer' },
    [{ field: 'patientCount', op: 'gt', value: 1 }],
    {
      patientCount: pathOf(
        g,
        'patientCount',
        'Patient Count',
        `${documentation}.patientCount`,
        claim
      )
    }
  );
  when(
    g,
    'denialExpected',
    'Denial Expected',
    { denialExpected: 'boolean' },
    [{ field: 'denialExpected', op: 'is', value: true }],
    {
      denialExpected: pathOf(
        g,
        'denialFlag',
        'Denial Expected Flag',
        `${documentation}.denialExpected`,
        claim
      )
    }
  );
  for (const id of ['primary', 'severalPatients', 'denialExpected']) {
    g.wire(`${id}.result`, `underpayment.${id}`);
  }
  g.wire('payerKind.value', 'underpayment.payerKind');
  return { zip, date };
};

const reconcileSummary = (g: Builder, context: Port, allowed: Port) => {
  const fact = (id: string, label: string, path: string) => {
    g.add(id, 'std.object.get-field', { label, config: { record: MEDICARE_ALLOWED, path } });
    g.wire(allowed, `${id}.record`);
    return `${id}.value` as const;
  };
  const balance = money(
    g,
    'balance',
    'Balance',
    detail(g, 'balanceCents', 'Balance (Cents)', 'balanceCents', context)
  );
  const total = money(
    g,
    'total',
    'Claim Total',
    detail(g, 'totalCents', 'Claim Total (Cents)', 'claim.totalCents', context)
  );
  template(g, 'balanceOfTotal', 'Balance of Total', '[{balance} of {total} is]', {
    balance,
    total
  });
  template(g, 'balanceOnly', 'Balance Alone', '[{balance} is]', { balance });
  g.add('open', 'std.logic.choose', {
    label: 'What Is Open',
    config: { mode: 'first', type: 'string', count: 3 },
    values: { option3: 'a balance is' }
  });
  g.wire('balanceOfTotal.text', 'open.option1');
  g.wire('balanceOnly.text', 'open.option2');
  g.add('rurality', 'std.table.lookup', {
    label: 'Kind of Trip',
    config: {
      type: 'string',
      rows: Object.entries(RURALITY_WORDS).map(([key, value]) => ({ key, value })),
      fallback: 'ambulance'
    }
  });
  g.wire(fact('allowedRurality', 'Rurality', 'rurality'), 'rurality.key');
  const amounts = {
    allowed: money(
      g,
      'allowedText',
      'Medicare Allows',
      fact('allowedCents', 'Medicare Allowed (Cents)', 'allowedCents')
    ),
    rurality: 'rurality.value' as const
  };
  template(
    g,
    'underpaidNote',
    'Underpaid Note',
    '; underpaid: the payer allowed {payerAllowed}, {underpaid} less than the {allowed} Medicare allows for this {rurality} trip; reopen or appeal it, or',
    {
      ...amounts,
      payerAllowed: money(
        g,
        'payerAllowedText',
        'Payer Allowed',
        fact('payerAllowedCents', 'Payer Allowed (Cents)', 'payerAllowedCents')
      ),
      underpaid: money(
        g,
        'underpaidText',
        'Underpaid',
        fact('underpaidCents', 'Underpaid (Cents)', 'underpaidCents')
      )
    }
  );
  template(
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
  g.wire(fact('underpaid', 'Underpaid', 'underpaid'), 'medicareNote.key');
  g.wire('underpaidNote.text', 'medicareNote.case1');
  g.wire('allowsNote.text', 'medicareNote.otherwise');
  g.add('medicare', 'std.logic.choose', {
    label: 'Medicare Note When Compared',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { otherwise: ';' }
  });
  g.wire(fact('compared', 'Compared', 'compared'), 'medicare.key');
  g.wire('medicareNote.value', 'medicare.case1');
  summary(
    g,
    'reconcile',
    '{payer} answered and {open} still open{medicare} reconcile it, move on or write it off',
    {
      payer: payerOr(g, 'reconcile', context, 'The payer', 'Payer to Name'),
      open: 'open.value',
      medicare: 'medicare.value'
    }
  );
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
  g.add('readClaim', 'billing.read-claim-checks', { label: 'Read the Claim' });
  g.add('price', 'std.flow.branch', { label: 'Can Medicare Price It?' });
  g.add('locality', 'billing.find-medicare-locality', { label: 'Pickup Locality' });
  g.add('allowed', 'billing.medicare-allowed', { label: 'Medicare Allowed' });
  g.add('response', 'billing.read-payer-response', { label: 'What the Payer Allowed' });
  g.add('underpayment', 'billing.underpayment', { label: 'Underpayment' });
  const { zip, date } = claimFacts(g);
  const allowedFacts = makeObject(g, 'allowedFacts', 'What Medicare Allows', {
    compared: ['underpayment.compared', 'boolean'],
    allowedCents: ['allowed.totalCents', 'integer'],
    rurality: ['locality.rurality', 'string'],
    carrier: ['locality.carrier', 'string'],
    locality: ['locality.locality', 'string'],
    codesNotPriced: ['allowed.missing', { list: { code: 'hcpcs' } }],
    payerAllowedCents: ['response.allowedCents', 'integer'],
    underpaidCents: ['underpayment.underpaidCents', 'integer'],
    underpaid: ['underpayment.underpaid', 'boolean']
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
    label: 'Context With Medicare Allowed',
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
  recordEvent(g, 'reconciled', 'reconciled', 'Mark the Response Reconciled');
  g.add('correct', 'billing.correct-claim', { label: 'Correct Claim' });
  g.ret('doneReturn', 'done');
  g.ret('writeOffReturn', 'writeOff');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'readClaim.exec');
  g.wire('entry.claimId', 'readClaim.claimId', 'response.claimId');
  g.wire('entry.coverageId', 'response.coverageId');
  g.wire('readClaim.then', 'price.exec');
  g.wire('priceable.result', 'price.condition');
  g.wire('price.true', 'locality.exec');
  g.wire('price.false', 'reconcile.exec');
  g.wire(zip, 'locality.postalCode');
  g.wire('locality.found', 'allowed.exec');
  g.wire('locality.notFound', 'reconcile.exec');
  g.wire('chargeLines.list', 'allowed.lines');
  g.wire(date, 'allowed.serviceDate');
  g.wire('locality.carrier', 'allowed.carrier');
  g.wire('locality.locality', 'allowed.locality');
  g.wire('locality.rurality', 'allowed.rurality');
  g.wire('allowed.totalCents', 'underpayment.medicareAllowedCents');
  g.wire('allowed.then', 'response.exec');
  g.wire('response.then', 'keepAllowed.exec');
  g.wire('response.allowedCents', 'underpayment.payerAllowedCents');
  g.wire('response.reasonCoded', 'underpayment.reasonCoded');
  g.wire('underpayment.priority', 'keepPriority.value');
  g.wire('priority.value', 'reconcile.priority');
  g.wire(allowedFacts, 'keepAllowed.value');
  g.wire('keepAllowed.then', 'keepPriority.exec');
  g.wire('keepPriority.then', 'reconcile.exec');
  g.wire('medicareAllowed.value', 'taskContext.value');
  g.wire('entry.context', 'taskContext.object');
  g.wire('entry.subject', 'reconcile.subject', 'correct.subject');
  g.wire('entry.context', 'correct.context');
  g.wire('taskContext.object', 'reconcile.context');
  reconcileSummary(g, 'taskContext.object', 'medicareAllowed.value');
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
  const g = claimStep(['done', 'void']);
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
        "The payer has not responded in time. The payer's latest claim status (277), when it gave one, is in the details. Resubmit it, keep waiting, or move on to the next payer. A resubmission goes through Correct Claim: when the payer has the claim on file, enter its claim number so it is replaced or reopened the way the payer takes corrections, else it goes as a new claim.",
      fields: [{ name: 'payerClaimNumber', type: 'string', label: 'Payer claim number' }],
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
      payer: payerOr(g, 'followUp', 'withStatus.object', 'The payer', 'Payer to Name'),
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

const MAILING_PARTS = [
  ['addressLine', 'Street Address', 'street address'],
  ['city', 'City', 'city'],
  ['state', 'State', 'state'],
  ['postalCode', 'ZIP Code', 'ZIP code']
] as const;

const statementSummaries = (g: Builder) => {
  const statement = {
    number: 'entry.statementNumber',
    count: 'entry.statementCount'
  } as const;
  template(
    g,
    'statementOfCount',
    'Statement of Count',
    '[statement {number} of {count}]',
    statement
  );
  template(g, 'statementAlone', 'Statement Alone', '[statement {number}]', {
    number: statement.number
  });
  g.add('whichStatement', 'std.logic.choose', {
    label: 'Which Statement',
    config: { mode: 'first', type: 'string', count: 3 },
    values: { option3: 'a statement' }
  });
  g.wire('statementOfCount.text', 'whichStatement.option1');
  g.wire('statementAlone.text', 'whichStatement.option2');
  const balance = money(
    g,
    'balanceDue',
    'Balance',
    detail(g, 'balanceCents', 'Balance (Cents)', 'balanceCents', 'entry.context')
  );
  summary(
    g,
    'profileNeeded',
    'Add the billing profile in Settings so {statement} can go to the patient[ for {balance}]',
    { statement: 'whichStatement.value', balance }
  );
  g.add('missingParts', 'std.list.make', {
    label: 'Missing Address Parts',
    config: { count: MAILING_PARTS.length, type: 'string' }
  });
  for (const [i, [part, label, words]] of MAILING_PARTS.entries()) {
    const value = detail(g, part, `Patient ${label}`, `claim.patient.${part}`, 'entry.context');
    when(g, `${part}Empty`, `No ${label}`, { [part]: 'string' }, [{ field: part, op: 'empty' }], {
      [part]: value
    });
    g.add(`${part}Missing`, 'std.logic.select', {
      label: `${label} If Missing`,
      values: { whenTrue: words }
    });
    g.wire(`${part}Empty.result`, `${part}Missing.condition`);
    g.wire(`${part}Missing.result`, `missingParts.item${i + 1}`);
  }
  g.add('missingText', 'std.text.join', { label: 'Missing Parts', values: { separator: ', ' } });
  g.wire('missingParts.list', 'missingText.items');
  summary(
    g,
    'addressNeeded',
    'The patient address has no {missing}, so {statement} cannot be sent; enter it or write off {balance}',
    {
      missing: orElse(
        g,
        'missingWords',
        'Missing Parts, Else Address',
        'missingText.text',
        'usable mailing address'
      ),
      statement: 'whichStatement.value',
      balance: orElse(g, 'balanceOrRest', 'Balance, Else the Balance', balance, 'the balance')
    }
  );
};

const billPatient = (): GraphDef => {
  const g = claimStep(
    ['done', 'writeOff'],
    [p('statementNumber', 'integer'), p('statementCount', 'integer')]
  );
  g.add('balance', 'billing.read-patient-balance', { label: 'Read Patient Balance' });
  g.add('responsibility', 'billing.patient-responsibility', { label: 'Patient Responsibility' });
  g.add('why', 'std.text.join', { label: 'Why Protected', values: { separator: '; ' } });
  g.add('protect', 'billing.protect-balance', { label: 'Protect Patient Balance' });
  when(
    g,
    'owes',
    'Anything to Bill',
    { responsibilityCents: 'integer' },
    [{ field: 'responsibilityCents', op: 'gt', value: 0 }],
    { responsibilityCents: 'responsibility.responsibilityCents' }
  );
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
  g.wire('responsibility.reasons', 'why.items');
  g.wire('why.text', 'protect.note');
  g.wire('responsibility.excessCents', 'protect.adjustedCents');
  g.wire('balance.then', 'protect.exec');
  g.wire('protect.then', 'billable.exec');
  g.wire('owes.result', 'billable.condition');
  g.wire('billable.true', 'statement.exec');
  g.wire('billable.false', 'doneReturn.exec');
  g.wire('entry.statementNumber', 'statement.statementNumber');
  g.wire('entry.statementCount', 'statement.statementCount');
  g.wire('entry.subject', 'profileNeeded.subject', 'addressNeeded.subject');
  g.wire('entry.context', 'profileNeeded.context', 'addressNeeded.context');
  statementSummaries(g);
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
  field('pendingReview', 'boolean', 'A payer file line on the claim waits for a biller'),
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

type StepSet = {
  check?: boolean;
  patientOnly?: boolean;
  waitOn?: 'payer' | 'statement' | 'facility' | 'review';
  payerOf?: 'response' | 'billed';
};

const step = (
  label: string,
  when: Record<string, ReturnType<typeof is>>,
  name: string,
  { check = false, patientOnly = false, waitOn, payerOf }: StepSet = {}
) => ({
  label,
  when,
  set: { step: name, check, patientOnly, waitOn: waitOn ?? null, payerOf: payerOf ?? null }
});

const claimWaitLeft = (): GraphDef => {
  const g = rule(
    [
      d('waitDays', 'number', 'Wait Days', 'How many days the policy waits.', true),
      d(
        'elapsedMs',
        'integer',
        'Elapsed Milliseconds',
        'How long ago the wait started, or nothing when it has not been timed.',
        true
      )
    ],
    [d('leftMs', 'integer', 'Milliseconds Left', 'The milliseconds of the wait still to go.', true)]
  );
  g.add('waitMs', 'std.math.multiply', { label: 'Wait in Milliseconds', values: { b: DAY_MS } });
  g.add('wholeMs', 'std.math.round', { label: 'Whole Milliseconds' });
  g.add('elapsed', 'std.logic.coalesce', { label: 'Elapsed, Else None', values: { fallback: 0 } });
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
  for (const [id, label, pin, type] of [
    ['hasPayer', 'A Payer to Bill', 'coverageId', { id: 'coverage' }],
    ['reconciling', 'A Response to Reconcile', 'unreconciledCoverageId', { id: 'coverage' }],
    ['denialOpen', 'A Denial to Work', 'denialRoute', 'string']
  ] as const) {
    when(g, id, label, { [pin]: type }, [{ field: pin, op: 'present' }], {
      [pin]: `ledger.${pin}`
    });
  }
  const waitLeft = (id: string, label: string, days: string, elapsed: string) => {
    g.add(id, 'billing.claim-wait-left', { label });
    g.wire(`policy.${days}`, `${id}.waitDays`);
    g.wire(`ledger.${elapsed}`, `${id}.elapsedMs`);
    return `${id}.leftMs` as const;
  };
  when(
    g,
    'payerHasClaim',
    'The Payer Has the Claim',
    { contacted: 'boolean' },
    [{ field: 'contacted', op: 'is', value: true }],
    { contacted: 'ledger.contacted' }
  );
  g.add('payerWaitLeftMs', 'std.logic.select', {
    label: 'Payer Wait Left',
    values: { whenFalse: 0 }
  });
  g.wire('payerHasClaim.result', 'payerWaitLeftMs.condition');
  g.wire(
    waitLeft('payerWait', 'Payer Wait Since Contact', 'payerWaitDays', 'sinceContactMs'),
    'payerWaitLeftMs.whenTrue'
  );
  when(
    g,
    'statementTimed',
    'A Statement Was Sent',
    { statements: 'integer', sinceStatementMs: 'integer' },
    [
      { field: 'statements', op: 'gt', value: 0 },
      { field: 'sinceStatementMs', op: 'present' }
    ],
    { statements: 'ledger.statements', sinceStatementMs: 'ledger.sinceStatementMs' }
  );
  g.add('statementWaitLeftMs', 'std.logic.select', {
    label: 'Statement Wait Left',
    values: { whenFalse: 0 }
  });
  g.wire('statementTimed.result', 'statementWaitLeftMs.condition');
  g.wire(
    waitLeft(
      'statementWait',
      'Statement Wait Since the Last',
      'statementIntervalDays',
      'sinceStatementMs'
    ),
    'statementWaitLeftMs.whenTrue'
  );
  waitLeft(
    'facilityWaitLeftMs',
    'Facility Wait Left',
    'facilityWaitDays',
    'sinceFacilityContactMs'
  );
  g.add('statementsLeft', 'std.math.subtract', { label: 'Statements Left' });
  g.add('withinWriteOff', 'std.logic.less-or-equal', { label: 'Within the Write-Off Limit' });
  g.add('underCollections', 'std.logic.less', { label: 'Under the Collections Threshold' });
  g.add('decide', 'std.table.decide', {
    label: 'Claim Steps',
    config: shared.decision(
      'billing.claim-steps',
      'Claim Steps',
      'Decides the next step of the claim cycle from its ledger and policy, top to bottom, with what an await step waits on and whose payer the step is about.',
      table(
        STEP_INPUTS,
        [
          field('step', 'string', 'Step'),
          field('check', 'boolean', 'Run the claim checks first'),
          field('patientOnly', 'boolean', 'Only patient issues count'),
          field('waitOn', 'string', 'Waits on: payer, statement, facility or review'),
          field('payerOf', 'string', 'About the payer of: response or billed')
        ],
        [
          step(
            'A credit balance while a payer file line on the claim waits for a biller',
            { pendingReview: is(true), balanceCents: below(0) },
            'awaitReview',
            { waitOn: 'review' }
          ),
          step('More was paid than charged', { balanceCents: below(0) }, 'overpaid'),
          step('A payer denial waits to be worked', { denialOpen: is(true) }, 'workDenial', {
            payerOf: 'response'
          }),
          step('Nothing is owed', { balanceCents: atMost(0) }, 'closed'),
          step('A payer response waits to be reconciled', { reconciling: is(true) }, 'reconcile', {
            payerOf: 'response'
          }),
          step(
            'Waiting on the responsible facility',
            { billFacility: is(true), facilityWaitLeftMs: above(0) },
            'facility',
            { waitOn: 'facility' }
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
            { check: true, payerOf: 'billed' }
          ),
          step('Ready for this payer', { hasPayer: is(true), contacted: is(false) }, 'submit', {
            check: true,
            payerOf: 'billed'
          }),
          step('Waiting on the payer', { hasPayer: is(true), payerWaitLeftMs: above(0) }, 'await', {
            waitOn: 'payer',
            payerOf: 'billed'
          }),
          step('The payer has not answered in time', { hasPayer: is(true) }, 'followUp', {
            payerOf: 'billed'
          }),
          step('Small balance written off', { withinWriteOff: is(true) }, 'writeOff'),
          step(
            'Review before billing the patient',
            { statements: atMost(0), patientApproved: is(false), coverageCount: above(0) },
            'reviewPatient',
            { check: true, patientOnly: true }
          ),
          step(
            'No payer to bill',
            { statements: atMost(0), patientApproved: is(false) },
            'confirmPayers',
            { check: true, patientOnly: true }
          ),
          step('Waiting between statements', { statementWaitLeftMs: above(0) }, 'awaitPatient', {
            waitOn: 'statement'
          }),
          step('Statements left to send', { statementsLeft: above(0) }, 'statement'),
          step(
            'Balance under the collections threshold',
            { underCollections: is(true) },
            'writeOff'
          )
        ],
        { step: 'collections', check: false, patientOnly: false, waitOn: null, payerOf: null }
      )
    )
  });
  g.add('waitLeft', 'std.logic.choose', {
    label: 'Wait Left for the Step',
    config: {
      mode: 'byCase',
      type: 'integer',
      cases: [{ when: 'payer' }, { when: 'statement' }, { when: 'facility' }, { when: 'review' }]
    },
    values: { case4: DAY_MS }
  });
  g.add('waitMs', 'std.math.max', { label: 'How Long to Wait', values: { b: MIN_WAIT_MS } });
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
      cases: [{ when: 'response' }, { when: 'billed' }]
    }
  });
  g.add('payerName', 'std.logic.choose', {
    label: 'Payer Name',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'response' }, { when: 'billed' }] }
  });
  g.ret('return');
  g.wire('entry.ledger', 'ledger.ledger');
  g.wire('ledger.payerKind', 'policy.payerKind');
  g.wire('policy.statementCount', 'statementsLeft.a', 'return.statementCount');
  g.wire('ledger.statements', 'statementsLeft.b', 'nextStatement.a');
  g.wire('ledger.balanceCents', 'withinWriteOff.a', 'underCollections.a');
  g.wire('policy.autoWriteOffCents', 'withinWriteOff.b');
  g.wire('policy.collectionsThresholdCents', 'underCollections.b');
  g.wire('policy.reviewRequired', 'decide.reviewRequired');
  g.wire('policy.writeOffApprovalCents', 'return.writeOffApprovalCents');
  g.wire('policy.collectionsApprovalCents', 'return.collectionsApprovalCents');
  for (const id of [
    'hasPayer',
    'reconciling',
    'denialOpen',
    'payerWaitLeftMs',
    'statementWaitLeftMs',
    'statementsLeft',
    'withinWriteOff',
    'underCollections'
  ]) {
    g.wire(`${id}.result`, `decide.${id}`);
  }
  g.wire('facilityWaitLeftMs.leftMs', 'decide.facilityWaitLeftMs', 'waitLeft.case3');
  for (const f of [
    'balanceCents',
    'pendingReview',
    'contacted',
    'approved',
    'statements',
    'patientApproved',
    'coverageCount',
    'billFacility'
  ]) {
    g.wire(`ledger.${f}`, `decide.${f}`);
  }
  g.wire('decide.step', 'statementNumber.key', 'return.step');
  g.wire('decide.waitOn', 'waitLeft.key');
  g.wire('payerWaitLeftMs.result', 'waitLeft.case1');
  g.wire('statementWaitLeftMs.result', 'waitLeft.case2');
  g.wire('waitLeft.value', 'waitMs.a');
  g.wire('nextStatement.result', 'statementNumber.case1');
  g.wire('decide.payerOf', 'coverageId.key', 'payerName.key');
  g.wire('ledger.unreconciledCoverageId', 'coverageId.case1');
  g.wire('ledger.coverageId', 'coverageId.case2');
  g.wire('ledger.unreconciledPayer', 'payerName.case1');
  g.wire('ledger.payer', 'payerName.case2');
  g.wire('coverageId.value', 'return.coverageId');
  g.wire('payerName.value', 'return.payer');
  g.wire('waitMs.result', 'return.waitMs');
  g.wire('statementNumber.value', 'return.statementNumber');
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
  g.add('lastRejection', 'std.object.get-field', {
    label: 'Last Rejection',
    config: { record: T.ledger, path: 'rejection' }
  });
  g.add('rejection', 'std.logic.choose', {
    label: 'Rejection to Show',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'review' }] }
  });
  g.add('check', 'billing.check-claim', { label: 'Check Claim' });
  g.add('checks', 'std.object.make', {
    label: 'Checks',
    config: {
      fields: [
        { name: 'issues', type: T.issues },
        { name: 'claim', type: { object: {} } }
      ]
    }
  });
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
  g.add('unknownStepContext', 'std.object.make', {
    label: 'Step Not Handled',
    config: { fields: [{ name: 'step', type: 'string' }] }
  });
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
  g.add('payerSubjectParts', 'std.list.make', {
    label: 'Subject Parts',
    config: { count: 2, type: 'string' }
  });
  g.add('payerSubject', 'std.text.join', { label: 'Task Subject', values: { separator: ' · ' } });
  template(g, 'claimSubject', 'Task Subject', '{reference}');
  g.add('checkedParts', 'std.object.break', {
    label: 'Issues and Claim Checked',
    config: {
      fields: [
        { name: 'issues', type: T.issues },
        { name: 'claim', type: { object: {} } }
      ]
    }
  });
  g.add('claimContext', 'std.object.make', {
    label: 'Claim Context',
    config: {
      fields: [
        { name: 'claimId', type: { id: 'claim' } },
        { name: 'coverageId', type: { id: 'coverage' } },
        { name: 'payer', type: 'string' },
        { name: 'balanceCents', type: 'integer' },
        { name: 'issues', type: T.issues },
        { name: 'claim', type: { object: {} } }
      ]
    }
  });
  g.add('balance', 'std.object.get', { label: 'Balance', values: { path: 'balanceCents' } });
  g.add('wait', 'std.flow.wait-signal', {
    label: 'Await a Claim Change or Deadline',
    values: { name: CLAIM_SIGNAL }
  });
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data', values: { all: false } });
  g.add('review', 'billing.review-claim', { label: 'Review Claim' });
  g.add('confirmPayers', 'billing.confirm-payers', { label: 'Confirm Payers' });
  g.add('submit', 'billing.submit-to-payer', { label: 'Submit to Payer' });
  g.add('reconcile', 'billing.reconcile-payment', { label: 'Reconcile Payment' });
  g.add('denialInputs', 'std.object.make', {
    label: 'Denial Inputs',
    config: {
      fields: [
        { name: 'claimId', type: { id: 'claim' } },
        { name: 'coverageId', type: { id: 'coverage' } },
        { name: 'subject', type: 'string' },
        { name: 'context', type: 'any' }
      ]
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
  g.add('refundInputs', 'std.object.make', {
    label: 'Refund Inputs',
    config: {
      fields: [
        { name: 'claimId', type: { id: 'claim' } },
        { name: 'subject', type: 'string' },
        { name: 'context', type: 'any' }
      ]
    }
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
  g.wire('ledger.ledger', 'next.ledger', 'lastRejection.record', 'balance.object');
  g.wire('next.step', 'status.key', 'rejection.key', 'route.value');
  g.wire('lastRejection.value', 'rejection.case1');
  g.wire('ledger.then', 'record.exec');
  g.wire('status.value', 'record.status');
  g.wire('ledger.signalsSeen', 'record.signalsSeen', 'wait.after');
  g.wire('record.recorded', 'clear.exec');
  g.wire('clear.then', 'checkFirst.exec');
  g.wire('next.check', 'checkFirst.condition');
  g.wire('checkFirst.true', 'check.exec');
  g.wire('checkFirst.false', 'route.exec');
  g.wire('next.patientOnly', 'check.patientOnly', 'fix.patientOnly');
  g.wire('rejection.value', 'check.rejection');
  g.wire('next.coverageId', 'check.rejectedCoverageId');
  g.wire('check.issues', 'checks.issues');
  g.wire('check.claim', 'checks.claim');
  g.wire('checks.object', 'keepValid.value', 'keepInvalid.value');
  g.wire('check.valid', 'keepValid.exec');
  g.wire('check.invalid', 'keepInvalid.exec');
  g.wire('keepValid.then', 'route.exec');
  g.wire('keepInvalid.then', 'fix.exec');

  g.wire('entry.claimId', 'claimContext.claimId');
  g.wire('next.coverageId', 'claimContext.coverageId');
  g.wire('next.payer', 'claimContext.payer', 'payerSubjectParts.item2');
  g.wire('balance.value', 'claimContext.balanceCents');
  g.wire('checked.value', 'checkedParts.object');
  g.wire('checkedParts.issues', 'claimContext.issues');
  g.wire('checkedParts.claim', 'claimContext.claim');
  g.wire('ledger.reference', 'payerSubjectParts.item1', 'claimSubject.reference');
  g.wire('payerSubjectParts.list', 'payerSubject.items');

  g.wire('route.await', 'wait.exec');
  g.wire('route.awaitPatient', 'wait.exec');
  g.wire('route.awaitReview', 'wait.exec');
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
    g.wire(`${about}Subject.text`, `${id}.subject`);
    g.wire('claimContext.object', `${id}.context`);
    if (id !== 'fix' && id !== 'statement') g.wire('next.coverageId', `${id}.coverageId`);
  }
  g.wire('claimSubject.text', 'collections.subject', 'refundInputs.subject');
  g.wire('claimContext.object', 'collections.context', 'refundInputs.context');
  g.wire('entry.claimId', 'denialInputs.claimId', 'refundInputs.claimId');
  g.wire('next.coverageId', 'denialInputs.coverageId');
  g.wire('payerSubject.text', 'denialInputs.subject');
  g.wire('claimContext.object', 'denialInputs.context');
  for (const id of ['approveWriteOff', 'approveCollections']) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire('balance.value', `${id}.balanceCents`);
    g.wire('claimSubject.text', `${id}.subject`);
    g.wire('claimContext.object', `${id}.context`);
  }
  g.wire('next.writeOffApprovalCents', 'approveWriteOff.thresholdCents');
  g.wire('next.collectionsApprovalCents', 'approveCollections.thresholdCents');
  g.wire('route.review', 'review.exec');
  g.wire('route.reviewPatient', 'review.exec');
  g.wire('route.confirmPayers', 'confirmPayers.exec');
  g.wire('route.submit', 'submit.exec');
  g.wire('route.reconcile', 'reconcile.exec');
  g.wire('route.workDenial', 'denial.exec');
  g.wire('denialInputs.object', 'denial.inputs');
  g.wire('denial.then', 'denied.exec');
  g.wire('denial.pin', 'denied.value');
  g.wire('denied.writeOff', 'approveWriteOff.exec');
  g.wire('denied.void', 'closeVoid.exec');
  g.wire('route.overpaid', 'overpaid.exec');
  g.wire('refundInputs.object', 'overpaid.inputs');
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
  g.wire('claimSubject.text', 'facilityFollowUp.subject');
  g.wire('claimContext.object', 'facilityFollowUp.context');
  g.wire('facilityFollowUp.keepWaiting', 'facilityKeepWaiting.exec');
  g.wire('entry.claimId', 'facilityKeepWaiting.claimId');
  g.wire('facilityFollowUp.writeOff', 'approveWriteOff.exec');
  g.wire('facilityFollowUp.sendToCollections', 'approveCollections.exec');
  g.wire('route.writeOff', 'approveWriteOff.exec');
  g.wire('route.closed', 'closePaid.exec');
  g.wire('route.default', 'unknownStep.exec');
  g.wire('claimSubject.text', 'unknownStep.subject');
  g.wire('next.step', 'unknownStepContext.step');
  g.wire('unknownStepContext.object', 'unknownStep.context');
  summary(
    g,
    'unknownStep',
    'The claim cycle has no branch for the step "{step}"; correct the Claim Steps table, then retry',
    { step: 'next.step' }
  );
  const balance = money(g, 'balanceText', 'Balance Text', 'balance.value');
  summary(
    g,
    'collections',
    '{balance} is still unpaid after every payer and patient statement; write it off or send it to collections',
    { balance: orElse(g, 'balanceOrAny', 'Balance, Else A Balance', balance, 'A balance') }
  );
  summary(
    g,
    'facilityFollowUp',
    'The facility has not paid its invoice for this trip[ ({balance} open)]; contact it, then keep waiting, write it off or send it to collections',
    { balance }
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
    'How many milliseconds of a claim cycle wait are still to go: the wait in days, rounded to whole milliseconds, less the time since it started (none when it has not been timed).',
    claimWaitLeft()
  ),
  asRule(
    'billing.payer-is-coverage',
    'Payer Is Coverage',
    'Whether a payer on the claim is the given coverage.',
    payerIsCoverage()
  ),
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
    'billing.submit-to-payer',
    'Submit to Payer',
    'The one way a claim goes to a payer: prepares it for the payer being billed, maps it onto an 837P (Map 837P Claim), files it with the claim frequency asked for, if any (8 voids the claim the payer has), and sends it to the clearinghouse. When it cannot be filed, asks a biller to try again, fix its data, skip the payer or mark it sent another way. Used by the claim cycle and by Correct Claim for voids.',
    submitToPayer()
  ),
  asRule(
    'billing.underpayment',
    'Underpayment',
    'Holds what a Medicare primary payer allowed against what the Medicare ambulance fee schedule of the year of service allows for the trip (Underpayment table), unless several patients shared the trip, a denial is expected, the response has no reason codes or the year has no schedule: more than $1 short is an underpayment, and its reconcile task is raised.',
    underpayment()
  ),
  asStage(
    'billing.reconcile-payment',
    'Reconcile Payment',
    'Asks a biller to reconcile a payer response that leaves a balance: continue, correct the claim (Correct Claim), or write off the rest.',
    reconcilePayment()
  ),
  asStage(
    'billing.follow-up-payer',
    'Follow Up with Payer',
    'Asks the payer for the claim status (276, real time or batch, waiting up to a day for the 277), then asks a biller what to do about a payer that has not responded, showing the latest status: resubmit (Correct Claim), keep waiting, or move to the next payer.',
    followUpPayer()
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
    "Bills each payer in claim order, one step at a time: reads the claim ledger, decides the Next Claim Step and records it as the claim's status, runs Check Claim before a review or submission (fixing what blocks the claim), has it reviewed, files each approved claim as its own 837P (asking a biller when it cannot), follows up, works denials (Work Denial), reconciles responses (or resubmits a corrected claim), refunds credit balances (Refund Overpayment), waits on a responsible facility (following up when it has not paid within the Claim Policy wait after its invoice), confirms payers when there are none, reviews before the first patient statement, sends statements before collections review, and has write-offs and collections placements above the Claim Policy thresholds approved. Sleeps until a claim change or a deadline.",
    cycleClaim()
  )
];
