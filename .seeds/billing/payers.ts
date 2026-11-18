import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  breakRecord,
  choiceRule,
  choicesFor,
  code,
  codes,
  codeTable,
  d,
  ENCOUNTER,
  exit,
  firstSet,
  fixed,
  ID,
  INSURANCE,
  isIn,
  joinLists,
  keepWhere,
  listOf,
  lookup,
  node,
  not,
  QUEUE,
  rule,
  stage,
  T
} from './shared.ts';

const PRIORITY = 'billingPriority';

const PRIORITIES = [
  { id: 'primary', label: 'Primary Insurance', code: '2611003' },
  { id: 'secondary', label: 'Secondary Insurance', code: '2611005' },
  { id: 'tertiary', label: 'Tertiary Insurance', code: '2611007' }
];

const INSURANCE_IN = d(
  'insurance',
  T.insurance,
  'Insurance',
  'One insurance as the report gives it.'
);

const resultOut = (description: string) => d('result', 'boolean', 'Result', description);

const hasPriority = (): GraphDef => {
  const g = rule(
    [
      INSURANCE_IN,
      d('priority', code(PRIORITY), 'Billing Priority', 'The billing priority to look for.')
    ],
    [resultOut('Whether the insurance has that billing priority.')]
  );
  breakRecord(g, 'insurance', 'Insurance', INSURANCE, 'entry.insurance');
  node(
    g,
    'same',
    'std.logic.equal',
    'Same Priority',
    { a: 'insurance.priority', b: 'entry.priority' },
    {
      type: code(PRIORITY)
    }
  );
  g.ret('return');
  g.wire('same.result', 'return.result');
  return g.def;
};

const hasOtherPriority = (): GraphDef => {
  const g = rule(
    [INSURANCE_IN],
    [resultOut('Whether the insurance is not ranked primary, secondary or tertiary.')]
  );
  breakRecord(g, 'insurance', 'Insurance', INSURANCE, 'entry.insurance');
  const ranked = isIn(
    g,
    'ranked',
    'Ranked First, Second or Third',
    PRIORITY,
    'insurance.priority',
    codes(
      g,
      'rankedCodes',
      'Primary, Secondary and Tertiary',
      PRIORITY,
      PRIORITIES.map((r) => r.code)
    )
  );
  g.ret('return');
  g.wire(not(g, 'other', 'Any Other Priority', ranked), 'return.result');
  return g.def;
};

const billingOrder = (): GraphDef => {
  const g = rule(
    [
      d('insurances', listOf(T.insurance), 'Insurances', 'The insurances as the report gives them.')
    ],
    [
      d(
        'insurances',
        listOf(T.insurance),
        'Insurances in Billing Order',
        'The primary insurance, then the secondary, then the tertiary, then any other, each in report order.'
      )
    ]
  );
  for (const r of PRIORITIES) {
    keepWhere(g, r.id, r.label, 'billing.has-priority', 'insurance', 'entry.insurances', {
      priority: fixed(r.code)
    });
  }
  keepWhere(
    g,
    'others',
    'Other Insurances',
    'billing.has-other-priority',
    'insurance',
    'entry.insurances'
  );
  g.ret('return');
  g.wire(
    joinLists(g, 'ordered', 'Primary, Then Secondary, Then Tertiary, Then Others', T.insurance, [
      ...PRIORITIES.map((r) => `${r.id}.list` as const),
      'others.list'
    ]),
    'return.insurances'
  );
  return g.def;
};

const RELATIONSHIPS = codeTable(
  'billing.insured-relationships',
  'Insured Relationships',
  'The X12 code for how the patient is related to the insured, for each NEMSIS relationship (ePayment.22). A relationship the report leaves out is self (18).',
  code('x12Relationship'),
  {
    '2622001': '18',
    '2622003': '01',
    '2622005': '19',
    '2622007': '21',
    '2622009': '40',
    '2622011': '20',
    '2622013': '53',
    '2622015': '39',
    '2622017': '21',
    '2622019': 'G8'
  },
  '18'
);

const resolveCoverage = (): GraphDef => {
  const g = stage(
    [d('insurance', T.insurance, 'Insurance', 'One insurance as the report gives it.')],
    [d('coverage', T.coverage, 'Coverage', 'The payer to bill and who holds the policy.')],
    {
      covered: exit(
        'Covered',
        'The insurance is a coverage, with a directory payer if one matched.'
      )
    },
    [{ name: 'payerId', type: ID.payer, default: null }]
  );
  breakRecord(g, 'insurance', 'Insurance', INSURANCE, 'entry.insurance');
  const name = firstSet(g, 'name', 'Insurance Name', 'string', [
    'insurance.companyName',
    'insurance.companyId',
    fixed('Unnamed insurance')
  ]);
  lookup(g, 'relationship', 'Relationship as an X12 Code', RELATIONSHIPS, 'insurance.relationship');
  g.add('find', 'payer.find', { label: 'Find Payer' });
  const options = choicesFor(
    g,
    'options',
    'Similar Payers',
    'billing.payer-choice',
    'payerId',
    'find.candidates'
  );
  g.add('match', 'std.human.task', {
    label: 'Match the Payer',
    config: {
      title: 'Match the Payer',
      queue: QUEUE,
      instructions:
        'The reported insurance is not in the payer directory by name, but some payers are close. Choose the one it is, or bill it by the reported name.',
      fields: [{ name: 'payerId', type: ID.payer, label: 'Payer', required: ['match'] }],
      outcomes: ['match', 'none'],
      hints: { match: 'Bill the payer chosen.', none: 'Bill it by the reported name.' }
    }
  });
  g.add('rememberFound', 'std.var.set', {
    label: 'Remember the Payer Found',
    config: { name: 'payerId' }
  });
  g.add('rememberChosen', 'std.var.set', {
    label: 'Remember the Payer Chosen',
    config: { name: 'payerId' }
  });
  g.add('payer', 'std.var.get', { label: 'Payer', config: { name: 'payerId' } });
  g.add('coverage', 'coverage.make', { label: 'Coverage' });
  g.wire('payer.value', 'coverage.payerId');
  g.wire(name, 'coverage.payerName', 'find.name', 'match.subject');
  g.wire('relationship.value', 'coverage.relationship');
  for (const field of ['memberId', 'groupId', 'insuredFirstName', 'insuredLastName']) {
    g.wire(`insurance.${field}`, `coverage.${field}`);
  }
  for (const id of ['found', 'matched', 'reported']) {
    g.ret(id, 'covered');
    g.wire('coverage.coverage', `${id}.coverage`);
  }
  g.wire('entry.exec', 'find.exec');
  g.wire('find.found', 'rememberFound.exec');
  g.wire('find.payerId', 'rememberFound.value');
  g.wire('rememberFound.then', 'found.exec');
  g.wire('find.similar', 'match.exec');
  g.wire(options, 'match.options');
  g.wire('match.match', 'rememberChosen.exec');
  g.wire('match.payerId', 'rememberChosen.value');
  g.wire('rememberChosen.then', 'matched.exec');
  g.wire('match.none', 'reported.exec');
  g.wire('find.notFound', 'reported.exec');
  return g.def;
};

const determinePayers = (): GraphDef => {
  const g = stage(
    [d('encounter', T.encounter, 'Encounter', 'The encounter whose insurances to bill.')],
    [
      d(
        'coverages',
        listOf(T.coverage),
        'Coverages',
        'The payers to bill, in billing order; none when the patient pays.'
      )
    ],
    { determined: exit('Determined', 'Every reported insurance is a coverage.') },
    [{ name: 'coverages', type: listOf(T.coverage), default: [] }]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  g.add('order', 'billing.billing-order', { label: 'Billing Order' });
  g.add('each', 'std.flow.for-each', { label: 'Each Insurance' });
  g.add('coverage', 'billing.resolve-coverage', { label: 'Resolve Coverage' });
  g.add('keep', 'std.var.append', { label: 'Keep the Coverage', config: { name: 'coverages' } });
  g.add('kept', 'std.var.get', { label: 'Coverages', config: { name: 'coverages' } });
  g.ret('return', 'determined');
  g.wire('trip.insurances', 'order.insurances');
  g.wire('entry.exec', 'each.exec');
  g.wire('order.insurances', 'each.list');
  g.wire('each.body', 'coverage.exec');
  g.wire('each.item', 'coverage.insurance');
  g.wire('coverage.covered', 'keep.exec');
  g.wire('coverage.coverage', 'keep.item');
  g.wire('each.completed', 'return.exec');
  g.wire('kept.value', 'return.coverages');
  return g.def;
};

export const payerGraphs: SeedGraph[] = [
  asRule(
    'billing.has-priority',
    'Has Priority',
    'Whether one insurance has the billing priority given, such as primary.',
    hasPriority()
  ),
  asRule(
    'billing.has-other-priority',
    'Has Other Priority',
    'Whether one insurance is ranked other than primary, secondary or tertiary.',
    hasOtherPriority()
  ),
  asRule(
    'billing.billing-order',
    'Billing Order',
    'The order to bill the insurances in: primary, then secondary, then tertiary, then any other, as the report ranks them. Override it for payer rules of your own, such as Medicare secondary.',
    billingOrder()
  ),
  asRule(
    'billing.payer-choice',
    'Payer Choice',
    'One directory payer with a name like the reported one, as a choice in a form.',
    choiceRule(
      {
        description: 'A directory payer with a similar name.',
        fields: { payerId: ID.payer, payerName: 'string' },
        value: 'payerId'
      },
      { template: '{payerName}', description: 'The payer as a choice in a form: its ID and name.' }
    )
  ),
  asStage(
    'billing.resolve-coverage',
    'Resolve Coverage',
    'Turns one reported insurance into a coverage: finds its payer in the directory, or has a biller choose among payers with a similar name, and codes the relationship to the insured.',
    resolveCoverage()
  ),
  asStage(
    'billing.determine-payers',
    'Determine Payers',
    'The coverages of an encounter: every reported insurance, in billing order. No insurance means the patient pays.',
    determinePayers()
  )
];
