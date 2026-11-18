import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
  anyOf,
  asRule,
  asStage,
  type Builder,
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
  n,
  node,
  not,
  PAYMENT,
  QUEUE,
  reasonsOf,
  rule,
  select,
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

const MBI =
  '^[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9]-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9]-?[AC-HJKMNP-RT-Y]{2}[0-9]{2}$';

type NamedType = { id: string; label: string; type: string; words: string[] };

const NAMED_TYPES: NamedType[] = [
  {
    id: 'medicareAdvantage',
    label: 'Medicare Advantage Plan',
    type: '16',
    words: [
      'medicare advantage',
      'medicare hmo',
      'medicare ppo',
      'medicare complete',
      'senior advantage',
      'MAPD'
    ]
  },
  { id: 'medicare', label: 'Medicare', type: 'MB', words: ['medicare'] },
  {
    id: 'medicaid',
    label: 'Medicaid',
    type: 'MC',
    words: [
      'medicaid',
      'medical assistance',
      'medi-cal',
      'masshealth',
      'mass health',
      'tenncare',
      'soonercare',
      'badgercare',
      'AHCCCS',
      'CHIP'
    ]
  },
  {
    id: 'workersComp',
    label: "Workers' Compensation",
    type: 'WC',
    words: [
      'workers comp',
      "workers' comp",
      'workers compensation',
      "workers' compensation",
      'work comp',
      'workmans comp'
    ]
  },
  {
    id: 'auto',
    label: 'Automobile Insurance',
    type: 'AM',
    words: [
      'auto insurance',
      'automobile',
      'progressive',
      'GEICO',
      'allstate',
      'PIP',
      'personal injury protection'
    ]
  },
  { id: 'tricare', label: 'TRICARE', type: 'CH', words: ['tricare', 'champus'] },
  {
    id: 'veterans',
    label: 'Veterans Affairs',
    type: 'VA',
    words: ['veterans affairs', 'veterans administration', 'VA community care']
  }
];

const breakInsurance = (g: Builder) =>
  breakRecord(
    g,
    'insurance',
    n('Insurance', 'The insurance as the report gives it.'),
    INSURANCE,
    'entry.insurance'
  );

const payerType = (): GraphDef => {
  const g = rule(
    [
      d(
        'insurance',
        T.insurance,
        'Insurance',
        'One insurance as the report gives it, or nothing.',
        true
      )
    ],
    [
      d(
        'type',
        code(PAYER_TYPE),
        'Payer Type',
        'The type of payer as reported, else as its name or member ID shows, else nothing.',
        true
      )
    ]
  );
  breakInsurance(g);
  const named = NAMED_TYPES.map((t) =>
    select(
      g,
      `${t.id}Type`,
      n(`${t.label} by Name`, `The name says ${t.label}.`),
      code(PAYER_TYPE),
      `${node(
        g,
        t.id,
        'std.text.find-phrases',
        n(`Named ${t.label}`, 'Looks in the company name.'),
        {
          text: 'insurance.companyName',
          phrases: `${node(g, `${t.id}Words`, 'std.value', n(`${t.label} Words`, `Names that mean ${t.label}.`), {}, { type: listOf('string'), value: t.words })}.value`
        }
      )}.found`,
      fixed(t.type)
    )
  );
  node(
    g,
    'mbi',
    'std.text.find-pattern',
    n('Medicare Member ID', 'A Medicare Beneficiary Identifier has a fixed pattern.'),
    {
      text: 'insurance.memberId',
      pattern: fixed(MBI)
    }
  );
  const byId = select(
    g,
    'mbiType',
    n('Medicare by Member ID', 'An MBI means Medicare Part B.'),
    code(PAYER_TYPE),
    'mbi.found',
    fixed('MB')
  );
  const inferred = firstSet(
    g,
    'inferredType',
    n('Type From the Name or ID', 'The first name match, else the member ID.'),
    code(PAYER_TYPE),
    [...named, byId]
  );
  const type = firstSet(
    g,
    'type',
    n('Reported, Else Inferred', 'The report wins when it gives a type.'),
    code(PAYER_TYPE),
    ['insurance.payerType', inferred]
  );
  g.ret('return');
  g.wire(type, 'return.type');
  return g.def;
};

const typed = (g: Builder) => {
  g.add('type', 'billing.payer-type', {
    label: 'Payer Type',
    note: 'As reported, else from the name or member ID.'
  });
  g.wire('entry.insurance', 'type.insurance');
  return 'type.type' as const;
};

const typeRule = (
  description: string,
  label: string,
  note: string,
  values: string[],
  valuesLabel: string
) => {
  const g = rule([INSURANCE_IN], [resultOut(description)]);
  g.ret('return');
  g.wire(
    isIn(
      g,
      'matches',
      n(label, note),
      PAYER_TYPE,
      typed(g),
      codes(g, 'types', n(valuesLabel, 'Payer types, NEMSIS ePayment.57.'), PAYER_TYPE, values)
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
  g.wire(
    startsWith(g, 'transport', n('Transport Accident', 'ICD-10 V00 to V99.'), 'entry.cause', 'V'),
    'return.result'
  );
  return g.def;
};

const notMedicaid = (g: Builder) =>
  not(
    g,
    'notMedicaid',
    n('Not Medicaid', 'Medicaid is billed last, whatever its priority.'),
    `${node(g, 'medicaid', 'billing.is-medicaid', n('Is Medicaid', 'The payer of last resort.'), {
      insurance: 'entry.insurance'
    })}.result`
  );

const hasPriority = (): GraphDef => {
  const g = rule(
    [
      INSURANCE_IN,
      d('priority', code(PRIORITY), 'Billing Priority', 'The billing priority to look for.')
    ],
    [resultOut('Whether the insurance has that billing priority and is not Medicaid.')]
  );
  breakInsurance(g);
  node(
    g,
    'same',
    'std.logic.equal',
    n('Same Priority', 'NEMSIS ePayment.11.'),
    { a: 'insurance.priority', b: 'entry.priority' },
    { type: code(PRIORITY) }
  );
  g.ret('return');
  g.wire(
    allOf(g, 'ranked', n('Ranked Here, Not Medicaid', 'Both.'), ['same.result', notMedicaid(g)]),
    'return.result'
  );
  return g.def;
};

const hasOtherPriority = (): GraphDef => {
  const g = rule(
    [INSURANCE_IN],
    [
      resultOut(
        'Whether the insurance is not ranked primary, secondary or tertiary, and is not Medicaid.'
      )
    ]
  );
  breakInsurance(g);
  const ranked = isIn(
    g,
    'ranked',
    n('Ranked First, Second or Third', 'NEMSIS ePayment.11.'),
    PRIORITY,
    'insurance.priority',
    codes(
      g,
      'rankedCodes',
      n('Primary, Secondary and Tertiary', 'The ranked priorities.'),
      PRIORITY,
      PRIORITIES.map((r) => r.code)
    )
  );
  g.ret('return');
  g.wire(
    allOf(g, 'other', n('Unranked, Not Medicaid', 'Both.'), [
      not(g, 'unranked', n('Any Other Priority', 'Not ranked, or not given.'), ranked),
      notMedicaid(g)
    ]),
    'return.result'
  );
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
        "Workers' compensation, automobile medical and liability payers first, as they pay before Medicare; then the primary, secondary, tertiary and other insurances; Medicaid last, as the payer of last resort; each in report order and each once."
      )
    ]
  );
  keepWhere(
    g,
    'beforeMedicare',
    n('Payers Before Medicare', "Workers' compensation, auto and liability pay first."),
    'billing.primary-to-medicare',
    'insurance',
    'entry.insurances'
  );
  for (const r of PRIORITIES) {
    keepWhere(
      g,
      r.id,
      n(r.label, 'Ranked so on the report, Medicaid aside.'),
      'billing.has-priority',
      'insurance',
      'entry.insurances',
      {
        priority: fixed(r.code)
      }
    );
  }
  keepWhere(
    g,
    'others',
    n('Other Insurances', 'Unranked, Medicaid aside.'),
    'billing.has-other-priority',
    'insurance',
    'entry.insurances'
  );
  keepWhere(
    g,
    'medicaid',
    n('Medicaid', 'Billed last, as the payer of last resort.'),
    'billing.is-medicaid',
    'insurance',
    'entry.insurances'
  );
  const ordered = joinLists(
    g,
    'ordered',
    n('In Billing Order', 'Before Medicare, then by priority, then Medicaid.'),
    T.insurance,
    [
      'beforeMedicare.list',
      ...PRIORITIES.map((r) => `${r.id}.list` as const),
      'others.list',
      'medicaid.list'
    ]
  );
  node(
    g,
    'once',
    'std.list.unique',
    n('Each Once', 'An insurance in two groups is billed once, in its first.'),
    { list: ordered },
    { type: T.insurance }
  );
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
  breakRecord(
    g,
    'trip',
    n('Encounter', 'The injury and payment details.'),
    ENCOUNTER,
    'entry.encounter'
  );
  breakRecord(
    g,
    'payment',
    n('Payment', 'How the report says the trip is paid.'),
    PAYMENT,
    'trip.payment'
  );
  keepWhere(
    g,
    'accidents',
    n('Transport Accident Causes', 'Causes of injury from V00 to V99.'),
    'billing.transport-accident-cause',
    'cause',
    'trip.injuryCauses'
  );
  const injury = anyOf(
    g,
    'injury',
    n('Work Injury or Transport Accident', 'Another payer may pay before Medicare.'),
    [
      isCode(
        g,
        'work',
        n('Work Related', 'NEMSIS eSituation.14.'),
        'yesNoUnknown',
        'trip.workRelated',
        WORK_RELATED
      ),
      greaterThan(
        g,
        'accident',
        n('Transport Accident', 'Any transport accident cause.'),
        'integer',
        'accidents.count',
        0
      )
    ]
  );
  node(
    g,
    'first',
    'std.list.first',
    n('First Insurance', 'The payer billed first.'),
    { list: 'entry.insurances' },
    { type: T.insurance }
  );
  node(
    g,
    'firstType',
    'billing.payer-type',
    n('First Payer Type', 'As reported, else from its name or member ID.'),
    {
      insurance: 'first.item'
    }
  );
  node(
    g,
    'count',
    'std.list.length',
    n('Insurances Reported', 'How many the report gives.'),
    { list: 'entry.insurances' },
    { type: T.insurance }
  );
  const noInsurance = isZero(
    g,
    'noInsurance',
    n('No Insurance Reported', 'None at all.'),
    'count.length'
  );
  const medicareFirst = anyOf(
    g,
    'medicareFirst',
    n('Medicare Billed First', 'By its type, or by the payment method.'),
    [
      isIn(
        g,
        'medicareType',
        n('Medicare Payer Type', 'Part A, Part B or a Medicare HMO.'),
        PAYER_TYPE,
        'firstType.type',
        codes(
          g,
          'medicareTypes',
          n('Medicare Payer Types', 'Part A, Part B, Medicare HMO.'),
          PAYER_TYPE,
          MEDICARE_TYPES
        )
      ),
      allOf(
        g,
        'medicareMethod',
        n('Medicare Pays an Insurance With No Type', 'The payment method says Medicare.'),
        [
          isMissing(
            g,
            'noPayerType',
            n('No Payer Type', 'Neither reported nor found.'),
            'firstType.type'
          ),
          not(g, 'someInsurance', n('Some Insurance Reported', 'At least one.'), noInsurance),
          isCode(
            g,
            'medicarePays',
            n('Medicare Pays', 'NEMSIS ePayment.01.'),
            PAYMENT_METHOD,
            'payment.method',
            MEDICARE_METHOD
          )
        ]
      )
    ]
  );
  keepWhere(
    g,
    'medicares',
    n('Medicare Insurances', 'Each Medicare insurance.'),
    'billing.is-medicare',
    'insurance',
    'entry.insurances'
  );
  keepWhere(
    g,
    'unranked',
    n('Unranked Insurances', 'Each insurance without a ranked priority.'),
    'billing.has-other-priority',
    'insurance',
    'entry.insurances'
  );
  const criteria: Criterion[] = [
    {
      id: 'secondaryPayer',
      label: 'Medicare First on a Work Injury or Transport Accident',
      reason:
        'Medicare is billed first on a work injury or transport accident: confirm with the Medicare Secondary Payer questionnaire who pays first',
      holds: allOf(
        g,
        'secondaryPayer',
        n('Medicare First on an Injury', 'Another payer may owe first.'),
        [injury, medicareFirst]
      )
    },
    {
      id: 'noTransportMedicare',
      label: 'Medicare First Without Transport',
      reason:
        'Medicare is billed first for care without transport (A0998), which Medicare does not pay: bill the patient or another payer, or expect a denial',
      holds: allOf(
        g,
        'noTransportMedicare',
        n('Medicare First Without Transport', 'Medicare does not pay A0998.'),
        [
          isIn(
            g,
            'noTransport',
            n('Not Transported', 'Treated or refused without transport.'),
            'tripClassification',
            'entry.classification',
            codes(
              g,
              'noTransportKinds',
              n('Kinds Without Transport', 'Treated, refused.'),
              'tripClassification',
              ['treatNoTransport', 'refusal']
            )
          ),
          medicareFirst
        ]
      )
    },
    {
      id: 'medicareOrder',
      label: 'Medicare and Another Plan, Unranked',
      reason:
        'Medicare and another health plan are reported without billing priorities: confirm with the Medicare Secondary Payer questionnaire who pays first',
      holds: allOf(
        g,
        'medicareOrder',
        n('Medicare and Another Plan, Unranked', 'Who pays first depends on the patient.'),
        [
          greaterThan(
            g,
            'hasMedicare',
            n('Has Medicare', 'At least one Medicare insurance.'),
            'integer',
            'medicares.count',
            0
          ),
          greaterThan(
            g,
            'hasOther',
            n('Two or More Unranked', 'More than one insurance without a priority.'),
            'integer',
            'unranked.count',
            1
          )
        ]
      )
    },
    {
      id: 'missingCoverage',
      label: 'Insurer Named, but No Insurance Reported',
      reason:
        'The payment method names an insurer, but the report gives no insurance: find the coverage before billing the patient',
      holds: allOf(g, 'missingCoverage', n('Insurer Named, No Insurance', 'Coverage to find.'), [
        isIn(
          g,
          'insurerMethod',
          n('Paid by an Insurer', 'NEMSIS ePayment.01.'),
          PAYMENT_METHOD,
          'payment.method',
          codes(
            g,
            'insurerMethods',
            n(
              'Insurer Payment Methods',
              'Insurance, Medicaid, Medicare, government, workers’ comp.'
            ),
            PAYMENT_METHOD,
            INSURER_METHODS
          )
        ),
        noInsurance
      ])
    }
  ];
  g.ret('return');
  g.wire(
    reasonsOf(g, 'reasons', n('Payer Reasons', 'What to confirm about the payers.'), criteria),
    'return.reasons'
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
  breakRecord(
    g,
    'insurance',
    n('Insurance', 'The insurance as the report gives it.'),
    INSURANCE,
    'entry.insurance'
  );
  const name = firstSet(
    g,
    'name',
    n('Insurance Name', 'The company name, else its ID, to look up.'),
    'string',
    ['insurance.companyName', 'insurance.companyId', fixed('Unnamed insurance')]
  );
  lookup(
    g,
    'relationship',
    n(
      'Relationship as an X12 Code',
      'How the patient relates to the insured, as an X12 code; self when unknown.'
    ),
    RELATIONSHIPS,
    'insurance.relationship'
  );
  g.add('find', 'payer.find', {
    label: 'Find Payer',
    note: 'Looks the payer up in the agency’s directory.'
  });
  const options = choicesFor(
    g,
    'options',
    n('Similar Payers', 'The similar payers a biller chooses from.'),
    'billing.payer-choice',
    'payerId',
    'find.candidates'
  );
  g.add('match', 'std.human.task', {
    label: 'Match the Payer',
    note: 'A biller decides which directory payer this insurance is.',
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
    note: 'Keeps the payer the directory matched.',
    config: { name: 'payerId' }
  });
  g.add('rememberChosen', 'std.var.set', {
    label: 'Remember the Payer Chosen',
    note: 'Keeps the payer the biller chose.',
    config: { name: 'payerId' }
  });
  g.add('payer', 'std.var.get', {
    label: 'Payer',
    note: 'The payer matched or chosen, if any.',
    config: { name: 'payerId' }
  });
  g.add('coverage', 'coverage.make', {
    label: 'Coverage',
    note: 'The coverage billed, with the policy details.'
  });
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
  breakRecord(
    g,
    'trip',
    n('Encounter', 'The insurances the report gives.'),
    ENCOUNTER,
    'entry.encounter'
  );
  g.add('order', 'billing.billing-order', {
    label: 'Billing Order',
    note: 'Puts the insurances in the order they are billed.'
  });
  g.add('checks', 'billing.payer-checks', {
    label: 'Payer Checks',
    note: 'What a biller should confirm about who pays.'
  });
  g.wire('entry.encounter', 'checks.encounter');
  g.wire('order.insurances', 'checks.insurances');
  g.wire('entry.classification', 'checks.classification');
  g.wire('checks.reasons', 'return.reasons');
  g.add('each', 'std.flow.for-each', { label: 'Each Insurance', note: 'One insurance at a time.' });
  g.add('coverage', 'billing.resolve-coverage', {
    label: 'Resolve Coverage',
    note: 'Matches the insurance to a directory payer.'
  });
  g.add('keep', 'std.var.append', {
    label: 'Keep the Coverage',
    note: 'Adds the coverage to the list.',
    config: { name: 'coverages' }
  });
  g.add('kept', 'std.var.get', {
    label: 'Coverages',
    note: 'Every coverage, in billing order.',
    config: { name: 'coverages' }
  });
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
    'billing.payer-type',
    'Payer Type',
    'The type of payer of an insurance: as the report gives it (NEMSIS ePayment.57, which agencies often leave out), else what its company name says (Medicare, a Medicare Advantage plan, Medicaid, workers’ compensation, auto, TRICARE, VA), else Medicare Part B when the member ID is a Medicare Beneficiary Identifier.',
    payerType()
  ),
  asRule(
    'billing.is-medicaid',
    'Is Medicaid',
    'Whether an insurance is Medicaid, the payer of last resort.',
    typeRule(
      'Whether the insurance is Medicaid.',
      'Is Medicaid',
      'Medicaid is billed last.',
      ['MC'],
      'Medicaid'
    )
  ),
  asRule(
    'billing.is-medicare',
    'Is Medicare',
    'Whether an insurance is Medicare: Part A, Part B or a Medicare HMO.',
    typeRule(
      'Whether the insurance is Medicare.',
      'Is Medicare',
      'Part A, Part B or a Medicare HMO.',
      MEDICARE_TYPES,
      'Medicare Payer Types'
    )
  ),
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
    typeRule(
      "Whether the insurance is workers' compensation, automobile medical or liability, which pay before Medicare.",
      'Pays Before Medicare',
      "Workers' compensation, auto and liability pay before Medicare.",
      PRIMARY_TO_MEDICARE,
      "Workers' Compensation, Automobile Medical and Liability"
    )
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
