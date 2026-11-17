import type { FieldSpec, GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  assigned,
  beginClaimTask,
  claimSummary,
  claimTask,
  EDIT_PERMISSION,
  rememberRefusal
} from './claim-tasks.ts';
import { CLAIM_POLICY } from './cycle.ts';
import { graph, p } from './glossary.ts';
import {
  asRule,
  asWorkflow,
  condition,
  d,
  either,
  field,
  getField,
  joinText,
  makeObject,
  money,
  reasonsOf,
  rule,
  shared,
  T,
  table,
  template
} from './shared.ts';

const DAYS_PER_MONTH = 30.4375;

const planTerms = (): GraphDef => {
  const g = rule(
    [
      d('installmentCents', 'integer', 'Installment (Cents)', 'What the patient pays each time.'),
      d('intervalDays', 'integer', 'Days Between Installments', 'How far apart installments are.'),
      d('balanceCents', 'integer', 'Balance (Cents)', 'What the patient owes on the claim.')
    ],
    [
      d(
        'needsApproval',
        'boolean',
        'Needs Approval',
        'Whether the terms are outside the Claim Policy, so someone with claims:approve approves them.'
      ),
      d('installments', 'integer', 'Installments', 'How many installments pay off the balance.'),
      d('termMonths', 'number', 'Term (Months)', 'How many months the plan runs.'),
      d('reasons', { list: 'string' }, 'Reasons', 'Why the terms need approval, if they do.')
    ]
  );
  g.add('policy', 'std.table.decide', {
    label: 'Claim Policy for the Patient',
    config: CLAIM_POLICY,
    values: { payerKind: 'patient' }
  });
  g.add('perInstallment', 'std.math.divide', { label: 'Balance Over the Installment' });
  g.add('installments', 'std.math.round', {
    label: 'Installments, Rounded Up',
    config: { direction: 'up' }
  });
  g.add('termDays', 'std.math.multiply', { label: 'Term (Days)' });
  g.add('termMonths', 'std.math.divide', {
    label: 'Term (Months)',
    values: { b: DAYS_PER_MONTH }
  });
  g.add('months', 'std.math.round', { label: 'Term to a Tenth', values: { digits: 1 } });
  const small = condition(
    g,
    'belowMinimum',
    'The Installment Is Below the Minimum',
    {
      installmentCents: ['integer', 'entry.installmentCents'],
      planMinInstallmentCents: ['integer', 'policy.planMinInstallmentCents'],
      balanceCents: ['integer', 'entry.balanceCents']
    },
    [
      { field: 'installmentCents', op: 'lt', input: 'planMinInstallmentCents' },
      { field: 'installmentCents', op: 'lt', input: 'balanceCents' }
    ]
  );
  const long = condition(
    g,
    'tooLong',
    'The Plan Runs Too Long',
    {
      termMonths: ['number', 'months.result'],
      planMaxMonths: ['integer', 'policy.planMaxMonths']
    },
    [{ field: 'termMonths', op: 'gt', input: 'planMaxMonths' }]
  );
  g.ret('return');
  g.wire('entry.balanceCents', 'perInstallment.a');
  g.wire('entry.installmentCents', 'perInstallment.b');
  g.wire('perInstallment.result', 'installments.value');
  g.wire('installments.result', 'termDays.a', 'return.installments');
  g.wire('entry.intervalDays', 'termDays.b');
  g.wire('termDays.result', 'termMonths.a');
  g.wire('termMonths.result', 'months.value');
  g.wire('months.result', 'return.termMonths');
  g.wire(either(g, 'outside', 'Outside the Claim Policy', small, long), 'return.needsApproval');
  g.wire(
    reasonsOf(g, 'why', 'Why It Needs Approval', [
      {
        id: 'smallReason',
        label: 'Below the Minimum Installment',
        when: small,
        reason: 'The installment is below the smallest the Claim Policy allows'
      },
      {
        id: 'longReason',
        label: 'Longer Than the Longest Term',
        when: long,
        reason: 'The plan runs longer than the Claim Policy allows'
      }
    ]),
    'return.reasons'
  );
  return g.def;
};

const PLAN_FIELDS: FieldSpec[] = [
  { name: 'installment', type: 'number', label: 'Installment (USD)', min: 1, required: ['save'] },
  {
    name: 'intervalDays',
    type: 'integer',
    label: 'Days Between Installments',
    min: 1,
    max: 366,
    required: ['save']
  },
  {
    name: 'firstDueOn',
    type: 'string',
    label: 'First Due Date',
    format: 'date',
    required: ['save']
  }
];

const setUpPaymentPlan = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('facts', 'billing.claim-ledger.break', { label: 'Claim Ledger' });
  g.add('defaults', 'std.object.make', {
    label: 'Plan Defaults',
    config: { fields: [{ name: 'intervalDays', type: 'integer' }] },
    values: { intervalDays: 30 }
  });
  claimSummary(
    g,
    'task',
    'Set up a payment plan for claim {reference}: the installment, how often it is due and the first due date',
    true
  );
  g.add('task', 'std.human.task', {
    label: 'Set Up Payment Plan',
    config: {
      title: 'Set up payment plan',
      queue: 'billing-review',
      permission: EDIT_PERMISSION,
      instructions:
        'Enter what the patient agreed to pay each time, how many days apart and when the first installment is due. The claim cycle then sends a statement for each installment and waits for it instead of sending collection statements; a missed installment comes back as a task, and the plan ends once the balance is paid. Terms below the smallest installment or longer than the longest term of the Claim Policy need approval from someone with claims:approve.',
      fields: PLAN_FIELDS,
      outcomes: ['save', 'cancel'],
      hints: {
        save: 'Starts the plan, once approved when its terms are outside the Claim Policy; if refused, this task comes back with why.',
        cancel: 'Closes the task without setting up a plan.'
      }
    }
  });
  g.add('cents', 'std.math.multiply', { label: 'Installment (Cents)', values: { b: 100 } });
  g.add('wholeCents', 'std.math.round', { label: 'Whole Cents' });
  g.add('terms', 'billing.plan-terms', { label: 'Plan Terms' });
  g.add('needsApproval', 'std.flow.branch', { label: 'Needs Approval?' });
  const details = makeObject(g, 'details', 'Plan and Why', {
    installmentCents: ['integer', 'wholeCents.result'],
    intervalDays: ['integer', 'task.intervalDays'],
    firstDueOn: ['string', 'task.firstDueOn'],
    installments: ['integer', 'terms.installments'],
    termMonths: ['number', 'terms.termMonths'],
    why: [{ list: 'string' }, 'terms.reasons']
  });
  g.add('approve', 'std.human.task', {
    label: 'Approve Payment Plan',
    config: {
      title: 'Approve payment plan',
      queue: 'billing-approvals',
      permission: 'claims:approve',
      instructions:
        'A biller set up a payment plan whose terms are outside the Claim Policy: the installment is below the smallest it allows or the plan runs longer than it allows (the details say which). Approve it to start the plan, or reject it to send it back.',
      outcomes: ['approve', 'reject'],
      hints: {
        approve: 'Starts the payment plan.',
        reject: 'Sends the Set up payment plan task back without starting a plan.'
      }
    }
  });
  g.add('start', 'billing.start-payment-plan', { label: 'Start Payment Plan' });
  g.add('rejected', 'std.var.set', {
    label: 'Remember the Rejection',
    config: { name: 'problem' },
    values: { value: 'the terms outside the Claim Policy were not approved' }
  });
  rememberRefusal(g, 'start', 'ledger.exec');
  g.ret('done');
  g.wire('ledger.then', 'task.exec');
  g.wire('ledger.ledger', 'facts.ledger');
  g.wire('defaults.object', 'task.defaults');
  assigned(g, 'task');
  g.wire('task.installment', 'cents.a');
  g.wire('cents.result', 'wholeCents.value');
  g.wire('wholeCents.result', 'terms.installmentCents', 'start.installmentCents');
  g.wire('task.intervalDays', 'terms.intervalDays', 'start.intervalDays');
  g.wire('facts.balanceCents', 'terms.balanceCents');
  g.wire('task.save', 'needsApproval.exec');
  g.wire('terms.needsApproval', 'needsApproval.condition');
  g.wire('needsApproval.false', 'start.exec');
  g.wire('needsApproval.true', 'approve.exec');
  g.wire('ledger.reference', 'approve.subject');
  g.wire(details, 'approve.context');
  g.wire(
    template(
      g,
      'approveSummary',
      'Approval Summary',
      'Approve a payment plan of {installment} every {days} days for claim {reference}[: {why}], or reject it',
      {
        installment: money(g, 'installmentText', 'Installment', 'wholeCents.result'),
        days: 'task.intervalDays',
        reference: 'ledger.reference',
        why: joinText(g, 'whyText', 'Why', '; ', 'terms.reasons')
      }
    ),
    'approve.summary'
  );
  g.wire('approve.approve', 'start.exec');
  g.wire('approve.reject', 'rejected.exec');
  g.wire('rejected.then', 'ledger.exec');
  g.wire('entry.claimId', 'start.claimId');
  g.wire('task.firstDueOn', 'start.firstDueOn');
  g.wire('task.completedBy', 'start.createdBy');
  g.wire('start.started', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

const COLLECTION_AGENCY = shared.decision(
  'billing.collection-agency',
  'Collection Agency',
  'Which collection agency a claim sent to collections is placed with, and the share of what it recovers it keeps, by the balance placed. Place Collections lists the claim in the placement file of the day.',
  table(
    [field('balanceCents', 'integer', 'Balance (Cents)')],
    [field('agencyName', 'string', 'Collection Agency'), field('feePct', 'number', 'Fee (%)')],
    [],
    { agencyName: 'Collection Agency', feePct: 30 }
  )
);

const placeCollections = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('claimId', { id: 'claim' })],
    outputs: []
  });
  g.trigger({
    kind: 'event',
    event: 'claim.status_changed',
    where: { to: { op: 'is', value: 'collections' } }
  });
  g.add('ledger', 'billing.read-claim-ledger', { label: 'Read Claim Ledger' });
  g.add('agency', 'std.table.decide', { label: 'Collection Agency', config: COLLECTION_AGENCY });
  g.add('place', 'billing.record-collections-placement', { label: 'Record Placement' });
  g.ret('done');
  g.wire('entry.exec', 'ledger.exec');
  g.wire('entry.claimId', 'ledger.claimId', 'place.claimId');
  g.wire(
    getField(g, 'balance', 'Balance (Cents)', T.ledger, 'balanceCents', 'ledger.ledger'),
    'agency.balanceCents'
  );
  g.wire('agency.agencyName', 'place.agencyName');
  g.wire('agency.feePct', 'place.feePct');
  g.wire('ledger.then', 'place.exec');
  g.wire('place.then', 'done.exec');
  return g.def;
};

export const balanceGraphs: SeedGraph[] = [
  asRule(
    'billing.plan-terms',
    'Plan Terms',
    'Holds the terms of a payment plan against the Claim Policy for the patient: an installment below the Plan Minimum Installment (unless it pays the whole balance) or a plan longer than the Plan Longest Term needs approval from someone with claims:approve, with why, the installments it takes and how many months it runs.',
    planTerms()
  ),
  asWorkflow(
    'billing.set-up-payment-plan',
    'Set Up Payment Plan',
    'Started from a claim: a Set up payment plan task asks the installment, the days between installments and the first due date. Terms outside the Claim Policy (Plan Terms) are approved by someone with claims:approve first; then Start Payment Plan saves the plan and signals the claim, whose cycle bills each installment and asks about a missed one.',
    setUpPaymentPlan()
  ),
  asWorkflow(
    'billing.place-collections',
    'Place Collections',
    'Places a claim with the collection agency when its status becomes Sent to Collections: the Collection Agency table names the agency and its fee by the balance, and Record Collections Placement records it, adds the claim to the placement file of the day and logs it in the claim files. Money the agency recovers is posted as a patient payment (Post Payment), which reopens the claim.',
    placeCollections()
  )
];
