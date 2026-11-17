import type { GraphDef, Json, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { action, p } from './glossary.ts';
import {
  asRule,
  asStage,
  asWorkflow,
  CLAIM_DATA_DENIALS,
  codeSet,
  condition,
  d,
  exit,
  firstOf,
  fixed,
  flow,
  getField,
  joinText,
  keepListed,
  makeList,
  makeObject,
  orElse,
  P,
  type Port,
  reasonsOf,
  rule,
  select,
  shared,
  stage,
  summary,
  T,
  template
} from './shared.ts';

const PAYER_FILE_LINES: ValueType = {
  list: {
    object: { reference: 'string', claimId: { id: 'claim' }, outcome: 'string', message: 'string' }
  }
};

const receiveNemsisFile = (): GraphDef => {
  const g = flow(
    [p('file', T.blob)],
    [p('count', 'integer'), p('runIds', { list: { id: 'run' } })]
  );
  g.add('split', 'nemsis.split', { label: 'Split into Reports' });
  g.add('items', 'std.list.reshape', {
    label: 'One Input per Report',
    config: { fields: [{ name: 'report', type: T.blob, from: '' }] }
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
  const g = flow(
    [
      p('fileName', 'string'),
      p('reference', 'string'),
      p('claimId', { id: 'claim' }, true),
      p('outcome', 'string'),
      p('message', 'string')
    ],
    []
  );
  g.add('unmatched', 'std.logic.is-null', { label: 'No Claim Matched' });
  g.add('matched', 'std.flow.branch', { label: 'No Claim Matched?' });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  const subject = makeList(g, 'subjectParts', 'File and Claim Number', 'string', [
    'entry.fileName',
    'entry.reference'
  ]);
  const context = makeObject(g, 'context', 'Line Context', {
    claimNumber: ['string', 'entry.reference'],
    outcome: ['string', 'entry.outcome'],
    problem: ['string', 'entry.message'],
    fileName: ['string', 'entry.fileName']
  });
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
  const problem = orElse(
    g,
    'problem',
    'Message, Else Unapplied Line',
    'entry.message',
    fixed('The clearinghouse sent a line that could not be applied on its own')
  );
  const named = template(
    g,
    'numberNamed',
    'No Claim Has the Number',
    '[no claim has the number {reference}]',
    { reference: 'entry.reference' }
  );
  const unmatched = template(
    g,
    'unmatchedSummary',
    'Check with the Clearinghouse',
    '{problem}; {which}, so check it with the clearinghouse and post it with a Post Payment task on the right claim',
    {
      problem,
      which: orElse(g, 'which', 'Claim Number, Else None Named', named, fixed('it names no claim'))
    }
  );
  const matched = template(
    g,
    'matchedSummary',
    'Post or Correct the Claim',
    '{problem}; post it with a Post Payment task or fix the claim with Correct Claim Data, then mark it resolved',
    { problem }
  );
  g.ret('done');
  g.wire('entry.exec', 'matched.exec');
  g.wire('entry.claimId', 'unmatched.value', 'follow.claimId');
  g.wire('unmatched.result', 'matched.condition');
  g.wire('matched.false', 'follow.exec');
  g.wire('matched.true', 'review.exec');
  g.wire('follow.then', 'review.exec');
  g.wire(joinText(g, 'subject', 'Task Subject', ' · ', subject), 'review.subject');
  g.wire(context, 'review.context');
  g.wire(
    select(g, 'reviewSummary', 'Task Summary', 'unmatched.result', unmatched, matched),
    'review.summary'
  );
  g.wire('review.resolved', 'done.exec');
  return g.def;
};

const reviewEachLine = (): GraphDef => {
  const g = action(
    [
      p('fileName', 'string'),
      d(
        'lines',
        PAYER_FILE_LINES,
        'Lines to Review',
        'The lines of the file that could not be applied on their own.',
        true
      )
    ],
    []
  );
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
  g.ret('done', 'then');
  g.wire('entry.exec', 'spawn.exec');
  g.wire(
    makeObject(g, 'shared', 'Same for Every Line', { fileName: ['string', 'entry.fileName'] }),
    'lines.shared'
  );
  g.wire('entry.lines', 'lines.list');
  g.wire('lines.list', 'spawn.items');
  g.wire('spawn.then', 'done.exec');
  return g.def;
};

const checkEligibility = (): GraphDef => {
  const g = flow(
    [p('claimId', { id: 'claim' }), p('force', 'boolean', true)],
    [p('sentAs', 'string', true), p('reason', 'string', true), p('reviews', 'integer', true)]
  );
  g.add('send', 'billing.send-270', { label: 'Send 270 to Clearinghouse' });
  g.add('review', 'billing.review-payer-file-lines', { label: 'Ask a Biller About Each Line' });
  g.add('count', 'std.list.length', { label: 'Lines to Review' });
  g.ret('return');
  g.wire('entry.exec', 'send.exec');
  g.wire('entry.claimId', 'send.claimId');
  g.wire('entry.force', 'send.force');
  g.wire('send.answered', 'review.exec');
  g.wire('send.fileName', 'review.fileName');
  g.wire('send.reviews', 'review.lines', 'count.list');
  g.wire('review.then', 'return.exec');
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
  object: { code: 'string', class: 'string', cents: 'integer', lowersBalance: 'boolean' }
};

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
        'The code, class and amount of the adjustment, and whether it lowers the balance.'
      ),
      d('reason', 'string', 'Reason', 'The code and its class, such as CO-45: contractual.')
    ]
  );
  g.add('adjustment', 'billing.adjustment.break', { label: 'Adjustment' });
  const code = template(g, 'code', 'Group and Reason Code', '{group}-{reason}', {
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
  orElse(g, 'byReason', 'By Reason, Else by Group', 'byCode.value', 'byGroup.value');
  g.add('class', 'std.logic.choose', {
    label: 'Denied, Else by Reason',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { case1: 'denial' }
  });
  g.add('lowers', 'std.table.lookup', {
    label: 'Lowers the Balance',
    config: shared.lookup(
      'billing.balance-lowering-classes',
      'Classes That Lower the Balance',
      'Whether an adjustment of a class comes off the balance: contractual and other adjustments do; patient responsibility, denials and what a prior payer adjusted stay on it.',
      {
        type: 'boolean',
        rows: [
          { key: 'contractual', value: true },
          { key: 'other', value: true }
        ],
        fallback: false
      }
    )
  });
  const classified = makeObject(g, 'classified', 'Classified Adjustment', {
    code: ['string', code],
    class: ['string', 'class.value'],
    cents: ['integer', 'adjustment.cents'],
    lowersBalance: ['boolean', 'lowers.value']
  });
  g.ret('return');
  g.wire('entry.adjustment', 'adjustment.adjustment');
  g.wire('adjustment.group', 'byGroup.key');
  g.wire(code, 'byCode.key', 'return.code');
  g.wire('entry.deniedClaim', 'class.key');
  g.wire('byReason.value', 'class.otherwise');
  g.wire('class.value', 'lowers.key', 'return.class');
  g.wire(classified, 'return.classified');
  g.wire(
    template(g, 'reason', 'Code and Class', '{code}: {class}', { code, class: 'class.value' }),
    'return.reason'
  );
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
        'What the adjustments that lower the balance take off it.'
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
  const nothingPaid = condition(
    g,
    'nothingPaid',
    'Nothing Paid',
    { paidCents: ['integer', 'entry.paidCents'] },
    [
      { field: 'paidCents', op: 'empty' },
      { field: 'paidCents', op: 'is', value: 0 }
    ],
    'any'
  );
  const unpaidDenial = condition(
    g,
    'unpaidDenial',
    'Nothing Paid with a Denial Reason',
    { nothingPaid: ['boolean', nothingPaid], classes: [{ list: 'string' }, 'byCode.class'] },
    [
      { field: 'nothingPaid', op: 'is', value: true },
      { field: 'classes', op: 'is', value: 'denial' }
    ]
  );
  const denied = condition(
    g,
    'denied',
    'Denied Claim',
    { denied: ['boolean', 'entry.denied'], unpaidDenial: ['boolean', unpaidDenial] },
    [
      { field: 'denied', op: 'is', value: true },
      { field: 'unpaidDenial', op: 'is', value: true }
    ],
    'any'
  );
  g.add('each', 'std.list.map-rule', {
    label: 'Classify Each Adjustment',
    config: { rule: 'billing.classify-adjustment', version: 1, item: 'adjustment' }
  });
  g.add('lowers', 'std.list.where', {
    label: 'Lower the Balance',
    config: { field: 'lowersBalance', op: 'is', value: true }
  });
  g.add('amounts', 'std.list.pluck', { label: 'Their Amounts', values: { field: 'cents' } });
  g.add('adjusted', 'std.math.sum', { label: 'Adjustments That Lower the Balance' });
  g.ret('return');
  g.wire('entry.adjustments', 'byCode.list', 'each.list');
  g.wire(denied, 'each.deniedClaim', 'return.deniedClaim');
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
  const named = condition(
    g,
    'named',
    'Crossover Payer Named',
    { crossoverPayer: ['string', 'entry.crossoverPayer'] },
    [{ field: 'crossoverPayer', op: 'present' }]
  );
  const forwarded = condition(
    g,
    'forwarded',
    'Processed and Forwarded',
    { status: ['string', 'entry.status'] },
    [{ field: 'status', op: 'oneOf', value: ['19', '20', '21'] }]
  );
  const remarked = condition(
    g,
    'remarked',
    'Forwarded by Remark',
    { remarks: [{ list: 'string' }, 'entry.remarks'] },
    [{ field: 'remarks', op: 'oneOf', value: ['MA18', 'N89'] }]
  );
  const crossover = condition(
    g,
    'crossover',
    'Any Crossover Signal',
    {
      forwarded: ['boolean', forwarded],
      remarked: ['boolean', remarked],
      named: ['boolean', named]
    },
    ['forwarded', 'remarked', 'named'].map((field) => ({ field, op: 'is', value: true })),
    'any'
  );
  g.ret('return');
  g.wire(crossover, 'return.crossover');
  g.wire(
    reasonsOf(g, 'reasons', 'Why', [
      {
        id: 'forwardedWhy',
        label: 'Processed and Forwarded',
        when: forwarded,
        reason: 'Processed and forwarded to another payer (CLP02 19, 20, 21)'
      },
      {
        id: 'remarkedWhy',
        label: 'Forwarded by Remark',
        when: remarked,
        reason: 'Forwarded to the supplemental insurer (MA18) or several payers (N89)'
      },
      {
        id: 'namedWhy',
        label: 'Crossover Payer Named',
        when: named,
        reason: 'A crossover payer is named (NM1*TT)'
      }
    ]),
    'return.reasons'
  );
  return g.def;
};

const ADJUSTMENT_LIMIT = 99;

const ROUTED: ValueType = { object: { route: 'string', message: 'string' } };

const MEDICAL_NECESSITY_DENIALS: Record<string, string> = {
  'CO-50': 'Non-covered services because this is not deemed a medical necessity by the payer',
  'CO-56': 'Procedure or treatment has not been deemed proven to be effective by the payer',
  'CO-150': 'Payer deems the information submitted does not support this level of service',
  'CO-151': 'Payer deems the information submitted does not support this many services',
  'CO-197': 'Precertification, authorization or notification absent'
};

const routeRemittance = (): GraphDef => {
  const g = rule(
    [d('line', T.remittanceLines.list, 'Remittance Line', 'One claim payment of the 835.')],
    [d('posting', T.postings.list, 'Posting', 'How the claim payment is posted, and why.')]
  );
  g.add('line', 'billing.remittance-line.break', { label: 'Remittance Line' });
  g.add('classify', 'billing.classify-adjustments', { label: 'Classify Adjustments' });
  g.add('reasonCount', 'std.list.length', { label: 'Reason Codes' });
  const denialCodes = (id: string, label: string, codes: Json) =>
    condition(
      g,
      `${id}Found`,
      label,
      { codes: [{ list: 'string' }, keepListed(g, id, `${label} Codes`, codes, 'classify.codes')] },
      [{ field: 'codes', op: 'present' }]
    );
  const routes = [
    {
      id: 'noClaim',
      label: 'Unmatched',
      reason: 'No claim has this number',
      when: condition(
        g,
        'noClaim',
        'No Claim Matched',
        { claimId: [{ id: 'claim' }, 'line.claimId'] },
        [{ field: 'claimId', op: 'empty' }]
      ),
      route: 'unmatched',
      message: 'No claim has number {reference}'
    },
    {
      id: 'reversedPosted',
      label: 'Reversal',
      reason: 'The payer reversed a payment posted on the claim',
      when: condition(
        g,
        'reversedPosted',
        'Reverses a Posted Payment',
        {
          reversal: ['boolean', 'line.reversal'],
          reversesPosted: ['boolean', 'line.reversesPosted']
        },
        [
          { field: 'reversal', op: 'is', value: true },
          { field: 'reversesPosted', op: 'is', value: true }
        ]
      ),
      route: 'reversal',
      message: '{payer} reversed its earlier payment'
    },
    {
      id: 'reversedUnposted',
      label: 'Review the Reversal',
      reason: 'The payer reversed a payment that is not on the claim',
      when: condition(
        g,
        'reversedUnposted',
        'Reverses a Payment Not Posted',
        {
          reversal: ['boolean', 'line.reversal'],
          reversesPosted: ['boolean', 'line.reversesPosted']
        },
        [
          { field: 'reversal', op: 'is', value: true },
          { field: 'reversesPosted', op: 'isNot', value: true }
        ]
      ),
      route: 'review',
      message:
        'The payer reversed a payment no response on this claim has its claim number; post the takeback by hand'
    },
    {
      id: 'takeback',
      label: 'Review the Takeback',
      reason: 'The remittance takes money back',
      when: condition(
        g,
        'takeback',
        'Takes Money Back',
        { takeback: ['boolean', 'line.takeback'] },
        [{ field: 'takeback', op: 'is', value: true }]
      ),
      route: 'review',
      message: 'The remittance takes money back on this claim; post the correction by hand'
    },
    {
      id: 'tooManyCodes',
      label: 'Review the Reason Codes',
      reason: 'More reason codes than a payment holds',
      when: condition(
        g,
        'tooManyCodes',
        'More Reason Codes Than a Payment Holds',
        { reasonCount: ['integer', 'reasonCount.length'] },
        [{ field: 'reasonCount', op: 'gt', value: ADJUSTMENT_LIMIT }]
      ),
      route: 'review',
      message: 'The remittance has more reason codes than a payment can hold'
    },
    {
      id: 'unknownGroup',
      label: 'Review the Group Code',
      reason: 'An adjustment group 5010 does not use',
      when: condition(
        g,
        'unknownGroup',
        'Adjustment Group 5010 Does Not Use',
        { classes: [{ list: 'string' }, 'classify.classes'] },
        [{ field: 'classes', op: 'is', value: 'unknown' }]
      ),
      route: 'review',
      message: 'The remittance has an adjustment group code 5010 does not use; post it by hand'
    },
    {
      id: 'notOnClaim',
      label: 'Review the Payer',
      reason: 'The payer is not on the claim',
      when: condition(
        g,
        'notOnClaim',
        'Payer Not on the Claim',
        { coverageId: [{ id: 'coverage' }, 'line.coverageId'] },
        [{ field: 'coverageId', op: 'empty' }]
      ),
      route: 'review',
      message: '{payer} is not a payer on this claim; post the payment by hand'
    },
    {
      id: 'claimData',
      label: 'Fix the Claim Data',
      reason: 'The payer needs corrected or missing claim data',
      when: denialCodes('claimData', 'Claim Data Denial', CLAIM_DATA_DENIALS),
      route: 'fix',
      message: '{payer} needs corrected or missing claim data'
    },
    {
      id: 'necessity',
      label: 'Appeal the Denial',
      reason: 'The payer denied medical necessity or authorization',
      when: denialCodes(
        'necessity',
        'Medical Necessity Denial',
        codeSet(
          'billing.medical-necessity-denials',
          'Medical Necessity Denials',
          'The group and reason codes (CARC) that mean the payer denied medical necessity or authorization, so Route Remittance sends the denial to be appealed.',
          MEDICAL_NECESSITY_DENIALS
        )
      ),
      route: 'appeal',
      message: '{payer} denied medical necessity or authorization'
    },
    {
      id: 'denied',
      label: 'Work the Denial',
      reason: 'The payer denied the claim',
      when: 'classify.deniedClaim' as Port,
      route: 'denial',
      message: 'Denied by {payer}'
    }
  ];
  const routed = firstOf(
    g,
    'routed',
    'Route and Message',
    ROUTED,
    routes.map((r) => ({
      id: `${r.id}Route`,
      label: r.label,
      when: r.when,
      value: fixed({ route: r.route, message: r.message })
    })),
    fixed({ route: 'reconcile', message: '' })
  );
  const route = getField(g, 'route', 'Route', ROUTED, 'route', routed);
  const pattern = getField(g, 'pattern', 'Message Pattern', ROUTED, 'message', routed);
  g.add('payerName', 'std.logic.coalesce', {
    label: 'Payer Name, Else the Payer',
    values: { fallback: 'The payer' }
  });
  g.add('message', 'std.text.fill', { label: 'Message with the Payer and Claim Number' });
  g.add('crossover', 'billing.crossover-expected', { label: 'Crossover Expected' });
  g.add('reasons', 'std.list.join', { label: 'Why', config: { count: 3, type: 'string' } });
  g.add('posting', 'billing.remittance-posting.make', { label: 'Posting' });
  g.ret('return');
  g.wire('entry.line', 'line.line');
  g.wire('line.adjustments', 'classify.adjustments', 'reasonCount.list');
  g.wire('line.denied', 'classify.denied');
  g.wire('line.paidCents', 'classify.paidCents');
  g.wire('line.payerName', 'payerName.value');
  g.wire(pattern, 'message.pattern');
  g.wire(
    makeObject(g, 'values', 'Payer and Claim Number', {
      payer: ['string', 'payerName.result'],
      reference: ['string', 'line.reference']
    }),
    'message.values'
  );
  g.wire(
    reasonsOf(
      g,
      'routeWhy',
      'Why This Route',
      routes.map((r) => ({ id: `${r.id}Why`, label: r.label, when: r.when, reason: r.reason }))
    ),
    'reasons.list1'
  );
  g.wire('classify.reasons', 'reasons.list2');
  g.wire('line.status', 'crossover.status');
  g.wire('line.remarks', 'crossover.remarks');
  g.wire('line.crossoverPayer', 'crossover.crossoverPayer');
  g.wire('crossover.reasons', 'reasons.list3');
  g.wire('crossover.crossover', 'posting.crossover');
  g.wire('line.position', 'posting.position');
  g.wire(route, 'posting.route');
  g.wire('message.text', 'posting.message');
  g.wire('classify.adjustedCents', 'posting.adjustedCents');
  g.wire('reasons.list', 'posting.reasons');
  g.wire('posting.posting', 'return.posting');
  return g.def;
};

const routeRemittances = (): GraphDef => {
  const g = action(
    [d('lines', T.remittanceLines, 'Remittance Lines', 'The claim payments of an 835.')],
    [d('postings', T.postings, 'Postings', 'How each claim payment is posted.')],
    ['then'],
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

const checkUnreadableFile = (): GraphDef => {
  const g = stage(
    [
      p('fileName', 'string'),
      d('reason', 'string', 'Reason', 'Why the file could not be read, when known.', true)
    ],
    [],
    {
      resolved: exit('Resolved', 'A biller checked the file with the clearinghouse.')
    }
  );
  const fileName = orElse(
    g,
    'unreadableFile',
    'File Name, Else This File',
    'entry.fileName',
    fixed('this file')
  );
  const reasonGiven = condition(
    g,
    'reasonGiven',
    'Reason Given',
    { reason: ['string', 'entry.reason'] },
    [{ field: 'reason', op: 'present' }]
  );
  const withReason = template(
    g,
    'withReason',
    'Not Applied, with the Reason',
    'Nothing was applied from {fileName} ({reason}); check it with the clearinghouse',
    { fileName, reason: 'entry.reason' }
  );
  const notRead = template(
    g,
    'notRead',
    'Not Applied, Not Read',
    'Nothing was applied from {fileName}, as it is not a file the app reads; check it with the clearinghouse',
    { fileName }
  );
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
  g.ret('done', 'resolved');
  g.wire('entry.exec', 'unreadable.exec');
  g.wire('entry.fileName', 'unreadable.subject');
  g.wire(
    makeObject(g, 'why', 'File Context', {
      fileName: ['string', 'entry.fileName'],
      problem: ['string', 'entry.reason']
    }),
    'unreadable.context'
  );
  g.wire(
    select(g, 'unreadableSummary', 'Task Summary', reasonGiven, withReason, notRead),
    'unreadable.summary'
  );
  g.wire('unreadable.resolved', 'done.exec');
  return g.def;
};

const fixClearinghouseSetup = (): GraphDef => {
  const g = stage(
    [
      p('fileName', 'string'),
      d(
        'rejection',
        'string',
        'Envelope Rejection',
        'Why the clearinghouse rejected the file envelope (TA1).',
        true
      )
    ],
    [],
    { fixed: exit('Fixed', 'The clearinghouse setup was fixed.') }
  );
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
  g.ret('done', 'fixed');
  g.wire('entry.exec', 'setup.exec');
  g.wire('entry.fileName', 'setup.subject');
  g.wire(
    makeObject(g, 'setupContext', 'Envelope Context', {
      fileName: ['string', 'entry.fileName'],
      problem: ['string', 'entry.rejection']
    }),
    'setup.context'
  );
  summary(
    g,
    'setup',
    'The clearinghouse rejected the envelope of {fileName}[ ({envelopeRejection})]; fix the clearinghouse setup in Settings, then mark it fixed',
    {
      fileName: orElse(g, 'setupFile', 'File Name, Else a File', 'entry.fileName', fixed('a file')),
      envelopeRejection: 'entry.rejection'
    }
  );
  g.wire('setup.fixed', 'done.exec');
  return g.def;
};

const receivePayerFile = (): GraphDef => {
  const g = flow(
    [p('file', T.blob), p('fileName', 'string')],
    [
      p('fileId', { id: 'payerFile' }, true),
      p('kind', 'string', true),
      p('reviews', 'integer', true)
    ]
  );
  g.add('read', 'billing.read-payer-file', { label: 'Read Payer File' });
  g.add('route', 'billing.route-remittances', { label: 'Route Remittances' });
  g.add('apply', 'billing.apply-payer-file', { label: 'Apply to Claims' });
  g.add('accepted', 'std.logic.is-null', { label: 'Envelope Accepted' });
  g.add('envelope', 'std.flow.branch', { label: 'Envelope Accepted?' });
  g.add('setup', 'billing.fix-clearinghouse-setup', { label: 'Fix Clearinghouse Setup' });
  g.add('review', 'billing.review-payer-file-lines', { label: 'Ask a Biller About Each Line' });
  g.add('count', 'std.list.length', { label: 'Lines to Review' });
  g.add('unreadable', 'billing.check-unreadable-file', { label: 'Check Unreadable File' });
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
    'setup.fileName',
    'review.fileName',
    'unreadable.fileName'
  );
  g.wire('read.read', 'route.exec');
  g.wire('read.lines', 'route.lines');
  g.wire('route.then', 'apply.exec');
  g.wire('route.postings', 'apply.postings');
  g.wire('apply.applied', 'envelope.exec');
  g.wire('apply.envelopeRejection', 'accepted.value', 'setup.rejection');
  g.wire('accepted.result', 'envelope.condition');
  g.wire('envelope.true', 'review.exec');
  g.wire('envelope.false', 'setup.exec');
  g.wire('setup.fixed', 'review.exec');
  g.wire('apply.reviews', 'review.lines', 'count.list');
  g.wire('review.then', 'return.exec');
  g.wire('apply.fileId', 'return.fileId');
  g.wire('read.kind', 'return.kind', 'appliedBefore.kind');
  g.wire('count.length', 'return.reviews');
  g.wire('read.duplicate', 'readBefore.exec');
  g.wire('read.fileId', 'readBefore.fileId');
  g.wire('apply.duplicate', 'appliedBefore.exec');
  g.wire('apply.fileId', 'appliedBefore.fileId');
  g.wire('read.unreadable', 'unreadable.exec');
  g.wire('read.reason', 'unreadable.reason');
  g.wire('unreadable.resolved', 'notApplied.exec');
  return g.def;
};

export const payerFileGraphs: SeedGraph[] = [
  asRule(
    'billing.classify-adjustment',
    'Classify Adjustment',
    'Classifies one 835 adjustment by its group and reason code (Adjustment Reasons table), else its group code (Adjustment Classes table), or as a denial when the claim is denied, and says whether it lowers the balance (Classes That Lower the Balance table).',
    classifyAdjustment()
  ),
  asRule(
    'billing.classify-adjustments',
    'Classify Adjustments',
    'Runs Classify Adjustment on each 835 adjustment of a claim payment, says whether the claim is denied (CLP02 4, or nothing paid with a denial reason) and adds up what lowers the balance.',
    classifyAdjustments()
  ),
  asRule(
    'billing.crossover-expected',
    'Crossover Expected',
    'Says whether a payer forwarded the claim to the next payer itself, such as Medicare crossing it over to a Medigap or Medicaid plan: a processed-and-forwarded status (CLP02 19, 20 or 21), a remark that it went to the supplemental insurer (MA18) or several payers (N89), or a named crossover carrier (NM1*TT), so the next payer is awaited and followed up instead of billed again.',
    crossoverExpected()
  ),
  asRule(
    'billing.route-remittance',
    'Route Remittance',
    'Routes one 835 claim payment by the first route that holds: report that no claim has its number, post the reversal of a payment on the claim, leave it to a biller (reversals of payments not on the claim, takebacks, too many reason codes, an adjustment group 5010 does not use, a payer not on the claim), send the denial to be fixed (Claim Data Denials table) or appealed (Medical Necessity Denials table) or worked as a denial, else post it for a biller to reconcile; with Classify Adjustments for what lowers the balance.',
    routeRemittance()
  ),
  asStage(
    'billing.route-remittances',
    'Route Remittances',
    'Routes every claim payment of an 835 with Route Remittance, in file order.',
    routeRemittances()
  ),
  asStage(
    'billing.review-payer-file-lines',
    'Review Each Payer File Line',
    'Starts a Review Payer File Line run for each line of a clearinghouse file that could not be applied on its own, without waiting for them.',
    reviewEachLine()
  ),
  asStage(
    'billing.check-unreadable-file',
    'Check Unreadable File',
    'Asks a biller to check a clearinghouse file the app could not read with the clearinghouse; nothing from it is applied.',
    checkUnreadableFile()
  ),
  asStage(
    'billing.fix-clearinghouse-setup',
    'Fix Clearinghouse Setup',
    'Asks whoever sets up the clearinghouse to fix the setup after it rejected a file envelope (TA1), so none of the claims in the file were read.',
    fixClearinghouseSetup()
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
    'Reads a file the clearinghouse sent (835 remittance, TA1, 999 or 277CA acknowledgment, 277 claim status, 271 eligibility), routes each 835 claim payment with Route Remittances, applies the file to its claims, has the clearinghouse setup fixed when it rejected the file envelope (TA1), and asks a biller about each line that could not be applied on its own. Started for every file downloaded from the clearinghouse, and for every file uploaded on Payer Files.',
    receivePayerFile()
  ),
  asWorkflow(
    'billing.check-eligibility',
    'Check Eligibility',
    "Asks the clearinghouse whether each payer on a claim covers the patient: a real-time 270 when the agency's connection supports it (its 271 is applied at once, and an inactive coverage blocks billing that payer), else a batch 270 whose 271 arrives with the payer files. A payer already answered or waiting for an answer is not asked again, and an answer from another claim of the patient with the same payer and member ID in the same month of service is reused, unless the check is forced. Asks a biller about each answer that needs one, such as a Medicare answer naming a Medicare Advantage plan. Started when Encounter to Claim saves a claim's payers, and forced from Check Eligibility on a claim.",
    checkEligibility()
  )
];
