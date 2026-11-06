import { CLAIM_FIX_FIELDS, DOCUMENT_KINDS, PAYMENT_KINDS } from '@ugula/billing';
import type { FieldSpec, GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { p } from './glossary.ts';
import { asWorkflow, type Builder, expr, flow, summarize, T } from './shared.ts';

const EDIT_PERMISSION = 'claims:update';

const choicesOf = (labels: Readonly<Record<string, string>>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const claimTask = () =>
  flow(
    [p('claimId', 'string'), p('assignee', 'string', true)],
    [],
    [{ name: 'problem', type: 'string', default: null }]
  );

export const beginClaimTask = (g: Builder) => {
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('ledger', 'billing.read-claim-ledger', { label: 'Read Claim Ledger' });
  g.wire('entry.exec', 'follow.exec');
  g.wire('follow.then', 'ledger.exec');
  g.wire('entry.claimId', 'follow.claimId', 'ledger.claimId');
};

const assigned = (g: Builder, task: string) => {
  g.wire('entry.assignee', `${task}.assignee`);
  g.wire('ledger.reference', `${task}.subject`);
};

export const claimSummary = (g: Builder, task: string, sentence: string, refusable = false) => {
  if (!refusable) {
    summarize(g, task, sentence, { reference: 'ledger.reference' });
    return;
  }
  g.add('problem', 'std.var.get', { label: 'Why It Was Refused', config: { name: 'problem' } });
  summarize(g, task, `(problem != null ? 'Not saved: ' + problem + '. ' : '') + ${sentence}`, {
    reference: 'ledger.reference',
    problem: 'problem.value'
  });
};
const rememberRefusal = (g: Builder, node: string, retry: `${string}.${string}`) => {
  g.add('remember', 'std.var.set', { label: 'Remember Why', config: { name: 'problem' } });
  g.wire(`${node}.refused`, 'remember.exec');
  g.wire(`${node}.reason`, 'remember.value');
  g.wire('remember.then', retry);
};

const correctClaimData = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('check', 'billing.check-claim', { label: 'Check Claim', values: { all: true } });
  g.add('context', 'std.expr', expr('Correction Context', '{ issues: issues, claim: claim }'));
  claimSummary(
    g,
    'task',
    '"Correct what claim " + reference + " sends on its 837P; charges are priced again when the trip, service, miles or payers change, and the claim is checked again."'
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
  g.wire('check.issues', 'context.issues');
  g.wire('check.claim', 'context.claim');
  for (const pin of ['visible', 'defaults', 'options']) g.wire(`check.${pin}`, `task.${pin}`);
  g.wire('context.result', 'task.context', 'reprice.context');
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

const changePayers = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('read', 'billing.read-claim-checks', { label: 'Read the Payers' });
  g.add(
    'defaults',
    'std.expr',
    expr('Payers Now', '{ payers: map(claim.payers, payer => payer.name) }')
  );
  claimSummary(
    g,
    'task',
    '"Set the payers claim " + reference + " is billed to, in billing order; the patient is billed after the last one."',
    true
  );
  g.add('task', 'std.human.task', {
    label: 'Change Payers',
    config: {
      title: 'Change payers',
      queue: 'billing-review',
      permission: EDIT_PERMISSION,
      instructions:
        'List the payers to bill, one per line, first payer first. Payers still listed keep their member IDs and history; new names are linked to the payer directory by name; payers left out are removed, unless they already have billing activity. Leave the list empty to bill only the patient. Eligibility is checked for the new payers. Enter member IDs with Correct Claim Data.',
      fields: [
        {
          name: 'payers',
          type: { list: 'string' },
          label: 'Payers, in billing order'
        }
      ],
      outcomes: ['save', 'cancel'],
      hints: {
        save: 'Sets the claim to these payers and checks their eligibility; if refused, this task comes back with why.',
        cancel: 'Closes the task and keeps the payers as they are.'
      },
      prefill: 'current'
    }
  });
  g.add('set', 'billing.set-claim-payers', { label: 'Set the Payers' });
  rememberRefusal(g, 'set', 'read.exec');
  g.add('eligibilityInputs', 'std.object.make', {
    label: 'Eligibility Inputs',
    config: { fields: [{ name: 'claimId', type: 'string' }] }
  });
  g.add('eligibility', 'std.flow.start-workflow', {
    label: 'Check Eligibility of the Payers',
    config: { workflow: 'billing.check-eligibility', version: 1 }
  });
  g.ret('done');
  g.wire('ledger.then', 'read.exec');
  g.wire('entry.claimId', 'read.claimId', 'set.claimId', 'eligibilityInputs.claimId');
  g.wire('read.claim', 'defaults.claim');
  g.wire('read.then', 'task.exec');
  g.wire('defaults.result', 'task.defaults');
  assigned(g, 'task');
  g.wire('task.save', 'set.exec');
  g.wire('task.payers', 'set.payers');
  g.wire('set.saved', 'eligibility.exec');
  g.wire('eligibilityInputs.object', 'eligibility.inputs');
  g.wire('eligibility.then', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

const setFacility = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('choices', 'billing.facility-choices', { label: 'Facility Choices' });
  claimSummary(
    g,
    'task',
    '"Say whether a facility pays for the trip on claim " + reference + " instead of its payers."'
  );
  g.add('task', 'std.human.task', {
    label: 'Set Responsible Facility',
    config: {
      title: 'Set responsible facility',
      queue: 'billing-review',
      permission: EDIT_PERMISSION,
      instructions:
        'Bill a facility when it is responsible for this trip (a contract, a Part A stay): the claim then waits for the monthly facility invoice instead of going to payers on an 837P. Bill the payers when no facility is responsible. Facilities are listed under Admin, Facilities.',
      fields: [
        {
          name: 'facilityId',
          type: 'string',
          label: 'Responsible facility',
          required: ['billFacility']
        },
        { name: 'note', type: 'string', label: 'Note' }
      ],
      outcomes: ['billFacility', 'billPayers', 'cancel'],
      hints: {
        billFacility:
          'Records the facility as responsible; the claim waits for its monthly invoice instead of an 837P.',
        billPayers: 'Records that no facility is responsible; the claim is billed to its payers.',
        cancel: 'Closes the task and records nothing.'
      }
    }
  });
  g.add('toFacility', 'billing.record-responsibility', {
    label: 'Bill the Facility',
    values: { party: 'facility' }
  });
  g.add('toPayers', 'billing.record-responsibility', {
    label: 'Bill the Payers',
    values: { party: 'payer' }
  });
  g.ret('done');
  g.wire('ledger.then', 'choices.exec');
  g.wire('choices.then', 'task.exec');
  g.wire('choices.options', 'task.options');
  assigned(g, 'task');
  g.wire('entry.claimId', 'toFacility.claimId', 'toPayers.claimId');
  g.wire('task.billFacility', 'toFacility.exec');
  g.wire('task.facilityId', 'toFacility.facilityId');
  g.wire('task.note', 'toFacility.note', 'toPayers.note');
  g.wire('task.billPayers', 'toPayers.exec');
  g.wire('toFacility.then', 'done.exec');
  g.wire('toPayers.then', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

export const DOCUMENT_FIELDS: FieldSpec[] = [
  { name: 'signedOn', type: 'string', label: 'Signed on (a certification or ABN)', format: 'date' },
  { name: 'file', type: T.blob, label: 'File (PDF, PNG, JPEG or TIFF)' }
];

export const receiveAddedDocument = (g: Builder, added: string, then: `${string}.${string}`) => {
  g.add('receiveInputs', 'std.object.make', {
    label: 'Document to Receive',
    config: {
      fields: [
        { name: 'claimId', type: 'string' },
        { name: 'documentId', type: 'string' }
      ]
    }
  });
  g.add('receive', 'std.flow.run-workflow', {
    label: 'Receive Document',
    config: { workflow: 'billing.receive-document', version: 1 }
  });
  g.wire('entry.claimId', 'receiveInputs.claimId');
  g.wire(`${added}.documentId`, 'receiveInputs.documentId');
  g.wire(`${added}.added`, 'receive.exec');
  g.wire('receiveInputs.object', 'receive.inputs');
  g.wire('receive.then', then);
};

const addDocument = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  claimSummary(
    g,
    'task',
    '"Upload a document for claim " + reference + "; what it records is put on the claim and the claim is checked again."',
    true
  );
  g.add('task', 'std.human.task', {
    label: 'Add Document',
    config: {
      title: 'Add document',
      queue: 'billing-documents',
      permission: EDIT_PERMISSION,
      instructions:
        'Choose what the document is and upload it as a PDF, PNG, JPEG or TIFF, with the date it was signed for a certification or ABN. It is kept with the claim, what it records (a certification or ABN on file, a signed release for billing) is put on the claim, and the claim is checked again.',
      fields: [
        {
          name: 'kind',
          type: 'string',
          label: 'Document',
          options: choicesOf(DOCUMENT_KINDS),
          required: ['add']
        },
        ...DOCUMENT_FIELDS.map((f) => (f.name === 'file' ? { ...f, required: ['add'] } : f))
      ],
      outcomes: ['add', 'cancel'],
      hints: {
        add: 'Keeps the document with the claim, puts what it records on the claim and checks it again.',
        cancel: 'Closes the task without adding a document.'
      }
    }
  });
  g.add('add', 'billing.add-claim-document', { label: 'Add Claim Document' });
  rememberRefusal(g, 'add', 'task.exec');
  g.ret('done');
  g.wire('ledger.then', 'task.exec');
  assigned(g, 'task');
  g.wire('entry.claimId', 'add.claimId');
  g.wire('task.add', 'add.exec');
  for (const pin of ['kind', 'signedOn', 'file']) g.wire(`task.${pin}`, `add.${pin}`);
  g.wire('task.completedBy', 'add.addedBy');
  receiveAddedDocument(g, 'add', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

const PAYMENT_FIELDS: FieldSpec[] = [
  { name: 'coverageId', type: 'string', label: 'Payer (empty for a patient payment)' },
  {
    name: 'kind',
    type: 'string',
    label: 'Type',
    options: choicesOf(PAYMENT_KINDS),
    required: ['post']
  },
  { name: 'paid', type: 'number', label: 'Paid or refunded (USD)', min: 0 },
  { name: 'adjusted', type: 'number', label: 'Adjusted (USD)', min: 0 },
  { name: 'paidOn', type: 'string', label: 'Paid on', format: 'date' },
  { name: 'checkNumber', type: 'string', label: 'Check or EFT number' },
  { name: 'payerClaimNumber', type: 'string', label: 'Payer claim number' },
  { name: 'reasonCodes', type: { list: 'string' }, label: 'Reason codes, like CO-45 12.50' },
  { name: 'note', type: 'string', label: 'Note' }
];

const postPayment = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('facts', 'billing.claim-ledger.break');
  g.add('choices', 'billing.fix-claim-form', {
    label: 'Payer Choices',
    values: { all: true, issues: [] }
  });
  g.add('payers', 'std.object.pick', { label: 'Payers', values: { keys: ['coverageId'] } });
  g.add('visible', 'std.expr', {
    ...expr(
      'Fields to Ask',
      'payers.coverageId == null ? filter(fields, f => f != "coverageId") : null'
    ),
    values: { fields: PAYMENT_FIELDS.map((f) => f.name) }
  });
  g.add(
    'defaults',
    'std.expr',
    expr('Payment Defaults', '{ coverageId: coverageId, kind: "response" }')
  );
  claimSummary(
    g,
    'task',
    '"Post a payment or refund for claim " + reference + " that came outside an 835; it is reconciled like a remittance."',
    true
  );
  g.add('task', 'std.human.task', {
    label: 'Post Payment',
    config: {
      title: 'Post payment',
      queue: 'billing-reconcile',
      permission: EDIT_PERMISSION,
      instructions:
        "Enter a payer's or the patient's payment that came by mail, phone or card, or a refund paid back, in dollars, with each reason code on its own line (group, code and amount, like CO-45 12.50). Leave the payer empty for a patient payment. A payer payment that leaves a balance opens a reconcile task, and one that settles the claim closes it as paid.",
      fields: PAYMENT_FIELDS,
      outcomes: ['post', 'cancel'],
      hints: {
        post: 'Posts it like a remittance; a balance left opens a reconcile task, and a settled claim closes as paid.',
        cancel: 'Closes the task without posting anything.'
      },
      prefill: 'suggested'
    }
  });
  g.add('post', 'billing.post-claim-payment', { label: 'Post the Payment' });
  rememberRefusal(g, 'post', 'choices.exec');
  g.ret('done');
  g.wire('ledger.ledger', 'facts.ledger');
  g.wire('facts.coverageId', 'defaults.coverageId');
  g.wire('ledger.then', 'choices.exec');
  g.wire('entry.claimId', 'choices.claimId', 'post.claimId');
  g.wire('choices.options', 'payers.object');
  g.wire('payers.object', 'task.options', 'visible.payers');
  g.wire('choices.then', 'task.exec');
  g.wire('visible.result', 'task.visible');
  g.wire('defaults.result', 'task.defaults');
  assigned(g, 'task');
  g.wire('task.post', 'post.exec');
  for (const { name } of PAYMENT_FIELDS) g.wire(`task.${name}`, `post.${name}`);
  g.wire('task.completedBy', 'post.postedBy');
  g.wire('post.posted', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

export const claimTaskGraphs: SeedGraph[] = [
  asWorkflow(
    'billing.correct-claim-data',
    'Correct Claim Data',
    'Started from a claim: a Correct claim data task with every field the claim has, then applies the corrections (logged, so an approved claim is reviewed again), reprices when the Reprice Triggers rule says so and checks the claim again.',
    correctClaimData()
  ),
  asWorkflow(
    'billing.change-payers',
    'Change Payers',
    'Started from a claim: a Change payers task lists the payers in billing order to add, reorder or remove, then sets them (Set Claim Payers, asked again with the reason when refused) and checks eligibility.',
    changePayers()
  ),
  asWorkflow(
    'billing.set-facility',
    'Set Responsible Facility',
    'Started from a claim: a Set responsible facility task bills a facility from the directory for the trip, or the payers, and records it with the note, which signals the claim cycle.',
    setFacility()
  ),
  asWorkflow(
    'billing.add-document',
    'Add Document',
    'Started from a claim: an Add document task uploads a facesheet, certification, signature form, ABN or MSP form, keeps it with the claim (Add Claim Document, asked again with the reason when refused) and runs Receive Document on it.',
    addDocument()
  ),
  asWorkflow(
    'billing.post-payment',
    'Post Payment',
    'Started from a claim: a Post payment task enters a payment or refund that came outside an 835, then posts it like a remittance (Post Claim Payment, asked again with the reason when refused).',
    postPayment()
  )
];
