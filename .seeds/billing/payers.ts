import type { GraphDef, Json } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  breakRecord,
  codeTable,
  d,
  ENCOUNTER,
  exit,
  firstSet,
  INSURANCE,
  joinLists,
  keepWhere,
  listOf,
  lookup,
  rule,
  stage,
  T
} from './shared.ts';

const PAYER_ID = { id: 'payer' } as const;

const PRIMARY = '2611003';
const SECONDARY = '2611005';
const TERTIARY = '2611007';

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
  const ranks = [
    ['primary', 'Primary Insurance', PRIMARY],
    ['secondary', 'Secondary Insurance', SECONDARY],
    ['tertiary', 'Tertiary Insurance', TERTIARY]
  ] as const;
  for (const [id, label, code] of ranks) {
    keepWhere(g, id, label, 'entry.insurances', { field: 'priority', op: 'is', value: code });
  }
  keepWhere(g, 'others', 'Other Insurances', 'entry.insurances', {
    field: 'priority',
    op: 'notOneOf',
    value: [PRIMARY, SECONDARY, TERTIARY]
  });
  g.ret('return');
  g.wire(
    joinLists(g, 'ordered', 'Primary, Then Secondary, Then Tertiary, Then Others', T.insurance, [
      'primary.list',
      'secondary.list',
      'tertiary.list',
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

const CANDIDATE = {
  object: { payerId: PAYER_ID, payerName: 'string', similarity: 'number' }
} as const;

const CHOICE = { object: { value: 'string', label: 'string' } } as const;

const payerChoice = (): GraphDef => {
  const g = rule(
    [d('candidate', CANDIDATE, 'Candidate', 'A directory payer with a similar name.')],
    [d('choice', CHOICE, 'Choice', 'The payer as a choice in a form: the ID and its name.')]
  );
  g.add('parts', 'std.object.break', {
    label: 'Candidate',
    config: {
      fields: [
        { name: 'payerId', type: PAYER_ID },
        { name: 'payerName', type: 'string' }
      ]
    } as Json
  });
  g.add('choice', 'std.object.make', {
    label: 'Choice',
    config: {
      fields: [
        { name: 'value', type: 'string' },
        { name: 'label', type: 'string' }
      ]
    } as Json
  });
  g.wire('entry.candidate', 'parts.object');
  g.wire('parts.payerId', 'choice.value');
  g.wire('parts.payerName', 'choice.label');
  g.ret('return');
  g.wire('choice.object', 'return.choice');
  return g.def;
};

const insuranceCoverage = (): GraphDef => {
  const g = stage(
    [d('insurance', T.insurance, 'Insurance', 'One insurance as the report gives it.')],
    [d('coverage', T.coverage, 'Coverage', 'The payer to bill and who holds the policy.')],
    {
      covered: exit(
        'Covered',
        'The insurance is a coverage, with a directory payer if one matched.'
      )
    },
    [{ name: 'payerId', type: PAYER_ID, default: null }]
  );
  breakRecord(g, 'insurance', 'Insurance', INSURANCE, 'entry.insurance');
  const name = firstSet(g, 'name', 'Insurance Name', 'string', [
    'insurance.companyName',
    'insurance.companyId',
    { value: 'Unnamed insurance' }
  ]);
  lookup(g, 'relationship', 'Relationship as an X12 Code', RELATIONSHIPS, 'insurance.relationship');
  g.add('find', 'payer.find', { label: 'Find the Payer' });
  g.add('choices', 'std.list.map-rule', {
    label: 'Choices of Similar Payers',
    config: { rule: 'billing.payer-choice', version: 1, item: 'candidate' }
  });
  g.add('options', 'std.object.make', {
    label: 'Payer Choices',
    config: { fields: [{ name: 'payerId', type: listOf(CHOICE) }] } as Json
  });
  g.add('match', 'std.human.task', {
    label: 'Match the Payer',
    config: {
      title: 'Match the Payer',
      queue: 'billing',
      instructions:
        'The reported insurance is not in the payer directory by name, but some payers are close. Choose the one it is, or bill it by the reported name.',
      fields: [{ name: 'payerId', type: PAYER_ID, label: 'Payer', required: ['match'] }],
      outcomes: ['match', 'none'],
      hints: { match: 'Bill the payer chosen.', none: 'Bill it by the reported name.' }
    } as Json
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
  g.wire(name, 'coverage.payerName');
  g.wire('relationship.value', 'coverage.relationship');
  for (const field of ['memberId', 'groupId', 'insuredFirstName', 'insuredLastName']) {
    g.wire(`insurance.${field}`, `coverage.${field}`);
  }
  for (const id of ['found', 'matched', 'reported']) g.ret(id, 'covered');
  g.wire('entry.exec', 'find.exec');
  g.wire(name, 'find.name', 'match.subject');
  g.wire('find.found', 'rememberFound.exec');
  g.wire('find.payerId', 'rememberFound.value');
  g.wire('rememberFound.then', 'found.exec');
  g.wire('find.similar', 'match.exec');
  g.wire('find.candidates', 'choices.list');
  g.wire('choices.choice', 'options.payerId');
  g.wire('options.object', 'match.options');
  g.wire('match.match', 'rememberChosen.exec');
  g.wire('match.payerId', 'rememberChosen.value');
  g.wire('rememberChosen.then', 'matched.exec');
  g.wire('match.none', 'reported.exec');
  g.wire('find.notFound', 'reported.exec');
  for (const id of ['found', 'matched', 'reported']) g.wire('coverage.coverage', `${id}.coverage`);
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
  g.add('coverage', 'billing.insurance-coverage', { label: 'Insurance Coverage' });
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
    'billing.billing-order',
    'Billing Order',
    'The order to bill the insurances in: primary, then secondary, then tertiary, then any other, as the report ranks them. Override it for payer rules of your own, such as Medicare secondary.',
    billingOrder()
  ),
  asRule(
    'billing.payer-choice',
    'Payer Choice',
    'One directory payer with a name like the reported one, as a choice in a form.',
    payerChoice()
  ),
  asStage(
    'billing.insurance-coverage',
    'Insurance Coverage',
    'Turns one reported insurance into a coverage: finds its payer in the directory, or has a biller choose among payers with a similar name, and codes the relationship to the insured.',
    insuranceCoverage()
  ),
  asStage(
    'billing.determine-payers',
    'Determine Payers',
    'The coverages of an encounter: every reported insurance, in billing order. No insurance means the patient pays.',
    determinePayers()
  )
];
