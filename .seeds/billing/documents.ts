import { DOCUMENT_KINDS } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  beginClaimTask,
  claimSummary,
  claimTask,
  DOCUMENT_FIELDS,
  receiveAddedDocument
} from './claim-tasks.ts';
import {
  asRule,
  asWorkflow,
  d,
  expr,
  field,
  flow,
  is,
  named,
  P,
  rule,
  shared,
  summarize,
  T,
  table
} from './shared.ts';

const CHASE_SUMMARY = `(problem != null ? 'Not saved: ' + problem + '. ' : '') + (kind != null ? labels[kind] ?? kind : 'A document') + ' is missing from this claim' +
  (${named('note', 'null')} != null ? ' (' + note + ')' : '') +
  '; get it, upload it here and mark it received'`;

const DOCUMENT_IN = d('document', T.document, 'Document', 'The document uploaded to the claim.');

const DOCUMENTED = ['pcsOnFile', 'pcsSignedOn', 'abnOnFile', 'abnSignedOn', 'signature'] as const;

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
      d('signature', 'string', 'Billing Signature', 'signed when a signature form arrived.', true),
      d(
        'changes',
        'boolean',
        'Changes the Claim',
        'Whether the document records anything on the claim.'
      ),
      P.reasons('the document records these facts')
    ]
  );
  g.add('document', 'billing.claim-document.break');
  g.add('decide', 'std.table.decide', {
    label: 'Document Kinds',
    config: shared.decision(
      'billing.document-kinds',
      'Document Kinds',
      'What each kind of claim document records on the claim, and which date its signed date is: a certification puts a PCS on file, an ABN puts an ABN on file, a signature form signs the release for billing. Facesheets and MSP forms are kept with the claim for a biller to read.',
      table(
        [field('kind', 'string', 'Document kind')],
        [
          field('pcsOnFile', 'boolean', 'Physician certification on file'),
          field('abnOnFile', 'boolean', 'ABN on file'),
          field('signature', 'string', 'Billing signature'),
          field('datedAs', 'string', 'Which date it signs (pcs or abn)')
        ],
        [
          {
            label: 'Physician certification statement',
            when: { kind: is('pcs') },
            set: { pcsOnFile: true, datedAs: 'pcs' }
          },
          {
            label: 'Advance Beneficiary Notice',
            when: { kind: is('abn') },
            set: { abnOnFile: true, datedAs: 'abn' }
          },
          {
            label: 'Signature form',
            when: { kind: is('signature') },
            set: { signature: 'signed' }
          }
        ]
      )
    )
  });
  g.add(
    'pcsSignedOn',
    'std.expr',
    expr('Certification Date', "datedAs == 'pcs' ? signedOn : null")
  );
  g.add('abnSignedOn', 'std.expr', expr('ABN Date', "datedAs == 'abn' ? signedOn : null"));
  g.ret('return');
  g.wire('entry.document', 'document.document');
  g.wire('document.kind', 'decide.kind');
  g.wire('document.signedOn', 'pcsSignedOn.signedOn', 'abnSignedOn.signedOn');
  g.wire('decide.datedAs', 'pcsSignedOn.datedAs', 'abnSignedOn.datedAs');
  for (const pin of ['pcsOnFile', 'abnOnFile', 'signature'])
    g.wire(`decide.${pin}`, `return.${pin}`);
  g.wire('pcsSignedOn.result', 'return.pcsSignedOn');
  g.wire('abnSignedOn.result', 'return.abnSignedOn');
  g.wire('decide.matched', 'return.changes');
  g.wire('decide.rules', 'return.reasons');
  return g.def;
};

const receiveDocument = (): GraphDef => {
  const g = flow(
    [P.claimId(), d('documentId', 'string', 'Document', 'The document uploaded to the claim.')],
    []
  );
  g.add('follow', 'billing.follow-claim', { label: 'Follow the Claim' });
  g.add('read', 'billing.read-claim-document', { label: 'Read Claim Document' });
  g.add('facts', 'billing.document-facts', { label: 'Document Facts' });
  g.add('records', 'std.flow.branch', { label: 'Records Anything?' });
  g.add('labels', 'std.expr', {
    ...expr('Document Note', "'Document received: ' + (labels[document.kind] ?? document.kind)"),
    values: { labels: DOCUMENT_KINDS }
  });
  g.add('patch', 'billing.patch-claim', { label: 'Record the Document' });
  g.add('check', 'billing.check-claim', { label: 'Check Claim Again' });
  g.ret('done');
  g.wire('entry.exec', 'follow.exec');
  g.wire('follow.then', 'read.exec');
  g.wire('entry.claimId', 'follow.claimId', 'read.claimId', 'patch.claimId', 'check.claimId');
  g.wire('entry.documentId', 'read.documentId');
  g.wire('read.document', 'facts.document', 'labels.document');
  g.wire('read.then', 'records.exec');
  g.wire('facts.changes', 'records.condition');
  g.wire('records.true', 'patch.exec');
  g.wire('records.false', 'check.exec');
  for (const pin of DOCUMENTED) g.wire(`facts.${pin}`, `patch.${pin}`);
  g.wire('labels.result', 'patch.note');
  g.wire('patch.then', 'check.exec');
  g.wire('check.valid', 'done.exec');
  g.wire('check.invalid', 'done.exec');
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
      title: 'Chase a document',
      queue: 'billing-documents',
      permission: 'claims:update',
      instructions:
        'Choose the document the claim is missing and note who to ask for it. A Chase document task then waits for it, due in the days the Document Chase Days table gives; it ends on its own once the document is on file.',
      fields: [
        {
          name: 'kind',
          type: 'string',
          label: 'Document',
          options: Object.entries(DOCUMENT_KINDS).map(([value, label]) => ({ value, label })),
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
    "'Start chasing a document claim ' + reference + ' is missing, due by the days its kind allows'"
  );
  g.wire('entry.assignee', 'ask.assignee');
  g.wire('ledger.reference', 'ask.subject', 'task.subject');
  g.add('days', 'std.table.lookup', {
    label: 'Document Chase Days',
    config: shared.lookup(
      'billing.document-chase-days',
      'Document Chase Days',
      'How many days a biller has to get each kind of missing document before its chase task is due.',
      { type: 'integer', rows: CHASE_DAYS, fallback: 7 }
    )
  });
  g.add('due', 'std.expr', expr('Due At', 'addDays(now(), days)'));
  g.add('context', 'std.expr', {
    ...expr(
      'Chase Context',
      '{ document: labels[kind] ?? kind, note: note, onFile: contains(documents ?? [], kind) }'
    ),
    values: { labels: DOCUMENT_KINDS }
  });
  g.add('read', 'billing.read-claim-checks', { label: 'Documents on File' });
  g.add('facts', 'billing.check-facts.break');
  g.add('onFile', 'std.expr', expr('Is It on File?', 'contains(documents ?? [], kind)'));
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
  g.add('problem', 'std.var.get', { label: 'Why It Was Refused', config: { name: 'problem' } });
  g.add('uploaded', 'std.expr', expr('File Uploaded?', 'file != null'));
  g.add('withFile', 'std.flow.branch', { label: 'With a File?' });
  g.add('add', 'billing.add-claim-document', { label: 'Add Claim Document' });
  g.add('remember', 'std.var.set', { label: 'Remember Why', config: { name: 'problem' } });
  g.ret('done');
  g.wire('ledger.then', 'ask.exec');
  g.wire('ask.chase', 'read.exec');
  g.wire('ask.cancel', 'done.exec');
  g.wire('entry.claimId', 'read.claimId', 'add.claimId');
  g.wire('ask.kind', 'days.key', 'context.kind', 'onFile.kind', 'add.kind');
  g.wire('ask.note', 'context.note');
  g.wire('days.value', 'due.days');
  g.wire('read.facts', 'facts.facts');
  g.wire('facts.documents', 'onFile.documents', 'context.documents');
  g.wire('read.then', 'received.exec');
  g.wire('onFile.result', 'received.condition');
  g.wire('received.true', 'done.exec');
  g.wire('received.false', 'task.exec');
  g.wire('due.result', 'task.due');
  g.wire('context.result', 'task.context');
  summarize(
    g,
    'task',
    CHASE_SUMMARY,
    { kind: 'ask.kind', note: 'ask.note', problem: 'problem.value' },
    { labels: DOCUMENT_KINDS }
  );
  g.wire('task.received', 'withFile.exec');
  g.wire('task.file', 'uploaded.file', 'add.file');
  g.wire('task.signedOn', 'add.signedOn');
  g.wire('task.completedBy', 'add.addedBy');
  g.wire('uploaded.result', 'withFile.condition');
  g.wire('withFile.false', 'read.exec');
  g.wire('withFile.true', 'add.exec');
  receiveAddedDocument(g, 'add', 'read.exec');
  g.wire('add.refused', 'remember.exec');
  g.wire('add.reason', 'remember.value');
  g.wire('remember.then', 'task.exec');
  g.wire('task.stop', 'done.exec');
  return g.def;
};
export const documentGraphs: SeedGraph[] = [
  asRule(
    'billing.document-facts',
    'Document Facts',
    'What a claim document records on the claim (Document Kinds table): a certification or ABN on file with its signed date, or a signed release for billing.',
    documentFacts()
  ),
  asWorkflow(
    'billing.receive-document',
    'Receive Document',
    'Runs when a document is uploaded to a claim: follows the claim, reads the document, records what it documents (Document Facts) on the claim, which signals the claim so its cycle looks again, and checks the claim again.',
    receiveDocument()
  ),
  asWorkflow(
    'billing.chase-document',
    'Chase Document',
    'Started from a claim: a Chase a document task names the missing document and who to ask, then a Chase document task due in the days the Document Chase Days table gives takes the upload (Add Claim Document and Receive Document), asked again until the document is on file or a biller stops.',
    chaseDocument()
  )
];
