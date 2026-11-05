import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { graph, p } from './glossary.ts';
import {
  above,
  asRule,
  asStage,
  asWorkflow,
  d,
  expr,
  field,
  is,
  oneOf,
  P,
  rule,
  shared,
  subject,
  T,
  table
} from './shared.ts';

const { blob: BLOB } = T;

const ingestNemsis = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('file', BLOB)],
    outputs: [p('count', 'integer'), p('runIds', { list: 'string' })]
  });
  g.add('split', 'nemsis.split');
  g.add('items', 'std.list.reshape', {
    label: 'One Input per Report',
    config: { fields: [{ name: 'report', type: BLOB, from: '' }] }
  });
  g.add('spawn', 'std.flow.spawn-workflows', {
    label: 'Claim Each Encounter',
    config: { workflow: 'billing.encounter-to-claim', version: 1 }
  });
  g.ret('return');
  g.wire('entry.exec', 'split.exec');
  g.wire('entry.file', 'split.file');
  g.wire('split.then', 'spawn.exec');
  g.wire('split.reports', 'items.list');
  g.wire('items.list', 'spawn.items');
  g.wire('spawn.then', 'return.exec');
  g.wire('split.count', 'return.count');
  g.wire('spawn.runIds', 'return.runIds');
  return g.def;
};

const LINE_CONTEXT = `{
  claimNumber: reference,
  outcome: outcome,
  problem: message,
  fileName: fileName
}`;

const reviewPayerFileLine = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [
      p('fileName', 'string'),
      p('reference', 'string'),
      p('claimId', 'string', true),
      p('outcome', 'string'),
      p('message', 'string')
    ],
    outputs: []
  });
  g.add('noClaim', 'std.logic.is-null', { label: 'No Claim Matched' });
  g.add('matched', 'std.flow.branch', { label: 'Matched a Claim?' });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('subject', 'std.expr', subject('fileName', 'reference'));
  g.add('context', 'std.expr', expr('Line Context', LINE_CONTEXT));
  g.add('review', 'std.human.task', {
    label: 'Review Payer File Line',
    config: {
      title: 'Review payer file line',
      queue: 'billing-reconcile',
      instructions:
        'The clearinghouse sent a line that could not be applied on its own: a claim number that matches no claim, a reversal, a pending status, or a payer that is not on the claim. Post or correct it on the claim by hand (or check the claim number with the clearinghouse), then mark it resolved.',
      outcomes: ['resolved']
    }
  });
  g.ret('done');
  g.wire('entry.exec', 'matched.exec');
  g.wire('entry.claimId', 'noClaim.value', 'follow.claimId');
  g.wire('noClaim.result', 'matched.condition');
  g.wire('matched.false', 'follow.exec');
  g.wire('matched.true', 'review.exec');
  g.wire('follow.then', 'review.exec');
  g.wire('entry.fileName', 'subject.fileName', 'context.fileName');
  g.wire('entry.reference', 'subject.reference', 'context.reference');
  g.wire('entry.outcome', 'context.outcome');
  g.wire('entry.message', 'context.message');
  g.wire('subject.result', 'review.subject');
  g.wire('context.result', 'review.context');
  g.wire('review.resolved', 'done.exec');
  return g.def;
};

const checkEligibility = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('claimId', 'string')],
    outputs: [
      p('sentAs', 'string', true),
      p('reason', 'string', true),
      p('reviews', 'integer', true)
    ]
  });
  g.add('send', 'billing.send-270', { label: 'Send 270 to Clearinghouse' });
  g.add('lines', 'std.list.reshape', {
    label: 'One Review per Line',
    config: {
      fields: [
        { name: 'fileName', type: 'string' },
        { name: 'reference', type: 'string', from: 'reference' },
        { name: 'claimId', type: 'string', from: 'claimId' },
        { name: 'outcome', type: 'string', from: 'outcome' },
        { name: 'message', type: 'string', from: 'message' }
      ]
    }
  });
  g.add('shared', 'std.expr', expr('Same for Every Line', '{ fileName: fileName }'));
  g.add('spawn', 'std.flow.spawn-workflows', {
    label: 'Ask a Biller About Each Line',
    config: { workflow: 'billing.review-payer-file-line', version: 1 }
  });
  g.add('count', 'std.list.length', { label: 'Lines to Review' });
  g.ret('return');
  g.wire('entry.exec', 'send.exec');
  g.wire('entry.claimId', 'send.claimId');
  g.wire('send.answered', 'spawn.exec');
  g.wire('send.fileName', 'shared.fileName');
  g.wire('shared.result', 'lines.shared');
  g.wire('send.reviews', 'lines.list', 'count.list');
  g.wire('lines.list', 'spawn.items');
  g.wire('spawn.then', 'return.exec');
  g.wire('send.sent', 'return.exec');
  g.wire('send.unavailable', 'return.exec');
  g.wire('send.sentAs', 'return.sentAs');
  g.wire('send.reason', 'return.reason');
  g.wire('count.length', 'return.reviews');
  return g.def;
};

const ADJUSTMENTS_IN = d(
  'adjustments',
  T.adjustments,
  'Adjustments',
  'The 835 adjustments of one claim payment: group code, reason code and amount.'
);

const classifyAdjustments = (): GraphDef => {
  const g = rule(
    [ADJUSTMENTS_IN, d('denied', 'boolean', 'Denied', 'Whether the payer denied the claim.', true)],
    [
      d(
        'classes',
        { list: 'string' },
        'Classes',
        'The class of each adjustment: contractual, patientResponsibility, denial or other.'
      ),
      d(
        'adjustedCents',
        'integer',
        'Adjusted (Cents)',
        'What the contractual and other adjustments take off the balance.'
      ),
      P.reasons('each adjustment lowers the balance or not')
    ]
  );
  g.add('groups', 'std.list.pluck', { label: 'Group Codes', values: { field: 'group' } });
  g.add('byGroup', 'std.table.lookup', {
    label: 'Adjustment Classes',
    config: shared.lookup(
      'billing.adjustment-classes',
      'Adjustment Classes',
      'The class of an 835 adjustment by its group code: contractual and other adjustments lower the balance, patient responsibility stays on it for the patient. A denied claim lowers nothing.',
      {
        type: 'string',
        rows: [
          { key: 'CO', value: 'contractual' },
          { key: 'PI', value: 'contractual' },
          { key: 'OA', value: 'other' },
          { key: 'CR', value: 'other' },
          { key: 'PR', value: 'patientResponsibility' }
        ],
        fallback: 'other'
      }
    )
  });
  g.add(
    'classes',
    'std.expr',
    expr('Denied, Else by Group', 'denied == true ? map(groups, x => "denial") : classes')
  );
  g.add(
    'adjusted',
    'std.expr',
    expr(
      'Adjustments That Lower the Balance',
      'sum(map(adjustments, (a, n) => contains(["contractual", "other"], classes[n]) ? a.cents : 0))'
    )
  );
  g.add(
    'reasons',
    'std.expr',
    expr('Why', 'map(adjustments, (a, n) => a.group + "-" + a.reason + ": " + classes[n])')
  );
  g.ret('return');
  g.wire('entry.adjustments', 'groups.list', 'adjusted.adjustments', 'reasons.adjustments');
  g.wire('groups.list', 'byGroup.keys', 'classes.groups');
  g.wire('byGroup.values', 'classes.classes');
  g.wire('entry.denied', 'classes.denied');
  g.wire('classes.result', 'adjusted.classes', 'reasons.classes', 'return.classes');
  g.wire('adjusted.result', 'return.adjustedCents');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const ADJUSTMENT_LIMIT = 99;

const routeRemittance = (): GraphDef => {
  const g = rule(
    [d('line', T.remittanceLines.list, 'Remittance Line', 'One claim payment of the 835.')],
    [d('posting', T.postings.list, 'Posting', 'How the claim payment is posted, and why.')]
  );
  g.add('line', 'billing.remittance-line.break');
  g.add('classify', 'billing.classify-adjustments', { label: 'Classify Adjustments' });
  g.add('reasonCount', 'std.list.length', { label: 'Reason Codes' });
  g.add('matched', 'std.expr', expr('Claim Matched', 'claimId != null'));
  g.add('payerOnClaim', 'std.expr', expr('Payer on the Claim', 'coverageId != null'));
  g.add(
    'codes',
    'std.expr',
    expr('Reason Codes', 'map(adjustments, a => a.group + "-" + a.reason)')
  );
  g.add('route', 'std.table.decide', {
    label: 'Remittance Routing',
    config: shared.decision(
      'billing.remittance-routing',
      'Remittance Routing',
      'Routes each 835 claim payment by what the payer sent and its reason codes (CARC): reconcile posts it and the claim cycle has a biller reconcile the balance; denial, appeal and fix post it and the claim cycle works the denial (Work Denial); review leaves it to a biller without posting; unmatched names no claim. {payer} and {reference} in a message are the payer name and claim number.',
      table(
        [
          field('matched', 'boolean', 'A claim has this number'),
          field('reversal', 'boolean', 'The payer reversed an earlier payment'),
          field('takeback', 'boolean', 'Money is taken back'),
          field('reasonCount', 'integer', 'Reason codes'),
          field('payerOnClaim', 'boolean', 'The payer is on the claim'),
          field('denied', 'boolean', 'Denied'),
          field('codes', { list: 'string' }, 'Group and reason codes (CO-45)'),
          field('classes', { list: 'string' }, 'Adjustment classes')
        ],
        [field('route', 'string', 'Route'), field('message', 'string', 'Message')],
        [
          {
            label: 'No claim has this number',
            when: { matched: is(false) },
            set: { route: 'unmatched', message: 'No claim has number {reference}' }
          },
          {
            label: 'The payer reversed an earlier payment',
            when: { reversal: is(true) },
            set: {
              route: 'review',
              message:
                'The payer reversed an earlier payment on this claim; post the takeback by hand'
            }
          },
          {
            label: 'The remittance takes money back',
            when: { takeback: is(true) },
            set: {
              route: 'review',
              message: 'The remittance takes money back on this claim; post the correction by hand'
            }
          },
          {
            label: 'More reason codes than a payment holds',
            when: { reasonCount: above(ADJUSTMENT_LIMIT) },
            set: {
              route: 'review',
              message: 'The remittance has more reason codes than a payment can hold'
            }
          },
          {
            label: 'The payer is not on the claim',
            when: { payerOnClaim: is(false) },
            set: {
              route: 'review',
              message: '{payer} is not a payer on this claim; post the payment by hand'
            }
          },
          {
            label:
              'The payer needs corrected or missing claim data (CARC 4, 11, 16, 146, 181, 182)',
            when: { codes: oneOf('CO-4', 'CO-11', 'CO-16', 'CO-146', 'CO-181', 'CO-182') },
            set: { route: 'fix', message: '{payer} needs corrected or missing claim data' }
          },
          {
            label:
              'The payer denied medical necessity or authorization (CARC 50, 56, 150, 151, 197)',
            when: { codes: oneOf('CO-50', 'CO-56', 'CO-150', 'CO-151', 'CO-197') },
            set: { route: 'appeal', message: '{payer} denied medical necessity or authorization' }
          },
          {
            label: 'The payer denied the claim',
            when: { denied: is(true) },
            set: { route: 'denial', message: 'Denied by {payer}' }
          }
        ],
        { route: 'reconcile', message: '' }
      )
    )
  });
  g.add(
    'message',
    'std.expr',
    expr(
      'Message With Names',
      'replace(replace(message ?? "", "{payer}", payerName ?? "The payer"), "{reference}", reference)'
    )
  );
  g.add('reasons', 'std.expr', expr('Why', 'concat(rules, classified)'));
  g.add('posting', 'billing.remittance-posting.make');
  g.ret('return');
  g.wire('entry.line', 'line.line');
  g.wire('line.adjustments', 'classify.adjustments', 'reasonCount.list', 'codes.adjustments');
  g.wire('line.denied', 'classify.denied', 'route.denied');
  g.wire('line.claimId', 'matched.claimId');
  g.wire('line.coverageId', 'payerOnClaim.coverageId');
  g.wire('matched.result', 'route.matched');
  g.wire('payerOnClaim.result', 'route.payerOnClaim');
  g.wire('line.reversal', 'route.reversal');
  g.wire('line.takeback', 'route.takeback');
  g.wire('reasonCount.length', 'route.reasonCount');
  g.wire('codes.result', 'route.codes');
  g.wire('classify.classes', 'route.classes');
  g.wire('route.message', 'message.message');
  g.wire('line.payerName', 'message.payerName');
  g.wire('line.reference', 'message.reference');
  g.wire('route.rules', 'reasons.rules');
  g.wire('classify.reasons', 'reasons.classified');
  g.wire('line.position', 'posting.position');
  g.wire('route.route', 'posting.route');
  g.wire('message.result', 'posting.message');
  g.wire('classify.adjustedCents', 'posting.adjustedCents');
  g.wire('reasons.result', 'posting.reasons');
  g.wire('posting.posting', 'return.posting');
  return g.def;
};

const routeRemittances = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [d('lines', T.remittanceLines, 'Remittance Lines', 'The claim payments of an 835.')],
      outputs: [d('postings', T.postings, 'Postings', 'How each claim payment is posted.')]
    },
    [{ name: 'postings', type: T.postings, default: [] }]
  );
  g.add('each', 'std.flow.for-each', { label: 'Each Claim Payment' });
  g.add('route', 'billing.route-remittance', { label: 'Route Remittance' });
  g.add('keep', 'std.var.append', { label: 'Keep the Posting', config: { name: 'postings' } });
  g.add('postings', 'std.var.get', { label: 'Postings', config: { name: 'postings' } });
  g.ret('done');
  g.wire('entry.exec', 'each.exec');
  g.wire('entry.lines', 'each.list');
  g.wire('each.body', 'keep.exec');
  g.wire('each.item', 'route.line');
  g.wire('route.posting', 'keep.item');
  g.wire('each.completed', 'done.exec');
  g.wire('postings.value', 'done.postings');
  return g.def;
};

const receivePayerFile = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('file', BLOB), p('fileName', 'string')],
    outputs: [p('fileId', 'string', true), p('kind', 'string', true), p('reviews', 'integer', true)]
  });
  g.add('read', 'billing.read-payer-file', { label: 'Read Payer File' });
  g.add('route', 'billing.route-remittances', { label: 'Route Remittances' });
  g.add('apply', 'billing.apply-payer-file', { label: 'Apply to Claims' });
  g.add('lines', 'std.list.reshape', {
    label: 'One Review per Line',
    config: {
      fields: [
        { name: 'fileName', type: 'string' },
        { name: 'reference', type: 'string', from: 'reference' },
        { name: 'claimId', type: 'string', from: 'claimId' },
        { name: 'outcome', type: 'string', from: 'outcome' },
        { name: 'message', type: 'string', from: 'message' }
      ]
    }
  });
  g.add('spawn', 'std.flow.spawn-workflows', {
    label: 'Ask a Biller About Each Line',
    config: { workflow: 'billing.review-payer-file-line', version: 1 }
  });
  g.add('count', 'std.list.length', { label: 'Lines to Review' });
  g.add('shared', 'std.expr', expr('Same for Every Line', '{ fileName: fileName }'));
  g.add('unreadable', 'std.human.task', {
    label: 'Unreadable Clearinghouse File',
    config: {
      title: 'Unreadable clearinghouse file',
      queue: 'billing-reconcile',
      instructions:
        'The clearinghouse sent a file that is not a remittance (835), acknowledgment (TA1, 999 or 277CA), claim status (277) or eligibility (271) file. Check it with the clearinghouse; nothing was applied.',
      outcomes: ['resolved']
    }
  });
  g.add('why', 'std.expr', expr('File Context', '{ fileName: fileName, problem: reason }'));
  g.add('accepted', 'std.logic.is-null', { label: 'Envelope Accepted' });
  g.add('envelope', 'std.flow.branch', { label: 'Envelope Rejected?' });
  g.add('setup', 'std.human.task', {
    label: 'Fix Clearinghouse Setup',
    config: {
      title: 'Fix clearinghouse setup',
      queue: 'billing-review',
      instructions:
        'The clearinghouse rejected the file envelope (TA1), so it read none of the claims in the file; they are back in review. This is a setup problem, not a claim problem: check the reason in the details against the billing profile (submitter and receiver IDs, test or production) and the clearinghouse connection in Settings, then mark it fixed.',
      outcomes: ['fixed']
    }
  });
  g.add(
    'setupContext',
    'std.expr',
    expr('Envelope Context', '{ fileName: fileName, problem: envelopeRejection }')
  );
  g.ret('return');
  g.ret('readBefore');
  g.ret('appliedBefore');
  g.ret('notApplied');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.file', 'read.file', 'apply.file');
  g.wire(
    'entry.fileName',
    'read.fileName',
    'apply.fileName',
    'why.fileName',
    'unreadable.subject',
    'shared.fileName',
    'setup.subject',
    'setupContext.fileName'
  );
  g.wire('read.read', 'route.exec');
  g.wire('read.lines', 'route.lines');
  g.wire('route.then', 'apply.exec');
  g.wire('route.postings', 'apply.postings');
  g.wire('shared.result', 'lines.shared');
  g.wire('apply.applied', 'envelope.exec');
  g.wire('apply.envelopeRejection', 'accepted.value', 'setupContext.envelopeRejection');
  g.wire('accepted.result', 'envelope.condition');
  g.wire('envelope.true', 'spawn.exec');
  g.wire('envelope.false', 'setup.exec');
  g.wire('setupContext.result', 'setup.context');
  g.wire('setup.fixed', 'spawn.exec');
  g.wire('apply.reviews', 'lines.list', 'count.list');
  g.wire('lines.list', 'spawn.items');
  g.wire('spawn.then', 'return.exec');
  g.wire('apply.fileId', 'return.fileId');
  g.wire('read.kind', 'return.kind', 'appliedBefore.kind');
  g.wire('count.length', 'return.reviews');
  g.wire('read.duplicate', 'readBefore.exec');
  g.wire('read.fileId', 'readBefore.fileId');
  g.wire('apply.duplicate', 'appliedBefore.exec');
  g.wire('apply.fileId', 'appliedBefore.fileId');
  g.wire('read.unreadable', 'unreadable.exec');
  g.wire('read.reason', 'why.reason');
  g.wire('why.result', 'unreadable.context');
  g.wire('unreadable.resolved', 'notApplied.exec');
  return g.def;
};

export const payerFileGraphs: SeedGraph[] = [
  asRule(
    'billing.classify-adjustments',
    'Classify Adjustments',
    'Classifies each 835 adjustment by its group code (Adjustment Classes table) as contractual, patient responsibility, denial or other, and adds up what lowers the balance.',
    classifyAdjustments()
  ),
  asRule(
    'billing.route-remittance',
    'Route Remittance',
    'Routes one 835 claim payment (Remittance Routing table): post it for a biller to reconcile, post it as a denial to work (denied, medical necessity or authorization to appeal, claim data to fix), leave it to a biller (reversals, takebacks, too many reason codes, a payer not on the claim) or report that no claim has its number; with Classify Adjustments for what lowers the balance.',
    routeRemittance()
  ),
  asStage(
    'billing.route-remittances',
    'Route Remittances',
    'Routes every claim payment of an 835 with Route Remittance, in file order.',
    routeRemittances()
  ),
  asWorkflow(
    'billing.ingest-nemsis',
    'Ingest NEMSIS File',
    'Splits a NEMSIS export and starts one Encounter to Claim run per report, without waiting for them.',
    ingestNemsis()
  ),
  asWorkflow(
    'billing.review-payer-file-line',
    'Review Payer File Line',
    'Shows a clearinghouse file line that could not be applied on its own on its claim, and asks a biller to resolve it.',
    reviewPayerFileLine()
  ),
  asWorkflow(
    'billing.receive-payer-file',
    'Receive Payer File',
    'Reads a file the clearinghouse sent (835 remittance, TA1, 999 or 277CA acknowledgment, 277 claim status, 271 eligibility), routes each 835 claim payment with Route Remittances, applies the file to its claims, asks whoever sets up the clearinghouse to fix a rejected file envelope (TA1), and asks a biller about each line that could not be applied on its own. Started for every file downloaded from the clearinghouse, and for every file uploaded on Payer Files.',
    receivePayerFile()
  ),
  asWorkflow(
    'billing.check-eligibility',
    'Check Eligibility',
    "Asks the clearinghouse whether each payer on a claim covers the patient: a real-time 270 when the agency's connection supports it (its 271 is applied at once, and an inactive coverage blocks billing that payer), else a batch 270 whose 271 arrives with the payer files. Asks a biller about each answer that needs one, such as a Medicare answer naming a Medicare Advantage plan. Started when Encounter to Claim saves a claim's payers, and from Check Eligibility on a claim.",
    checkEligibility()
  )
];
