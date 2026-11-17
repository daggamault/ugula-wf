import { CLAIM_FIX_FIELDS, PAYMENT_KINDS } from '@ugula/billing';
import type { FieldSpec, GraphDef, PinSpec, VariableDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { p } from './glossary.ts';
import {
  asWorkflow,
  type Builder,
  condition,
  fixed,
  flow,
  makeObject,
  type Port,
  select,
  summary,
  T
} from './shared.ts';

export const EDIT_PERMISSION = 'claims:update';

export const choicesOf = (labels: Readonly<Record<string, string>>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const claimTask = (inputs: PinSpec[] = [], variables: VariableDef[] = []) =>
  flow(
    [p('claimId', { id: 'claim' }), p('assignee', 'string', true), ...inputs],
    [],
    [{ name: 'problem', type: 'string', default: null }, ...variables]
  );

export const beginClaimTask = (g: Builder) => {
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('ledger', 'billing.read-claim-ledger', { label: 'Read Claim Ledger' });
  g.wire('entry.exec', 'follow.exec');
  g.wire('follow.then', 'ledger.exec');
  g.wire('entry.claimId', 'follow.claimId', 'ledger.claimId');
};

export const assigned = (g: Builder, task: string) => {
  g.wire('entry.assignee', `${task}.assignee`);
  g.wire('ledger.reference', `${task}.subject`);
};

export const refusedSummary = (
  g: Builder,
  task: string,
  text: string,
  from: Record<string, Port>
) => {
  g.add('problem', 'std.var.get', { label: 'Why It Was Refused', config: { name: 'problem' } });
  summary(g, task, `[Not saved: {problem}. ]${text}`, { ...from, problem: 'problem.value' });
};

export const claimSummary = (g: Builder, task: string, text: string, refusable = false) =>
  (refusable ? refusedSummary : summary)(g, task, text, { reference: 'ledger.reference' });

export const rememberRefusal = (g: Builder, node: string, retry: Port, id = 'remember') => {
  g.add(id, 'std.var.set', { label: 'Remember Why', config: { name: 'problem' } });
  g.wire(`${node}.refused`, `${id}.exec`);
  g.wire(`${node}.reason`, `${id}.value`);
  g.wire(`${id}.then`, retry);
};

const correctClaimData = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('check', 'billing.check-claim', { label: 'Check Claim', values: { all: true } });
  const context = makeObject(g, 'context', 'Issues and Claim', {
    issues: [T.issues, 'check.issues'],
    claim: [{ object: {} }, 'check.claim']
  });
  claimSummary(
    g,
    'task',
    'Correct what claim {reference} sends on its 837P; charges are priced again when the trip, service, miles or payers change, and the claim is checked again'
  );
  g.add('task', 'std.human.task', {
    label: 'Correct Claim Data',
    config: {
      title: 'Correct claim data',
      queue: 'billing-review',
      permission: EDIT_PERMISSION,
      instructions:
        'Every field starts with what the claim says now, with its issues in the details. Change what is wrong and save; empty fields are left as they are. Charges are mapped and priced again when the classification, service, miles or payers change, the change is logged so an approved claim is reviewed again, and the claim is checked again. Cancel to change nothing.',
      fields: CLAIM_FIX_FIELDS,
      outcomes: ['save', 'cancel'],
      hints: {
        save: 'Applies the changes, reprices charges if the trip, service, miles or payers changed, and checks the claim.',
        cancel: 'Closes the task without changing the claim.'
      },
      prefill: 'current'
    }
  });
  g.add('patch', 'billing.patch-claim', { label: 'Apply the Corrections' });
  g.add('triggers', 'billing.reprice-triggers', { label: 'Reprice Triggers' });
  g.add('repriceNeeded', 'std.flow.branch', { label: 'Reprice?' });
  g.add('reprice', 'billing.reprice-claim', { label: 'Reprice Changed Charges' });
  g.add('void', 'billing.close-claim', { label: 'Void the Claim', values: { status: 'void' } });
  g.add('recheck', 'billing.check-claim', { label: 'Check the Corrected Claim' });
  g.ret('done');
  g.wire('ledger.then', 'check.exec');
  g.wire(
    'entry.claimId',
    'check.claimId',
    'patch.claimId',
    'reprice.claimId',
    'void.claimId',
    'recheck.claimId'
  );
  g.wire('check.valid', 'task.exec');
  g.wire('check.invalid', 'task.exec');
  for (const pin of ['visible', 'defaults', 'options']) g.wire(`check.${pin}`, `task.${pin}`);
  g.wire('check.defaults', 'patch.shown');
  g.wire(context, 'task.context', 'reprice.context');
  assigned(g, 'task');
  g.wire('ledger.reference', 'reprice.subject');
  g.wire('task.save', 'patch.exec');
  for (const { name } of CLAIM_FIX_FIELDS) g.wire(`task.${name}`, `patch.${name}`);
  g.wire('patch.changes', 'triggers.changes');
  g.wire('patch.then', 'repriceNeeded.exec');
  g.wire('triggers.reprice', 'repriceNeeded.condition');
  g.wire('repriceNeeded.true', 'reprice.exec');
  g.wire('repriceNeeded.false', 'recheck.exec');
  for (const pin of ['classification', 'service', 'payerId'])
    g.wire(`patch.${pin}`, `reprice.${pin}`);
  g.wire('reprice.repriced', 'recheck.exec');
  g.wire('reprice.voided', 'void.exec');
  g.wire('void.then', 'done.exec');
  g.wire('recheck.valid', 'done.exec');
  g.wire('recheck.invalid', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

const changeResponsibleParty = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('read', 'billing.read-claim', { label: 'Read the Payers' });
  g.add('choices', 'billing.facility-choices', { label: 'Facility Choices' });
  g.add('claimPayers', 'std.object.get', {
    label: 'Payers on the Claim',
    values: { path: 'payers' }
  });
  g.add('payerNames', 'std.list.pluck', { label: 'Their Names', values: { field: 'name' } });
  const defaults = makeObject(g, 'defaults', 'Payers Now', {
    payers: [{ list: 'string' }, 'payerNames.list']
  });
  claimSummary(
    g,
    'task',
    'Say who pays for the trip on claim {reference}: its payers, in billing order (the patient is billed after the last one), or a facility that is responsible instead',
    true
  );
  g.add('task', 'std.human.task', {
    label: 'Change Responsible Party',
    config: {
      title: 'Change responsible party',
      queue: 'billing-review',
      permission: EDIT_PERMISSION,
      instructions:
        'List the payers to bill, one per line, first payer first, and save. Payers still listed keep their member IDs and history; new names are linked to the payer directory by name; payers left out are removed, unless they already have billing activity. Leave the list empty to bill only the patient. Eligibility is checked for the new payers; enter member IDs with Correct Claim Data. Bill a facility instead when it is responsible for the trip (a contract, a Part A stay): the claim then waits for its monthly facility invoice rather than going to payers on an 837P. Facilities are listed under Admin, Facilities.',
      fields: [
        { name: 'payers', type: { list: 'string' }, label: 'Payers, in billing order' },
        {
          name: 'facilityId',
          type: { id: 'facility' },
          label: 'Responsible facility',
          required: ['billFacility']
        },
        { name: 'note', type: 'string', label: 'Note' }
      ],
      outcomes: ['save', 'billFacility', 'cancel'],
      hints: {
        save: 'Bills these payers (no facility is responsible) and checks their eligibility; if refused, this task comes back with why.',
        billFacility:
          'Records the facility as responsible; the claim waits for its monthly invoice instead of an 837P.',
        cancel: 'Closes the task and changes nothing.'
      },
      prefill: 'current'
    }
  });
  g.add('set', 'billing.set-claim-payers', { label: 'Set the Payers' });
  rememberRefusal(g, 'set', 'read.exec');
  g.add('facts', 'billing.claim-ledger.break', { label: 'Claim Ledger' });
  g.add('wasFacility', 'std.flow.branch', { label: 'Was a Facility Responsible?' });
  g.add('toPayers', 'billing.record-responsibility', {
    label: 'Bill the Payers',
    values: { party: 'payer' }
  });
  g.add('toFacility', 'billing.record-responsibility', {
    label: 'Bill the Facility',
    values: { party: 'facility' }
  });
  const eligibilityInputs = makeObject(g, 'eligibilityInputs', 'Eligibility Inputs', {
    claimId: [{ id: 'claim' }, 'entry.claimId']
  });
  g.add('eligibility', 'std.flow.start-workflow', {
    label: 'Check Eligibility of the Payers',
    config: { workflow: 'billing.check-eligibility', version: 1 }
  });
  g.ret('done');
  g.wire('ledger.then', 'read.exec');
  g.wire('read.then', 'choices.exec');
  g.wire('choices.then', 'task.exec');
  g.wire('choices.options', 'task.options');
  g.wire('entry.claimId', 'read.claimId', 'set.claimId', 'toPayers.claimId', 'toFacility.claimId');
  g.wire('read.claim', 'claimPayers.object');
  g.wire('claimPayers.value', 'payerNames.list');
  g.wire(defaults, 'task.defaults');
  assigned(g, 'task');
  g.wire('task.save', 'set.exec');
  g.wire('task.payers', 'set.payers');
  g.wire('ledger.ledger', 'facts.ledger');
  g.wire('set.saved', 'wasFacility.exec');
  g.wire('facts.billFacility', 'wasFacility.condition');
  g.wire('wasFacility.true', 'toPayers.exec');
  g.wire('wasFacility.false', 'eligibility.exec');
  g.wire('toPayers.then', 'eligibility.exec');
  g.wire('task.note', 'toPayers.note', 'toFacility.note');
  g.wire(eligibilityInputs, 'eligibility.inputs');
  g.wire('eligibility.then', 'done.exec');
  g.wire('task.billFacility', 'toFacility.exec');
  g.wire('task.facilityId', 'toFacility.facilityId');
  g.wire('toFacility.then', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

export const DOCUMENT_FIELDS: FieldSpec[] = [
  { name: 'signedOn', type: 'string', label: 'Signed on (a certification or ABN)', format: 'date' },
  { name: 'file', type: T.blob, label: 'File (PDF, PNG, JPEG or TIFF)' }
];

export const recordAddedDocument = (g: Builder, added: string, then: `${string}.${string}`) => {
  g.add('record', 'billing.record-document', { label: 'Record Document' });
  g.wire('entry.claimId', 'record.claimId');
  g.wire(`${added}.documentId`, 'record.documentId');
  g.wire(`${added}.added`, 'record.exec');
  g.wire('record.done', then);
};

const PAYMENT_FIELDS: FieldSpec[] = [
  { name: 'coverageId', type: { id: 'coverage' }, label: 'Payer (empty for a patient payment)' },
  {
    name: 'kind',
    type: 'string',
    label: 'Type',
    options: choicesOf(PAYMENT_KINDS),
    required: ['post']
  },
  { name: 'paid', type: 'number', label: 'Paid or refunded (USD)', min: 0 },
  { name: 'paidOn', type: 'string', label: 'Paid on', format: 'date' },
  { name: 'checkNumber', type: 'string', label: 'Check or EFT number' },
  { name: 'payerClaimNumber', type: 'string', label: 'Payer claim number' },
  { name: 'reasonCodes', type: { list: 'string' }, label: 'Reason codes, like CO-45 12.50' },
  { name: 'note', type: 'string', label: 'Note' }
];

const postPayment = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('facts', 'billing.claim-ledger.break', { label: 'Claim Ledger' });
  g.add('choices', 'billing.fix-claim-form', {
    label: 'Claim Form Choices',
    values: { all: true, issues: [] }
  });
  g.add('payers', 'std.object.pick', { label: 'Payers', values: { keys: ['coverageId'] } });
  g.add('payerChoices', 'std.object.get', {
    label: 'Payer Choices',
    values: { path: 'coverageId' }
  });
  const noPayers = condition(
    g,
    'noPayers',
    'No Payer to Choose',
    { choices: ['any', 'payerChoices.value'] },
    [{ field: 'choices', op: 'empty' }]
  );
  const visible = select(
    g,
    'visible',
    'Fields to Ask',
    noPayers,
    fixed(PAYMENT_FIELDS.map((f) => f.name).filter((name) => name !== 'coverageId'))
  );
  g.add('defaults', 'std.object.make', {
    label: 'Payment Defaults',
    config: {
      fields: [
        { name: 'coverageId', type: { id: 'coverage' } },
        { name: 'kind', type: 'string' }
      ]
    },
    values: { kind: 'response' }
  });
  claimSummary(
    g,
    'task',
    'Post a payment or refund for claim {reference} that came outside an 835; it is reconciled like a remittance',
    true
  );
  g.add('task', 'std.human.task', {
    label: 'Post Payment',
    config: {
      title: 'Post payment',
      queue: 'billing-reconcile',
      permission: EDIT_PERMISSION,
      instructions:
        "Enter a payer's or the patient's payment that came by mail, phone or card, or a refund paid back, in dollars, with each reason code on its own line (group, code and amount, like CO-45 12.50). Leave the payer empty for a patient payment. A payer payment is classified and routed like an 835 claim payment (Route Remittance): its reason codes decide what is adjusted off the balance, a denial is worked, one that leaves a balance opens a reconcile task, and one that settles the claim closes it as paid.",
      fields: PAYMENT_FIELDS,
      outcomes: ['post', 'cancel'],
      hints: {
        post: 'Routes and posts it like a remittance; a denial is worked, a balance left opens a reconcile task, and a settled claim closes as paid.',
        cancel: 'Closes the task without posting anything.'
      },
      prefill: 'suggested'
    }
  });
  const fromPayer = condition(
    g,
    'routed',
    'A Payer Paid It',
    { kind: ['string', 'task.kind'], coverageId: [{ id: 'coverage' }, 'task.coverageId'] },
    [
      { field: 'kind', op: 'isNot', value: 'refunded' },
      { field: 'coverageId', op: 'present' }
    ]
  );
  g.add('fromPayer', 'std.flow.branch', { label: 'Route It?' });
  g.add('line', 'billing.payment-line', { label: 'Payment Line' });
  g.add('route', 'billing.route-remittance', { label: 'Route Remittance' });
  g.add('post', 'billing.post-claim-payment', { label: 'Post the Payment' });
  g.add('postRouted', 'billing.post-claim-payment', { label: 'Post the Routed Payment' });
  rememberRefusal(g, 'post', 'choices.exec');
  rememberRefusal(g, 'postRouted', 'choices.exec', 'routedRefused');
  rememberRefusal(g, 'line', 'choices.exec', 'lineRefused');
  g.ret('done');
  g.wire('ledger.ledger', 'facts.ledger');
  g.wire('facts.coverageId', 'defaults.coverageId');
  g.wire('ledger.then', 'choices.exec');
  g.wire('entry.claimId', 'choices.claimId', 'post.claimId', 'postRouted.claimId', 'line.claimId');
  g.wire('choices.options', 'payers.object');
  g.wire('payers.object', 'task.options', 'payerChoices.object');
  g.wire('choices.then', 'task.exec');
  g.wire(visible, 'task.visible');
  g.wire('defaults.object', 'task.defaults');
  assigned(g, 'task');
  g.wire('task.post', 'fromPayer.exec');
  g.wire(fromPayer, 'fromPayer.condition');
  g.wire('fromPayer.true', 'line.exec');
  g.wire('fromPayer.false', 'post.exec');
  for (const { name } of PAYMENT_FIELDS) {
    g.wire(`task.${name}`, `post.${name}`, `postRouted.${name}`, `line.${name}`);
  }
  g.wire('line.read', 'postRouted.exec');
  g.wire('line.line', 'route.line');
  g.wire('route.posting', 'postRouted.posting');
  g.wire('task.completedBy', 'post.postedBy', 'postRouted.postedBy');
  g.wire('post.posted', 'done.exec');
  g.wire('postRouted.posted', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

export const claimTaskGraphs: SeedGraph[] = [
  asWorkflow(
    'billing.correct-claim-data',
    'Correct Claim Data',
    'Started from a claim: a Correct claim data task shows every field the claim has. The corrections are applied and logged, so an approved claim is reviewed again; the charges are repriced when the Reprice Triggers rule says so, and the claim is checked again.',
    correctClaimData()
  ),
  asWorkflow(
    'billing.change-responsible-party',
    'Change Responsible Party',
    'Started from a claim: a Change responsible party task says who pays for the trip. Saving payers sets them in billing order (Set Claim Payers; when it refuses, the task comes back with why), clears a facility that was responsible and checks eligibility. Billing a facility from the directory records it as responsible, with the note, which signals the claim cycle.',
    changeResponsibleParty()
  ),
  asWorkflow(
    'billing.post-payment',
    'Post Payment',
    'Started from a claim: a Post payment task enters a payment or refund that came outside an 835 and posts it like a remittance (Post Claim Payment; when it refuses, the task comes back with why).',
    postPayment()
  )
];
