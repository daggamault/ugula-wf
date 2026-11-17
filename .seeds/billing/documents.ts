import { DOCUMENT_KINDS } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  assigned,
  beginClaimTask,
  choicesOf,
  claimSummary,
  claimTask,
  DOCUMENT_FIELDS,
  EDIT_PERMISSION,
  recordAddedDocument,
  refusedSummary,
  rememberRefusal
} from './claim-tasks.ts';
import {
  asRule,
  asStage,
  asWorkflow,
  condition,
  d,
  either,
  exit,
  fixed,
  makeObject,
  orElse,
  P,
  reasonsOf,
  rule,
  select,
  shared,
  stage,
  T,
  template
} from './shared.ts';

const DOCUMENT_CHOICES = choicesOf(DOCUMENT_KINDS);

const DOCUMENT_IN = d('document', T.document, 'Document', 'The document uploaded to the claim.');

const DOCUMENTED = ['pcsOnFile', 'pcsSignedOn', 'abnOnFile', 'abnSignedOn', 'signature'] as const;

const documentName = (): GraphDef => {
  const g = rule(
    [d('kind', 'string', 'Kind', 'The kind of document, such as pcs or facesheet.', true)],
    [d('name', 'string', 'Name', 'The name billers know the document by, such as Facesheet.')]
  );
  g.add('known', 'std.table.lookup', {
    label: 'Known Name',
    config: {
      type: 'string',
      rows: Object.entries(DOCUMENT_KINDS).map(([key, value]) => ({ key, value }))
    }
  });
  g.ret('return');
  g.wire('entry.kind', 'known.key');
  g.wire(orElse(g, 'name', 'Known Name, Else Kind', 'known.value', 'entry.kind'), 'return.name');
  return g.def;
};

const documentFacts = (): GraphDef => {
  const g = rule(
    [DOCUMENT_IN],
    [
      d(
        'pcsOnFile',
        'boolean',
        'Certification on File',
        'A physician certification is on file.',
        true
      ),
      d(
        'pcsSignedOn',
        'string',
        'Certification Signed On',
        'When the certification was signed.',
        true
      ),
      d('abnOnFile', 'boolean', 'ABN on File', 'An Advance Beneficiary Notice is on file.', true),
      d('abnSignedOn', 'string', 'ABN Signed On', 'When the ABN was signed.', true),
      d(
        'signature',
        'string',
        'Billing Signature',
        'Set to signed when a signature form arrived.',
        true
      ),
      d(
        'changes',
        'boolean',
        'Changes the Claim',
        'Whether the document records anything on the claim.'
      ),
      P.reasons('the document records these facts')
    ]
  );
  g.add('document', 'billing.claim-document.break', { label: 'Document' });
  const kind = (id: string, label: string, value: string) =>
    condition(g, id, label, { kind: ['string', 'document.kind'] }, [
      { field: 'kind', op: 'is', value }
    ]);
  const pcs = kind('isPcs', 'A Physician Certification', 'pcs');
  const abn = kind('isAbn', 'An ABN', 'abn');
  const signed = kind('isSignature', 'A Signature Form', 'signature');
  select(g, 'pcsOnFile', 'Certification on File', pcs, fixed(true));
  select(g, 'pcsSignedOn', 'Certification Date', pcs, 'document.signedOn');
  select(g, 'abnOnFile', 'ABN on File', abn, fixed(true));
  select(g, 'abnSignedOn', 'ABN Date', abn, 'document.signedOn');
  select(g, 'signature', 'Release Signed', signed, fixed('signed'));
  const changes = either(
    g,
    'changes',
    'Records Something on the Claim',
    either(g, 'pcsOrAbn', 'A Certification or an ABN', pcs, abn),
    signed
  );
  const reasons = reasonsOf(g, 'reasons', 'What It Records', [
    {
      id: 'pcsReason',
      label: 'Certification Reason',
      when: pcs,
      reason: 'Physician certification statement'
    },
    { id: 'abnReason', label: 'ABN Reason', when: abn, reason: 'Advance Beneficiary Notice' },
    { id: 'signatureReason', label: 'Signature Reason', when: signed, reason: 'Signature form' }
  ]);
  g.ret('return');
  g.wire('entry.document', 'document.document');
  for (const pin of DOCUMENTED) g.wire(`${pin}.result`, `return.${pin}`);
  g.wire(changes, 'return.changes');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const recordDocument = (): GraphDef => {
  const g = stage(
    [
      P.claimId(),
      d('documentId', { id: 'document' }, 'Document', 'The document added to the claim.')
    ],
    [],
    {
      done: exit(
        'Done',
        'What the document records is on the claim, and the claim was checked again.'
      )
    }
  );
  g.add('read', 'billing.read-claim-document', { label: 'Read Claim Document' });
  g.add('facts', 'billing.document-facts', { label: 'Document Facts' });
  g.add('records', 'std.flow.branch', { label: 'Records Anything?' });
  g.add('document', 'billing.claim-document.break', { label: 'Claim Document' });
  g.add('name', 'billing.document-name', { label: 'Document Name' });
  const note = template(g, 'note', 'Document Note', 'Document received: {name}', {
    name: 'name.name'
  });
  g.add('patch', 'billing.patch-claim', { label: 'Record the Document' });
  g.add('check', 'billing.check-claim', { label: 'Check Claim Again' });
  g.ret('done', 'done');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.claimId', 'read.claimId', 'patch.claimId', 'check.claimId');
  g.wire('entry.documentId', 'read.documentId');
  g.wire('read.document', 'facts.document', 'document.document');
  g.wire('document.kind', 'name.kind');
  g.wire('read.then', 'records.exec');
  g.wire('facts.changes', 'records.condition');
  g.wire('records.true', 'patch.exec');
  g.wire('records.false', 'check.exec');
  for (const pin of DOCUMENTED) g.wire(`facts.${pin}`, `patch.${pin}`);
  g.wire(note, 'patch.note');
  g.wire('patch.then', 'check.exec');
  g.wire('check.valid', 'done.exec');
  g.wire('check.invalid', 'done.exec');
  return g.def;
};

const receiveDocument = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  claimSummary(
    g,
    'task',
    'Upload a document for claim {reference}; what it records is put on the claim and the claim is checked again',
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
          options: DOCUMENT_CHOICES,
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
  recordAddedDocument(g, 'add', 'done.exec');
  g.wire('task.cancel', 'done.exec');
  return g.def;
};

const CHASE_DAYS = [
  { key: 'pcs', value: 7 },
  { key: 'signature', value: 14 },
  { key: 'abn', value: 7 },
  { key: 'msp', value: 7 },
  { key: 'facesheet', value: 3 }
];

const chaseDocument = (): GraphDef => {
  const g = claimTask();
  beginClaimTask(g);
  g.add('ask', 'std.human.task', {
    label: 'Start Document Chase',
    config: {
      title: 'Start document chase',
      queue: 'billing-documents',
      permission: EDIT_PERMISSION,
      instructions:
        'Choose the document the claim is missing and note who to ask for it. A Chase document task then waits for it, due in the days the Document Chase Days table gives; it ends on its own once the document is on file.',
      fields: [
        {
          name: 'kind',
          type: 'string',
          label: 'Document',
          options: DOCUMENT_CHOICES,
          required: ['chase']
        },
        { name: 'note', type: 'string', label: 'Who to ask, and for what' }
      ],
      outcomes: ['chase', 'cancel'],
      hints: {
        chase:
          'Opens a Chase document task for it, due by the days its kind allows, unless it is already on file.',
        cancel: 'Closes the task without chasing anything.'
      }
    }
  });
  claimSummary(
    g,
    'ask',
    'Start chasing a document claim {reference} is missing; it is due in the days its kind allows'
  );
  assigned(g, 'ask');
  g.wire('ledger.reference', 'task.subject');
  g.add('days', 'std.table.lookup', {
    label: 'Document Chase Days',
    config: shared.lookup(
      'billing.document-chase-days',
      'Document Chase Days',
      'How many days a biller has to get each kind of missing document before its chase task is due.',
      { type: 'integer', rows: CHASE_DAYS, fallback: 7 }
    )
  });
  g.add('now', 'std.time.now', { label: 'Now' });
  g.add('due', 'std.time.add', { label: 'Chase Due', config: { unit: 'days' } });
  g.add('document', 'billing.document-name', { label: 'Document Name' });
  g.add('read', 'billing.read-claim', { label: 'Read Claim' });
  g.add('stored', 'billing.claim-record.break', { label: 'Documents on File' });
  g.add('onFile', 'std.list.contains', { label: 'It Is on File' });
  const context = makeObject(g, 'context', 'Chase Details', {
    document: ['string', 'document.name'],
    note: ['string', 'ask.note']
  });
  const described = orElse(
    g,
    'described',
    'Document, Else a Document',
    'document.name',
    fixed('A document')
  );
  g.add('received', 'std.flow.branch', { label: 'Received?' });
  g.add('task', 'std.human.task', {
    label: 'Chase Document',
    config: {
      title: 'Chase document',
      queue: 'billing-documents',
      instructions:
        'The claim is missing a document. Get it from the patient, the facility or the physician, upload it here and mark it received; the claim is checked again when it arrives. Mark it received without a file when it was added another way. Stop chasing when it will not come.',
      fields: DOCUMENT_FIELDS,
      outcomes: ['received', 'stop'],
      hints: {
        received:
          'Adds the uploaded file to the claim and checks it again; this task comes back while it is not on file.',
        stop: 'Stops chasing the document; the claim is left as it is.'
      }
    }
  });
  const uploaded = condition(
    g,
    'uploaded',
    'A File Was Uploaded',
    { file: [T.blob, 'task.file'] },
    [{ field: 'file', op: 'present' }]
  );
  g.add('withFile', 'std.flow.branch', { label: 'With a File?' });
  g.add('add', 'billing.add-claim-document', { label: 'Add Claim Document' });
  rememberRefusal(g, 'add', 'task.exec');
  g.ret('done');
  g.wire('ledger.then', 'ask.exec');
  g.wire('ask.chase', 'read.exec');
  g.wire('ask.cancel', 'done.exec');
  g.wire('entry.claimId', 'read.claimId', 'add.claimId');
  g.wire('ask.kind', 'days.key', 'document.kind', 'onFile.item', 'add.kind');
  g.wire('now.now', 'due.time');
  g.wire('days.value', 'due.amount');
  g.wire('read.record', 'stored.record');
  g.wire('stored.documents', 'onFile.list');
  g.wire('read.then', 'received.exec');
  g.wire('onFile.result', 'received.condition');
  g.wire('received.true', 'done.exec');
  g.wire('received.false', 'task.exec');
  g.wire('due.time', 'task.due');
  g.wire(context, 'task.context');
  refusedSummary(
    g,
    'task',
    '{document} is missing from this claim[ ({note})]; get it, upload it here and mark it received',
    { document: described, note: 'ask.note' }
  );
  g.wire('task.received', 'withFile.exec');
  g.wire('task.file', 'add.file');
  g.wire('task.signedOn', 'add.signedOn');
  g.wire('task.completedBy', 'add.addedBy');
  g.wire(uploaded, 'withFile.condition');
  g.wire('withFile.false', 'read.exec');
  g.wire('withFile.true', 'add.exec');
  recordAddedDocument(g, 'add', 'read.exec');
  g.wire('task.stop', 'done.exec');
  return g.def;
};

export const documentGraphs: SeedGraph[] = [
  asRule(
    'billing.document-name',
    'Document Name',
    'Names a kind of claim document the way billers know it, such as Physician certification statement for pcs, or gives the kind itself when it has no name.',
    documentName()
  ),
  asRule(
    'billing.document-facts',
    'Document Facts',
    'What a claim document records on the claim: a certification or ABN on file with the date it was signed, or a signed release for billing.',
    documentFacts()
  ),
  asStage(
    'billing.record-document',
    'Record Document',
    'Reads a document added to a claim and records what it documents (Document Facts) on the claim, which signals the claim so its cycle looks again, then checks the claim again. Used by Receive Document and Chase Document.',
    recordDocument()
  ),
  asWorkflow(
    'billing.receive-document',
    'Add Document',
    'Started from a claim (Add Document): an Add document task uploads a facesheet, certification, signature form, ABN or MSP form. It is kept with the claim (Add Claim Document; when it refuses, the task comes back with why), and what it documents is recorded (Record Document).',
    receiveDocument()
  ),
  asWorkflow(
    'billing.chase-document',
    'Chase Document',
    'Started from a claim: a Start document chase task names the missing document and who to ask. A Chase document task, due in the days the Document Chase Days table gives, then takes the upload (Add Claim Document and Record Document) and comes back until the document is on file or a biller stops chasing it.',
    chaseDocument()
  )
];
