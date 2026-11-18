import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
  anyOf,
  asRule,
  asStage,
  breakRecord,
  CODE,
  type Criterion,
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
  greaterThan,
  ID,
  INSURANCE,
  isCode,
  isIn,
  isMissing,
  isZero,
  joinLists,
  keepWhere,
  listOf,
  lookup,
  node,
  not,
  PAYMENT,
  QUEUE,
  reasonsOf,
  rule,
  stage,
  startsWith,
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

const PAYER_TYPE = 'payerType';

const PRIMARY_TO_MEDICARE = ['WC', 'AM', 'LM'];

const MEDICARE_TYPES = ['MA', 'MB', '16'];

const PAYMENT_METHOD = 'paymentMethod';

const INSURER_METHODS = ['2601001', '2601003', '2601005', '2601009', '2601013'];

const MEDICARE_METHOD = '2601005';

const WORK_RELATED = '9922005';

const primaryToMedicare = (): GraphDef => {
  const g = rule(
    [INSURANCE_IN],
    [
      resultOut(
        "Whether the insurance is workers' compensation, automobile medical or liability, which pay before Medicare."
      )
    ]
  );
  breakRecord(g, 'insurance', 'Insurance', INSURANCE, 'entry.insurance');
  g.ret('return');
  g.wire(
    isIn(
      g,
      'primary',
      'Pays Before Medicare',
      PAYER_TYPE,
      'insurance.payerType',
      codes(
        g,
        'primaryTypes',
        "Workers' Compensation, Automobile Medical and Liability",
        PAYER_TYPE,
        PRIMARY_TO_MEDICARE
      )
    ),
    'return.result'
  );
  return g.def;
};

const transportAccidentCause = (): GraphDef => {
  const g = rule(
    [d('cause', code('icd10'), 'Cause of Injury', 'One cause of injury, as an ICD-10 code.')],
    [resultOut('Whether the cause is a transport accident, ICD-10 V00 to V99.')]
  );
  g.ret('return');
  g.wire(startsWith(g, 'transport', 'Transport Accident', 'entry.cause', 'V'), 'return.result');
  return g.def;
};

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
        "Workers' compensation, automobile medical and liability payers first, as they pay before Medicare; then the primary insurance, the secondary, the tertiary and any other, each in report order and each once."
      )
    ]
  );
  keepWhere(
    g,
    'beforeMedicare',
    'Payers Before Medicare',
    'billing.primary-to-medicare',
    'insurance',
    'entry.insurances'
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
  const ordered = joinLists(
    g,
    'ordered',
    'Before Medicare, Then Primary, Secondary, Tertiary and Others',
    T.insurance,
    ['beforeMedicare.list', ...PRIORITIES.map((r) => `${r.id}.list` as const), 'others.list']
  );
  node(g, 'once', 'std.list.unique', 'Each Once', { list: ordered }, { type: T.insurance });
  g.ret('return');
  g.wire('once.list', 'return.insurances');
  return g.def;
};

const payerChecks = (): GraphDef => {
  const g = rule(
    [
      d('encounter', T.encounter, 'Encounter', 'The encounter whose insurances are billed.'),
      d('classification', CODE.classification, 'Classification', 'What kind of trip it was.'),
      d(
        'insurances',
        listOf(T.insurance),
        'Insurances in Billing Order',
        'The insurances to bill, in billing order.'
      )
    ],
    [
      d(
        'reasons',
        listOf('string'),
        'Reasons',
        'What a biller should confirm about the payers before the claim goes out.'
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  keepWhere(
    g,
    'accidents',
    'Transport Accident Causes',
    'billing.transport-accident-cause',
    'cause',
    'trip.injuryCauses'
  );
  const injury = anyOf(g, 'injury', 'Work Injury or Transport Accident', [
    isCode(g, 'work', 'Work Related', 'yesNoUnknown', 'trip.workRelated', WORK_RELATED),
    greaterThan(g, 'accident', 'Transport Accident', 'integer', 'accidents.count', 0)
  ]);
  node(
    g,
    'first',
    'std.list.first',
    'First Insurance',
    { list: 'entry.insurances' },
    {
      type: T.insurance
    }
  );
  breakRecord(g, 'billedFirst', 'Insurance Billed First', INSURANCE, 'first.item');
  node(
    g,
    'count',
    'std.list.length',
    'Insurances Reported',
    { list: 'entry.insurances' },
    {
      type: T.insurance
    }
  );
  const noInsurance = isZero(g, 'noInsurance', 'No Insurance Reported', 'count.length');
  const medicareFirst = anyOf(g, 'medicareFirst', 'Medicare Billed First', [
    isIn(
      g,
      'medicareType',
      'Medicare Payer Type',
      PAYER_TYPE,
      'billedFirst.payerType',
      codes(g, 'medicareTypes', 'Medicare Payer Types', PAYER_TYPE, MEDICARE_TYPES)
    ),
    allOf(g, 'medicareMethod', 'Medicare Pays an Insurance With No Payer Type', [
      isMissing(g, 'noPayerType', 'No Payer Type', 'billedFirst.payerType'),
      not(g, 'someInsurance', 'Some Insurance Reported', noInsurance),
      isCode(g, 'medicarePays', 'Medicare Pays', PAYMENT_METHOD, 'payment.method', MEDICARE_METHOD)
    ])
  ]);
  const criteria: Criterion[] = [
    {
      id: 'secondaryPayer',
      label: 'Medicare First on a Work Injury or Transport Accident',
      reason:
        'Medicare is billed first on a work injury or transport accident: confirm with the Medicare Secondary Payer questionnaire who pays first',
      holds: allOf(g, 'secondaryPayer', 'Medicare First on a Work Injury or Transport Accident', [
        injury,
        medicareFirst
      ])
    },
    {
      id: 'noTransportMedicare',
      label: 'Medicare First Without Transport',
      reason:
        'Medicare is billed first for treatment without transport (A0998), which Medicare does not pay: bill the patient or another payer, or expect a denial',
      holds: allOf(g, 'noTransportMedicare', 'Medicare First Without Transport', [
        isCode(
          g,
          'noTransport',
          'Treated Without Transport',
          'tripClassification',
          'entry.classification',
          'treatNoTransport'
        ),
        medicareFirst
      ])
    },
    {
      id: 'missingCoverage',
      label: 'Insurer Named, but No Insurance Reported',
      reason:
        'The payment method names an insurer, but the report gives no insurance: find the coverage before billing the patient',
      holds: allOf(g, 'missingCoverage', 'Insurer Named, but No Insurance Reported', [
        isIn(
          g,
          'insurerMethod',
          'Paid by an Insurer',
          PAYMENT_METHOD,
          'payment.method',
          codes(g, 'insurerMethods', 'Insurer Payment Methods', PAYMENT_METHOD, INSURER_METHODS)
        ),
        noInsurance
      ])
    }
  ];
  g.ret('return');
  g.wire(reasonsOf(g, 'reasons', 'Payer Reasons', criteria), 'return.reasons');
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
    [
      d('encounter', T.encounter, 'Encounter', 'The encounter whose insurances to bill.'),
      d('classification', CODE.classification, 'Classification', 'What kind of trip it was.')
    ],
    [
      d(
        'coverages',
        listOf(T.coverage),
        'Coverages',
        'The payers to bill, in billing order; none when the patient pays.'
      ),
      d(
        'reasons',
        listOf('string'),
        'Reasons',
        'What a biller should confirm about the payers before the claim goes out.'
      )
    ],
    { determined: exit('Determined', 'Every reported insurance is a coverage.') },
    [{ name: 'coverages', type: listOf(T.coverage), default: [] }]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  g.add('order', 'billing.billing-order', { label: 'Billing Order' });
  g.add('checks', 'billing.payer-checks', { label: 'Payer Checks' });
  g.wire('entry.encounter', 'checks.encounter');
  g.wire('order.insurances', 'checks.insurances');
  g.wire('entry.classification', 'checks.classification');
  g.wire('checks.reasons', 'return.reasons');
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
    'billing.primary-to-medicare',
    'Primary to Medicare',
    "Whether one insurance pays before Medicare by law: workers' compensation, automobile medical or liability, by its payer type (ePayment.57).",
    primaryToMedicare()
  ),
  asRule(
    'billing.billing-order',
    'Billing Order',
    "The order to bill the insurances in: workers' compensation, automobile medical and liability first, as they pay before Medicare, then primary, secondary, tertiary and any other, as the report ranks them. Override it for payer rules of your own.",
    billingOrder()
  ),
  asRule(
    'billing.transport-accident-cause',
    'Transport Accident Cause',
    'Whether one cause of injury is a transport accident, ICD-10 V00 to V99, such as a motor vehicle collision.',
    transportAccidentCause()
  ),
  asRule(
    'billing.payer-checks',
    'Payer Checks',
    'What a biller should confirm about the payers: Medicare billed first on a work injury or transport accident (Medicare Secondary Payer) or for treatment without transport, or a payment method naming an insurer when the report gives no insurance.',
    payerChecks()
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
    'The coverages of an encounter: every reported insurance, in billing order, with the Payer Checks a biller should confirm. No insurance means the patient pays.',
    determinePayers()
  )
];
