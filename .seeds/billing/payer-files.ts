import type { GraphDef, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { graph, p } from './glossary.ts';
import {
  above,
  asRule,
  asStage,
  asWorkflow,
  type Builder,
  d,
  field,
  is,
  oneOf,
  P,
  rule,
  shared,
  summary,
  T,
  table,
  template
} from './shared.ts';

const { blob: BLOB } = T;

const textRecord = (g: Builder, id: string, label: string, fields: string[]) =>
  g.add(id, 'std.object.make', {
    label,
    config: { fields: fields.map((name) => ({ name, type: 'string' })) }
  });

const receiveNemsisFile = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('file', BLOB)],
    outputs: [p('count', 'integer'), p('runIds', { list: { id: 'run' } })]
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

const reviewPayerFileLine = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [
      p('fileName', 'string'),
      p('reference', 'string'),
      p('claimId', { id: 'claim' }, true),
      p('outcome', 'string'),
      p('message', 'string')
    ],
    outputs: []
  });
  g.add('unmatched', 'std.logic.is-null', { label: 'No Claim Matched' });
  g.add('matched', 'std.flow.branch', { label: 'Matched a Claim?' });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('subjectParts', 'std.list.make', {
    label: 'File and Claim Number',
    config: { count: 2, type: 'string' }
  });
  g.add('subject', 'std.text.join', { label: 'Task Subject', values: { separator: ' · ' } });
  textRecord(g, 'context', 'Line Context', ['claimNumber', 'outcome', 'problem', 'fileName']);
  g.add('review', 'std.human.task', {
    label: 'Review Payer File Line',
    config: {
      title: 'Review payer file line',
      queue: 'billing-reconcile',
      instructions:
        'The clearinghouse sent a line that could not be applied on its own: a claim number that matches no claim, a reversal, a pending status, or a payer that is not on the claim. Post it with a Post Payment task or correct the claim with a Correct Claim Data task, both started from Start Task on the claim (or check the claim number with the clearinghouse), then mark it resolved.',
      outcomes: ['resolved'],
      hints: {
        resolved:
          'Closes this line; it changes nothing on the claim, so post the payment or correct the claim first.'
      }
    }
  });
  g.add('problem', 'std.logic.choose', {
    label: 'Message, Else Unapplied Line',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'The clearinghouse sent a line that could not be applied on its own' }
  });
  template(g, 'numberNamed', 'No Claim Has the Number', '[no claim has the number {reference}]', {
    reference: 'entry.reference'
  });
  g.add('which', 'std.logic.choose', {
    label: 'Claim Number, Else None Named',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'it names no claim' }
  });
  template(
    g,
    'unmatchedSummary',
    'Check With the Clearinghouse',
    '{problem}; {which}, so check it with the clearinghouse and post it with a Post Payment task on the right claim',
    { problem: 'problem.value', which: 'which.value' }
  );
  template(
    g,
    'matchedSummary',
    'Post or Correct the Claim',
    '{problem}; post it with a Post Payment task or fix the claim with Correct Claim Data, then mark it resolved',
    { problem: 'problem.value' }
  );
  g.add('reviewSummary', 'std.logic.select', { label: 'Task Summary' });
  g.ret('done');
  g.wire('entry.exec', 'matched.exec');
  g.wire('entry.claimId', 'unmatched.value', 'follow.claimId');
  g.wire('unmatched.result', 'matched.condition', 'reviewSummary.condition');
  g.wire('matched.false', 'follow.exec');
  g.wire('matched.true', 'review.exec');
  g.wire('follow.then', 'review.exec');
  g.wire('entry.fileName', 'subjectParts.item1', 'context.fileName');
  g.wire('entry.reference', 'subjectParts.item2', 'context.claimNumber');
  g.wire('subjectParts.list', 'subject.items');
  g.wire('entry.outcome', 'context.outcome');
  g.wire('entry.message', 'context.problem', 'problem.option1');
  g.wire('subject.text', 'review.subject');
  g.wire('context.object', 'review.context');
  g.wire('numberNamed.text', 'which.option1');
  g.wire('unmatchedSummary.text', 'reviewSummary.whenTrue');
  g.wire('matchedSummary.text', 'reviewSummary.whenFalse');
  g.wire('reviewSummary.result', 'review.summary');
  g.wire('review.resolved', 'done.exec');
  return g.def;
};

const checkEligibility = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('claimId', { id: 'claim' }), p('force', 'boolean', true)],
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
        { name: 'claimId', type: { id: 'claim' }, from: 'claimId' },
        { name: 'outcome', type: 'string', from: 'outcome' },
        { name: 'message', type: 'string', from: 'message' }
      ]
    }
  });
  textRecord(g, 'shared', 'Same for Every Line', ['fileName']);
  g.add('spawn', 'std.flow.spawn-workflows', {
    label: 'Ask a Biller About Each Line',
    config: { workflow: 'billing.review-payer-file-line', version: 1 }
  });
  g.add('count', 'std.list.length', { label: 'Lines to Review' });
  g.ret('return');
  g.wire('entry.exec', 'send.exec');
  g.wire('entry.claimId', 'send.claimId');
  g.wire('entry.force', 'send.force');
  g.wire('send.answered', 'spawn.exec');
  g.wire('send.fileName', 'shared.fileName');
  g.wire('shared.object', 'lines.shared');
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

const DENIAL_REASONS = [
  '4',
  '5',
  '11',
  '16',
  '18',
  '22',
  '26',
  '27',
  '29',
  '31',
  '50',
  '56',
  '96',
  '109',
  '146',
  '150',
  '151',
  '181',
  '182',
  '197',
  '204'
];

const PRIOR_PAYER_REASONS = ['23'];

const PAYER_GROUPS = ['CO', 'PI', 'OA'];

const reasonRows = (reasons: string[], value: string) =>
  reasons.flatMap((reason) => PAYER_GROUPS.map((group) => ({ key: `${group}-${reason}`, value })));

const ADJUSTMENT_TYPE = (T.adjustments as { list: ValueType }).list;

const CLASSIFIED: ValueType = {
  object: { code: 'string', class: 'string', cents: 'integer' }
};

const LOWERS_BALANCE = ['contractual', 'other'];

const classifyAdjustment = (): GraphDef => {
  const g = rule(
    [
      d(
        'adjustment',
        ADJUSTMENT_TYPE,
        'Adjustment',
        'One 835 adjustment: group code, reason code and amount.'
      ),
      d(
        'deniedClaim',
        'boolean',
        'Denied Claim',
        'Whether the claim is denied, which makes every adjustment a denial.',
        true
      )
    ],
    [
      d('code', 'string', 'Group and Reason Code', 'The group and reason code, such as CO-45.'),
      d(
        'class',
        'string',
        'Class',
        'contractual, patientResponsibility, denial, priorPayer, other or unknown.'
      ),
      d(
        'classified',
        CLASSIFIED,
        'Classified Adjustment',
        'The code, class and amount of the adjustment.'
      ),
      d('reason', 'string', 'Reason', 'The code and its class, such as CO-45: contractual.')
    ]
  );
  g.add('adjustment', 'billing.adjustment.break', { label: 'Adjustment' });
  template(g, 'code', 'Group and Reason Code', '{group}-{reason}', {
    group: 'adjustment.group',
    reason: 'adjustment.reason'
  });
  g.add('byCode', 'std.table.lookup', {
    label: 'Adjustment Reasons',
    config: shared.lookup(
      'billing.adjustment-reasons',
      'Adjustment Reasons',
      'The class of an 835 adjustment by its group and reason code (CO-50), ahead of its group: a denial reason keeps the amount on the balance for a biller to work, and the prior payer (OA-23) restates what an earlier payer already paid and adjusted, so it lowers nothing again.',
      {
        type: 'string',
        rows: [
          ...reasonRows(DENIAL_REASONS, 'denial'),
          ...reasonRows(PRIOR_PAYER_REASONS, 'priorPayer')
        ],
        fallback: ''
      }
    )
  });
  g.add('byGroup', 'std.table.lookup', {
    label: 'Adjustment Classes',
    config: shared.lookup(
      'billing.adjustment-classes',
      'Adjustment Classes',
      'The class of an 835 adjustment by its group code, when Adjustment Reasons does not list its reason: contractual and other adjustments lower the balance, patient responsibility stays on it for the patient. A group 5010 does not use (CR) is unknown and goes to a biller.',
      {
        type: 'string',
        rows: [
          { key: 'CO', value: 'contractual' },
          { key: 'PI', value: 'contractual' },
          { key: 'OA', value: 'other' },
          { key: 'PR', value: 'patientResponsibility' }
        ],
        fallback: 'unknown'
      }
    )
  });
  g.add('byReason', 'std.logic.choose', {
    label: 'By Reason, Else by Group',
    config: { mode: 'first', type: 'string', count: 2 }
  });
  g.add('class', 'std.logic.choose', {
    label: 'Denied, Else by Reason',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { case1: 'denial' }
  });
  g.add('classified', 'std.object.make', {
    label: 'Classified Adjustment',
    config: {
      fields: [
        { name: 'code', type: 'string' },
        { name: 'class', type: 'string' },
        { name: 'cents', type: 'integer' }
      ]
    }
  });
  template(g, 'reason', 'Code and Class', '{code}: {class}', {
    code: 'code.text',
    class: 'class.value'
  });
  g.ret('return');
  g.wire('entry.adjustment', 'adjustment.adjustment');
  g.wire('adjustment.group', 'byGroup.key');
  g.wire('code.text', 'byCode.key', 'classified.code', 'return.code');
  g.wire('byCode.value', 'byReason.option1');
  g.wire('byGroup.value', 'byReason.option2');
  g.wire('entry.deniedClaim', 'class.key');
  g.wire('byReason.value', 'class.otherwise');
  g.wire('class.value', 'classified.class', 'return.class');
  g.wire('adjustment.cents', 'classified.cents');
  g.wire('classified.object', 'return.classified');
  g.wire('reason.text', 'return.reason');
  return g.def;
};

const classifyAdjustments = (): GraphDef => {
  const g = rule(
    [
      ADJUSTMENTS_IN,
      d(
        'denied',
        'boolean',
        'Denied',
        'Whether the payer reported the claim denied (CLP02 4).',
        true
      ),
      d('paidCents', 'integer', 'Paid (Cents)', 'What the payer paid on the claim.', true)
    ],
    [
      d(
        'classes',
        { list: 'string' },
        'Classes',
        'The class of each adjustment: contractual, patientResponsibility, denial, priorPayer, other or unknown.'
      ),
      d(
        'codes',
        { list: 'string' },
        'Group and Reason Codes',
        'The group and reason code of each adjustment, such as CO-45.'
      ),
      d(
        'adjustedCents',
        'integer',
        'Adjusted (Cents)',
        'What the contractual and other adjustments take off the balance.'
      ),
      d(
        'deniedClaim',
        'boolean',
        'Denied Claim',
        'Whether the claim is denied: reported denied, or nothing paid with a denial reason.'
      ),
      P.reasons('each adjustment lowers the balance or not')
    ]
  );
  g.add('byCode', 'std.list.map-rule', {
    label: 'Classify Each by Code',
    config: { rule: 'billing.classify-adjustment', version: 1, item: 'adjustment' }
  });
  g.add('nothingPaid', 'std.logic.condition', {
    label: 'Nothing Paid',
    config: {
      match: 'any',
      inputs: [{ name: 'paidCents', type: 'integer' }],
      rules: [
        { field: 'paidCents', op: 'empty' },
        { field: 'paidCents', op: 'is', value: 0 }
      ]
    }
  });
  g.add('unpaidDenial', 'std.logic.condition', {
    label: 'Nothing Paid With a Denial Reason',
    config: {
      inputs: [
        { name: 'nothingPaid', type: 'boolean' },
        { name: 'classes', type: { list: 'string' } }
      ],
      rules: [
        { field: 'nothingPaid', op: 'is', value: true },
        { field: 'classes', op: 'is', value: 'denial' }
      ]
    }
  });
  g.add('denied', 'std.logic.condition', {
    label: 'Denied Claim',
    config: {
      match: 'any',
      inputs: [
        { name: 'denied', type: 'boolean' },
        { name: 'unpaidDenial', type: 'boolean' }
      ],
      rules: [
        { field: 'denied', op: 'is', value: true },
        { field: 'unpaidDenial', op: 'is', value: true }
      ]
    }
  });
  g.add('each', 'std.list.map-rule', {
    label: 'Classify Each Adjustment',
    config: { rule: 'billing.classify-adjustment', version: 1, item: 'adjustment' }
  });
  g.add('lowers', 'std.list.where', {
    label: 'Lower the Balance',
    config: { field: 'class', op: 'oneOf', value: LOWERS_BALANCE }
  });
  g.add('amounts', 'std.list.pluck', { label: 'Their Amounts', values: { field: 'cents' } });
  g.add('adjusted', 'std.math.sum', { label: 'Adjustments That Lower the Balance' });
  g.ret('return');
  g.wire('entry.adjustments', 'byCode.list', 'each.list');
  g.wire('entry.paidCents', 'nothingPaid.paidCents');
  g.wire('nothingPaid.result', 'unpaidDenial.nothingPaid');
  g.wire('byCode.class', 'unpaidDenial.classes');
  g.wire('entry.denied', 'denied.denied');
  g.wire('unpaidDenial.result', 'denied.unpaidDenial');
  g.wire('denied.result', 'each.deniedClaim', 'return.deniedClaim');
  g.wire('each.class', 'return.classes');
  g.wire('each.code', 'return.codes');
  g.wire('each.classified', 'lowers.list');
  g.wire('lowers.list', 'amounts.list');
  g.wire('amounts.list', 'adjusted.values');
  g.wire('adjusted.result', 'return.adjustedCents');
  g.wire('each.reason', 'return.reasons');
  return g.def;
};

const crossoverExpected = (): GraphDef => {
  const g = rule(
    [
      d('status', 'string', 'Claim Status', 'The claim status code the payer sent (CLP02).', true),
      d(
        'remarks',
        { list: 'string' },
        'Remark Codes',
        'The remark codes (RARC) of the claim payment.',
        true
      ),
      d(
        'crossoverPayer',
        'string',
        'Crossover Payer',
        'The payer the claim was crossed over to (NM1*TT), if named.',
        true
      )
    ],
    [
      d(
        'crossover',
        'boolean',
        'Crossed Over',
        'Whether the payer forwarded the claim to the next payer itself, so the next payer is awaited instead of billed.'
      ),
      P.reasons('the claim was or was not crossed over')
    ]
  );
  g.add('named', 'std.logic.condition', {
    label: 'Crossover Payer Named',
    config: {
      inputs: [{ name: 'crossoverPayer', type: 'string' }],
      rules: [{ field: 'crossoverPayer', op: 'present' }]
    }
  });
  g.add('decide', 'std.table.decide', {
    label: 'Crossover Signals',
    config: shared.decision(
      'billing.crossover-signals',
      'Crossover Signals',
      'Decides that a payer forwarded the claim to the next payer itself (a Medicare crossover through COBA): a processed-and-forwarded status (CLP02 19, 20 or 21), a remark that the claim went to the supplemental insurer (MA18) or to more than one payer (N89), or a named crossover carrier (NM1*TT).',
      table(
        [
          field('status', 'string', 'Claim status (CLP02)'),
          field('remarks', { list: 'string' }, 'Remark codes (RARC)'),
          field('named', 'boolean', 'Crossover payer named (NM1*TT)')
        ],
        [field('crossover', 'boolean', 'Crossed over')],
        [
          {
            label: 'Processed and forwarded to another payer (CLP02 19, 20, 21)',
            when: { status: oneOf('19', '20', '21') },
            set: { crossover: true }
          },
          {
            label: 'Forwarded to the supplemental insurer (MA18) or several payers (N89)',
            when: { remarks: oneOf('MA18', 'N89') },
            set: { crossover: true }
          },
          {
            label: 'A crossover payer is named (NM1*TT)',
            when: { named: is(true) },
            set: { crossover: true }
          }
        ],
        { crossover: false }
      )
    )
  });
  g.ret('return');
  g.wire('entry.status', 'decide.status');
  g.wire('entry.remarks', 'decide.remarks');
  g.wire('entry.crossoverPayer', 'named.crossoverPayer');
  g.wire('named.result', 'decide.named');
  g.wire('decide.crossover', 'return.crossover');
  g.wire('decide.rules', 'return.reasons');
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
  g.add('matched', 'std.logic.condition', {
    label: 'Claim Matched',
    config: {
      inputs: [{ name: 'claimId', type: { id: 'claim' } }],
      rules: [{ field: 'claimId', op: 'present' }]
    }
  });
  g.add('payerOnClaim', 'std.logic.condition', {
    label: 'Payer on the Claim',
    config: {
      inputs: [{ name: 'coverageId', type: { id: 'coverage' } }],
      rules: [{ field: 'coverageId', op: 'present' }]
    }
  });
  g.add('route', 'std.table.decide', {
    label: 'Remittance Routing',
    config: shared.decision(
      'billing.remittance-routing',
      'Remittance Routing',
      'Routes each 835 claim payment by what the payer sent and its reason codes (CARC): reconcile posts it and the claim cycle has a biller reconcile the balance; denial, appeal and fix post it and the claim cycle works the denial (Work Denial); reversal posts the takeback of a payment posted on the claim (negative amounts); review leaves it to a biller without posting; unmatched names no claim. {payer} and {reference} in a message are the payer name and claim number.',
      table(
        [
          field('matched', 'boolean', 'A claim has this number'),
          field('reversal', 'boolean', 'The payer reversed an earlier payment'),
          field('reversesPosted', 'boolean', 'The reversed payment is posted on the claim'),
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
            label: 'The payer reversed a payment posted on the claim',
            when: { reversal: is(true), reversesPosted: is(true) },
            set: { route: 'reversal', message: '{payer} reversed its earlier payment' }
          },
          {
            label: 'The payer reversed a payment that is not on the claim',
            when: { reversal: is(true) },
            set: {
              route: 'review',
              message:
                'The payer reversed a payment no response on this claim has its claim number; post the takeback by hand'
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
            label: 'An adjustment group 5010 does not use',
            when: { classes: oneOf('unknown') },
            set: {
              route: 'review',
              message:
                'The remittance has an adjustment group code 5010 does not use; post it by hand'
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
  g.add('routeMessage', 'std.logic.coalesce', {
    label: 'Message, Else Nothing',
    values: { fallback: '' }
  });
  g.add('payerName', 'std.logic.coalesce', {
    label: 'Payer Name, Else The Payer',
    values: { fallback: 'The payer' }
  });
  g.add('withPayer', 'std.text.replace', {
    label: 'Message With the Payer',
    values: { find: '{payer}' }
  });
  g.add('message', 'std.text.replace', {
    label: 'Message With Names',
    values: { find: '{reference}' }
  });
  g.add('crossover', 'billing.crossover-expected', { label: 'Crossover Expected' });
  g.add('reasons', 'std.list.join', { label: 'Why', config: { count: 3, type: 'string' } });
  g.add('posting', 'billing.remittance-posting.make');
  g.ret('return');
  g.wire('entry.line', 'line.line');
  g.wire('line.adjustments', 'classify.adjustments', 'reasonCount.list');
  g.wire('line.denied', 'classify.denied');
  g.wire('line.paidCents', 'classify.paidCents');
  g.wire('classify.deniedClaim', 'route.denied');
  g.wire('line.claimId', 'matched.claimId');
  g.wire('line.coverageId', 'payerOnClaim.coverageId');
  g.wire('matched.result', 'route.matched');
  g.wire('payerOnClaim.result', 'route.payerOnClaim');
  g.wire('line.reversal', 'route.reversal');
  g.wire('line.reversesPosted', 'route.reversesPosted');
  g.wire('line.takeback', 'route.takeback');
  g.wire('reasonCount.length', 'route.reasonCount');
  g.wire('classify.codes', 'route.codes');
  g.wire('classify.classes', 'route.classes');
  g.wire('route.message', 'routeMessage.value');
  g.wire('routeMessage.result', 'withPayer.text');
  g.wire('line.payerName', 'payerName.value');
  g.wire('payerName.result', 'withPayer.replacement');
  g.wire('withPayer.result', 'message.text');
  g.wire('line.reference', 'message.replacement');
  g.wire('route.rules', 'reasons.list1');
  g.wire('classify.reasons', 'reasons.list2');
  g.wire('line.status', 'crossover.status');
  g.wire('line.remarks', 'crossover.remarks');
  g.wire('line.crossoverPayer', 'crossover.crossoverPayer');
  g.wire('crossover.reasons', 'reasons.list3');
  g.wire('crossover.crossover', 'posting.crossover');
  g.wire('line.position', 'posting.position');
  g.wire('route.route', 'posting.route');
  g.wire('message.result', 'posting.message');
  g.wire('classify.adjustedCents', 'posting.adjustedCents');
  g.wire('reasons.list', 'posting.reasons');
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
    outputs: [
      p('fileId', { id: 'payerFile' }, true),
      p('kind', 'string', true),
      p('reviews', 'integer', true)
    ]
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
        { name: 'claimId', type: { id: 'claim' }, from: 'claimId' },
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
  textRecord(g, 'shared', 'Same for Every Line', ['fileName']);
  g.add('unreadable', 'std.human.task', {
    label: 'Unreadable Clearinghouse File',
    config: {
      title: 'Unreadable clearinghouse file',
      queue: 'billing-reconcile',
      instructions:
        'The clearinghouse sent a file that is not a remittance (835), acknowledgment (TA1, 999 or 277CA), claim status (277) or eligibility (271) file. Check it with the clearinghouse; nothing was applied.',
      outcomes: ['resolved'],
      hints: { resolved: 'Closes the task; nothing from the file is applied.' }
    }
  });
  textRecord(g, 'why', 'File Context', ['fileName', 'problem']);
  g.add('unreadableFile', 'std.logic.choose', {
    label: 'File Name, Else This File',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'this file' }
  });
  g.add('reasonGiven', 'std.logic.condition', {
    label: 'Reason Given',
    config: {
      inputs: [{ name: 'reason', type: 'string' }],
      rules: [{ field: 'reason', op: 'present' }]
    }
  });
  template(
    g,
    'withReason',
    'Not Applied, With the Reason',
    'Nothing was applied from {fileName} ({reason}); check it with the clearinghouse',
    { fileName: 'unreadableFile.value', reason: 'read.reason' }
  );
  template(
    g,
    'notRead',
    'Not Applied, Not Read',
    'Nothing was applied from {fileName}, as it is not a file the app reads; check it with the clearinghouse',
    { fileName: 'unreadableFile.value' }
  );
  g.add('unreadableSummary', 'std.logic.select', { label: 'Task Summary' });
  g.add('accepted', 'std.logic.is-null', { label: 'Envelope Accepted' });
  g.add('envelope', 'std.flow.branch', { label: 'Envelope Rejected?' });
  g.add('setup', 'std.human.task', {
    label: 'Fix Clearinghouse Setup',
    config: {
      title: 'Fix clearinghouse setup',
      queue: 'billing-review',
      instructions:
        'The clearinghouse rejected the file envelope (TA1), so it read none of the claims in the file; they are back in review. This is a setup problem, not a claim problem: check the reason in the details against the billing profile (submitter and receiver IDs, test or production) and the clearinghouse connection in Settings, then mark it fixed.',
      outcomes: ['fixed'],
      hints: {
        fixed: 'Opens a review task for each line of the file that could not be applied on its own.'
      }
    }
  });
  textRecord(g, 'setupContext', 'Envelope Context', ['fileName', 'problem']);
  g.add('setupFile', 'std.logic.choose', {
    label: 'File Name, Else A File',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'a file' }
  });
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
    'setupContext.fileName',
    'setupFile.option1',
    'unreadableFile.option1'
  );
  g.wire('read.read', 'route.exec');
  g.wire('read.lines', 'route.lines');
  g.wire('route.then', 'apply.exec');
  g.wire('route.postings', 'apply.postings');
  g.wire('shared.object', 'lines.shared');
  g.wire('apply.applied', 'envelope.exec');
  g.wire('apply.envelopeRejection', 'accepted.value', 'setupContext.problem');
  g.wire('accepted.result', 'envelope.condition');
  g.wire('envelope.true', 'spawn.exec');
  g.wire('envelope.false', 'setup.exec');
  g.wire('setupContext.object', 'setup.context');
  summary(
    g,
    'setup',
    'The clearinghouse rejected the envelope of {fileName}[ ({envelopeRejection})]; fix the clearinghouse setup in Settings, then mark it fixed',
    { fileName: 'setupFile.value', envelopeRejection: 'apply.envelopeRejection' }
  );
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
  g.wire('read.reason', 'why.problem', 'reasonGiven.reason');
  g.wire('why.object', 'unreadable.context');
  g.wire('reasonGiven.result', 'unreadableSummary.condition');
  g.wire('withReason.text', 'unreadableSummary.whenTrue');
  g.wire('notRead.text', 'unreadableSummary.whenFalse');
  g.wire('unreadableSummary.result', 'unreadable.summary');
  g.wire('unreadable.resolved', 'notApplied.exec');
  return g.def;
};

export const payerFileGraphs: SeedGraph[] = [
  asRule(
    'billing.classify-adjustment',
    'Classify Adjustment',
    'Classifies one 835 adjustment by its group and reason code (Adjustment Reasons table), else its group code (Adjustment Classes table), or as a denial when the claim is denied.',
    classifyAdjustment()
  ),
  asRule(
    'billing.classify-adjustments',
    'Classify Adjustments',
    'Classifies each 835 adjustment by its group and reason code (Adjustment Reasons table), else its group code (Adjustment Classes table), as contractual, patient responsibility, denial, prior payer, other or unknown; says whether the claim is denied (CLP02 4, or nothing paid with a denial reason) and adds up what lowers the balance.',
    classifyAdjustments()
  ),
  asRule(
    'billing.crossover-expected',
    'Crossover Expected',
    'Says whether a payer forwarded the claim to the next payer itself, such as Medicare crossing it over to a Medigap or Medicaid plan (Crossover Signals table), so the next payer is awaited and followed up instead of billed again.',
    crossoverExpected()
  ),
  asRule(
    'billing.route-remittance',
    'Route Remittance',
    'Routes one 835 claim payment (Remittance Routing table): post it for a biller to reconcile, post it as a denial to work (denied, medical necessity or authorization to appeal, claim data to fix), post the reversal of a payment on the claim, leave it to a biller (reversals of payments not on the claim, takebacks, too many reason codes, an adjustment group 5010 does not use, a payer not on the claim) or report that no claim has its number; with Classify Adjustments for what lowers the balance.',
    routeRemittance()
  ),
  asStage(
    'billing.route-remittances',
    'Route Remittances',
    'Routes every claim payment of an 835 with Route Remittance, in file order.',
    routeRemittances()
  ),
  asWorkflow(
    'billing.receive-nemsis-file',
    'Receive NEMSIS File',
    'Splits a NEMSIS export and starts one Encounter to Claim run per report, without waiting for them.',
    receiveNemsisFile()
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
    "Asks the clearinghouse whether each payer on a claim covers the patient: a real-time 270 when the agency's connection supports it (its 271 is applied at once, and an inactive coverage blocks billing that payer), else a batch 270 whose 271 arrives with the payer files. A payer already answered or waiting for an answer is not asked again, and an answer from another claim of the patient with the same payer and member ID in the same month of service is reused, unless the check is forced. Asks a biller about each answer that needs one, such as a Medicare answer naming a Medicare Advantage plan. Started when Encounter to Claim saves a claim's payers, and forced from Check Eligibility on a claim.",
    checkEligibility()
  )
];
