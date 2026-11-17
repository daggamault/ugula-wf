import {
  billingModels,
  ICD10CM_FROM,
  NO_TRANSPORT_CODE,
  NO_TRANSPORT_TRIPS,
  SELF,
  SERVICE_LEVELS
} from '@ugula/billing';
import type { GraphDef, Json, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { asRule, type Builder, d, rule, shared, T } from './shared.ts';

type Port = `${string}.${string}`;

type Test = [name: string, op: string, value?: Json];

const typesOf = (key: string) =>
  new Map(
    (billingModels.find((m) => m.key === key)?.fields ?? []).map((f) => [f.name, f.type] as const)
  );

const RECORD = typesOf('billing.claim-record');
const PAYER = typesOf('billing.recorded-payer');
const objectOf = (types: ReadonlyMap<string, ValueType>): ValueType => ({
  object: Object.fromEntries(types)
});
const ADDRESS: ValueType = RECORD.get('pickup') ?? 'any';
const DIAGNOSIS: ValueType = (RECORD.get('diagnoses') as { list: ValueType }).list;
const MEDICARE_FILINGS = ['MA', 'MB'];

const title = (words: string) =>
  words.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace('Zip', 'ZIP');

const condition = (
  g: Builder,
  id: string,
  label: string,
  inputs: Record<string, [ValueType, Port]>,
  tests: Test[],
  match: 'all' | 'any' = 'all'
) => {
  g.add(id, 'std.logic.condition', {
    label,
    config: {
      match,
      inputs: Object.entries(inputs).map(([name, [type]]) => ({ name, type })),
      rules: tests.map(([field, op, value]) => ({
        field,
        op,
        ...(value === undefined ? {} : { value })
      }))
    }
  });
  for (const [name, [, port]] of Object.entries(inputs)) g.wire(port, `${id}.${name}`);
  return `${id}.result` as const;
};

const ADDRESS_PARTS = [
  ['addressLine', 'street address'],
  ['city', 'city'],
  ['state', 'state'],
  ['postalCode', 'ZIP code']
] as const;

const addressGaps = (): GraphDef => {
  const g = rule(
    [d('place', ADDRESS, 'Place', 'An address with its street, city, state and ZIP code.', true)],
    [d('missing', { list: 'string' }, 'Missing Parts', 'The parts of the address that are empty.')]
  );
  g.add('parts', 'std.object.break', {
    label: 'Address',
    config: { fields: ADDRESS_PARTS.map(([name]) => ({ name, type: 'string' })) }
  });
  g.add('missing', 'std.list.make', {
    label: 'Missing Parts',
    config: { count: ADDRESS_PARTS.length, type: 'string' }
  });
  g.wire('entry.place', 'parts.object');
  for (const [i, [part, name]] of ADDRESS_PARTS.entries()) {
    const gap = condition(
      g,
      `${part}Gap`,
      `${title(name)} Empty`,
      { place: [ADDRESS, 'entry.place'], [part]: ['string', `parts.${part}`] },
      [
        ['place', 'present'],
        [part, 'empty']
      ]
    );
    g.add(`${part}Name`, 'std.logic.select', {
      label: `Missing ${title(name)}`,
      values: { whenTrue: name }
    });
    g.wire(gap, `${part}Name.condition`);
    g.wire(`${part}Name.result`, `missing.item${i + 1}`);
  }
  g.ret('return');
  g.wire('missing.list', 'return.missing');
  return g.def;
};

const diagnosisText = (): GraphDef => {
  const g = rule(
    [d('diagnosis', DIAGNOSIS, 'Diagnosis', 'A diagnosis with what the code set says about it.')],
    [
      d(
        'text',
        'string',
        'Diagnosis Text',
        'Its meaning with the code, such as Abdominal pain (R10.9).'
      )
    ]
  );
  g.add('text', 'std.text.template', {
    label: 'Meaning and Code',
    config: { template: '{diagnosis.description} ({diagnosis.code})' }
  });
  g.ret('return');
  g.wire('entry.diagnosis', 'text.diagnosis');
  g.wire('text.text', 'return.text');
  return g.def;
};

const payerCheckFacts = (): GraphDef => {
  const g = rule(
    [
      d('payer', objectOf(PAYER), 'Payer', 'One payer on the claim as saved.'),
      d('serviceDate', 'string', 'Date of Service', 'The date of service.', true),
      d('today', 'string', 'Today', "Today in the agency's time zone.", true)
    ],
    [
      d(
        'facts',
        objectOf(typesOf('billing.checked-payer')),
        'Payer Facts',
        'What the checks read about the payer.'
      )
    ]
  );
  g.add('payer', 'billing.recorded-payer.break', { label: 'Payer' });
  g.wire('entry.payer', 'payer.payer');
  const p = (name: string): [ValueType, Port] => [PAYER.get(name) ?? 'any', `payer.${name}`];
  const linked = condition(
    g,
    'linked',
    'Linked to the Directory',
    {
      payerId: p('payerId'),
      claimFiling: p('claimFiling')
    },
    [
      ['payerId', 'present'],
      ['claimFiling', 'present']
    ]
  );
  const needsInsured = condition(
    g,
    'needsInsured',
    'Patient Is Not the Insured',
    {
      relationship: p('relationship')
    },
    [['relationship', 'isNot', SELF]]
  );
  const medicare = condition(
    g,
    'medicare',
    'Medicare Payer',
    {
      claimFiling: p('claimFiling')
    },
    [['claimFiling', 'oneOf', MEDICARE_FILINGS]]
  );
  g.add('federal', 'std.table.lookup', {
    label: 'Federal Filing Limit',
    config: shared.lookup(
      'billing.federal-filing-limits',
      'Federal Filing Limits',
      'Days a payer allows to file a claim when the payer directory gives none, by claim filing indicator: Medicare and TRICARE allow one year.',
      {
        type: 'integer',
        rows: [
          { key: 'MA', value: 365 },
          { key: 'MB', value: 365 },
          { key: 'CH', value: 365 }
        ],
        fallback: null
      }
    )
  });
  g.wire('payer.claimFiling', 'federal.key');
  g.add('limit', 'std.logic.choose', {
    label: 'Directory Limit, Else Federal',
    config: { mode: 'first', type: 'integer', count: 2 }
  });
  g.wire('payer.filingLimitDays', 'limit.option1');
  g.wire('federal.value', 'limit.option2');
  g.add('elapsed', 'std.time.difference', {
    label: 'Days Since Service',
    config: { unit: 'days' }
  });
  g.wire('entry.serviceDate', 'elapsed.start');
  g.wire('entry.today', 'elapsed.end');
  g.add('left', 'std.math.subtract', { label: 'Days Left to File' });
  g.wire('limit.value', 'left.a');
  g.wire('elapsed.amount', 'left.b');
  g.add('sinceAdmit', 'std.time.difference', {
    label: 'Days Since Admitted',
    config: { unit: 'days' }
  });
  g.wire('payer.stayAdmittedOn', 'sinceAdmit.start');
  g.wire('entry.serviceDate', 'sinceAdmit.end');
  g.add('untilDischarge', 'std.time.difference', {
    label: 'Days Until Discharged',
    config: { unit: 'days' }
  });
  g.wire('entry.serviceDate', 'untilDischarge.start');
  g.wire('payer.stayDischargedOn', 'untilDischarge.end');
  const admitted = condition(
    g,
    'admitted',
    'Admitted by Then',
    {
      admittedOn: p('stayAdmittedOn'),
      days: ['integer', 'sinceAdmit.amount']
    },
    [
      ['admittedOn', 'empty'],
      ['days', 'gte', 0]
    ],
    'any'
  );
  const notDischarged = condition(
    g,
    'notDischarged',
    'Not Discharged Before',
    {
      dischargedOn: p('stayDischargedOn'),
      days: ['integer', 'untilDischarge.amount']
    },
    [
      ['dischargedOn', 'empty'],
      ['days', 'gte', 0]
    ],
    'any'
  );
  const during = condition(
    g,
    'during',
    'Stay on the Date of Service',
    {
      stayKind: p('stayKind'),
      serviceDate: ['string', 'entry.serviceDate'],
      admitted: ['boolean', admitted],
      notDischarged: ['boolean', notDischarged]
    },
    [
      ['stayKind', 'present'],
      ['serviceDate', 'present'],
      ['admitted', 'is', true],
      ['notDischarged', 'is', true]
    ]
  );
  g.add('stay', 'std.logic.select', { label: 'Stay Reported' });
  g.wire(during, 'stay.condition');
  g.wire('payer.stayKind', 'stay.whenTrue');
  g.add('facts', 'billing.checked-payer.make', { label: 'Payer Facts' });
  for (const f of [
    'coverageId',
    'name',
    'memberId',
    'insuredLastName',
    'eligibility',
    'eligibilityNote'
  ])
    g.wire(`payer.${f}`, `facts.${f}`);
  g.wire(linked, 'facts.linked');
  g.wire(needsInsured, 'facts.needsInsured');
  g.wire('limit.value', 'facts.filingLimitDays');
  g.wire('left.result', 'facts.filingDaysLeft');
  g.wire(medicare, 'facts.medicare');
  g.wire('stay.result', 'facts.stayReported');
  g.ret('return');
  g.wire('facts.payer', 'return.facts');
  return g.def;
};

const PASSED = [
  'pcrNumber',
  'serviceDate',
  'classification',
  'level',
  'emergency',
  'diagnosisCount',
  'transportReason',
  'loadedMiles',
  'signature',
  'signatureNote',
  'pcsOnFile',
  'pcsSignedOn',
  'deceased',
  'nonCoveredMiles',
  'patientCount',
  'abnOnFile',
  'abnSignedOn',
  'denialExpected',
  'mspEmployerPlan',
  'mspEsrd',
  'mspDisability',
  'mspEmployerSize',
  'mspAccident',
  'priorAuthorization',
  'pcsType',
  'roundTrips',
  'facilityStay',
  'pickupFacility',
  'destinationFacility',
  'responsibleParty',
  'documents'
];

const PLACES = [
  ['pickup', 'pickup'],
  ['destination', 'destination'],
  ['patient', 'patient']
] as const;

const claimCheckFacts = (): GraphDef => {
  const g = rule(
    [d('record', T.claimRecord, 'Claim Record', 'The saved claim as it is stored.')],
    [d('facts', T.checkFacts, 'Check Facts', 'The claim as the checks read it.')]
  );
  g.add('record', 'billing.claim-record.break', { label: 'Claim Record' });
  g.wire('entry.record', 'record.record');
  const r = (name: string): [ValueType, Port] => [RECORD.get(name) ?? 'any', `record.${name}`];
  g.add('facts', 'billing.check-facts.make', { label: 'Check Facts' });
  for (const f of PASSED) g.wire(`record.${f}`, `facts.${f}`);
  g.wire(
    condition(g, 'patientLinked', 'Patient on the Claim', { patientId: r('patientId') }, [
      ['patientId', 'present']
    ]),
    'facts.patientLinked'
  );
  for (const [place, field] of [
    ['patient', 'patientAddressMissing'],
    ['pickup', 'pickupMissing'],
    ['destination', 'destinationMissing']
  ] as const) {
    g.add(`${place}Gaps`, 'billing.address-gaps', {
      label: `${place[0]?.toUpperCase()}${place.slice(1)} Gaps`
    });
    g.wire(`record.${place}`, `${place}Gaps.place`);
    g.wire(`${place}Gaps.missing`, `facts.${field}`);
  }
  g.add('transportLines', 'std.list.where', {
    label: 'Lines Other Than No Transport',
    config: { field: '', op: 'isNot', value: NO_TRANSPORT_CODE }
  });
  g.wire('record.lineCodes', 'transportLines.list');
  const classified = condition(
    g,
    'classified',
    'Classified',
    {
      classification: r('classification')
    },
    [['classification', 'present']]
  );
  const transportTrip = condition(
    g,
    'transportTrip',
    'Classified as a Transport',
    {
      classification: r('classification')
    },
    [['classification', 'notOneOf', [...NO_TRANSPORT_TRIPS]]]
  );
  const billedTransport = condition(
    g,
    'billedTransport',
    'Billed as a Transport',
    {
      lines: ['integer', 'transportLines.count']
    },
    [['lines', 'gt', 0]]
  );
  g.add('byWhat', 'std.logic.select', { label: 'By Classification, Else Lines' });
  g.wire(classified, 'byWhat.condition');
  g.wire(transportTrip, 'byWhat.whenTrue');
  g.wire(billedTransport, 'byWhat.whenFalse');
  g.wire(
    condition(
      g,
      'transports',
      'Transported',
      {
        deceased: r('deceased'),
        transport: ['boolean', 'byWhat.result']
      },
      [
        ['deceased', 'isNot', true],
        ['transport', 'is', true]
      ]
    ),
    'facts.transports'
  );
  g.wire(
    condition(g, 'levelValid', 'Valid Level', { level: r('level') }, [
      ['level', 'oneOf', [...SERVICE_LEVELS]]
    ]),
    'facts.levelValid'
  );
  g.add('lineCount', 'std.list.length', { label: 'Charge Lines' });
  g.wire('record.lineCodes', 'lineCount.list');
  g.wire('lineCount.length', 'facts.lineCount');
  g.add('lineSum', 'std.math.sum', { label: 'Sum of the Lines' });
  g.wire('record.lineTotalCents', 'lineSum.values');
  g.add('addsUp', 'std.logic.equal', { label: 'Total Adds Up' });
  g.wire('lineSum.result', 'addsUp.a');
  g.wire('record.totalCents', 'addsUp.b');
  g.wire('addsUp.result', 'facts.linesAddUp');
  const beforeCodes = condition(
    g,
    'beforeCodes',
    'Before the Loaded Code Year',
    {
      serviceDate: r('serviceDate')
    },
    [['serviceDate', 'lt', ICD10CM_FROM]]
  );
  g.add('unknown', 'std.list.where', {
    label: 'Unknown Codes',
    config: { field: 'description', op: 'empty' }
  });
  g.wire('record.diagnoses', 'unknown.list');
  g.add('unknownCodes', 'std.list.pluck', { label: 'Their Codes', values: { field: 'code' } });
  g.wire('unknown.list', 'unknownCodes.list');
  g.add('known', 'std.list.where', {
    label: 'Known Codes',
    config: { field: 'description', op: 'present' }
  });
  g.wire('record.diagnoses', 'known.list');
  g.add('categories', 'std.list.where', {
    label: 'Categories',
    config: { field: 'billable', op: 'isNot', value: true }
  });
  g.wire('known.list', 'categories.list');
  g.add('categoryText', 'std.list.map-rule', {
    label: 'Each Category as Text',
    config: { rule: 'billing.diagnosis-text', version: 1, item: 'diagnosis' }
  });
  g.wire('categories.list', 'categoryText.list');
  for (const [id, from, field] of [
    ['checkedUnknown', 'unknownCodes.list', 'unknownDiagnoses'],
    ['checkedCategories', 'categoryText.text', 'unbillableDiagnoses']
  ] as const) {
    g.add(id, 'std.logic.select', {
      label: field === 'unknownDiagnoses' ? 'Unknown Unless Before' : 'Categories Unless Before',
      values: { whenTrue: [] }
    });
    g.wire(beforeCodes, `${id}.condition`);
    g.wire(from, `${id}.whenFalse`);
    g.wire(`${id}.result`, `facts.${field}`);
  }
  g.wire('record.pickupZipKnown', 'facts.pickupZipPriced');
  g.add('zipText', 'std.text.template', {
    label: 'Pickup ZIP',
    config: { template: '{pickup.postalCode}' }
  });
  g.wire('record.pickup', 'zipText.pickup');
  g.add('zipLength', 'std.text.length', { label: 'Pickup ZIP Length' });
  g.wire('zipText.text', 'zipLength.text');
  g.wire(
    condition(
      g,
      'needsPlusFour',
      'Needs ZIP+4',
      {
        split: r('pickupZipSplit'),
        length: ['integer', 'zipLength.length']
      },
      [
        ['split', 'is', true],
        ['length', 'lt', 9]
      ]
    ),
    'facts.pickupZipNeedsPlusFour'
  );
  g.add('mismatches', 'std.list.make', {
    label: 'ZIP in Another State',
    config: { count: PLACES.length, type: 'string' }
  });
  for (const [i, [place]] of PLACES.entries()) {
    g.add(`${place}State`, 'std.object.get-field', {
      label: `${place[0]?.toUpperCase()}${place.slice(1)} State`,
      config: { record: ADDRESS, path: 'state' }
    });
    g.wire(`record.${place}`, `${place}State.record`);
    g.add(`${place}Differs`, 'std.logic.not-equal', {
      label: `${place[0]?.toUpperCase()}${place.slice(1)} States Differ`
    });
    g.wire(`record.${place}ZipState`, `${place}Differs.a`);
    g.wire(`${place}State.value`, `${place}Differs.b`);
    const mismatch = condition(
      g,
      `${place}Mismatch`,
      `${place[0]?.toUpperCase()}${place.slice(1)} ZIP Elsewhere`,
      {
        zipState: r(`${place}ZipState`),
        state: ['string', `${place}State.value`],
        differs: ['boolean', `${place}Differs.result`]
      },
      [
        ['zipState', 'present'],
        ['state', 'present'],
        ['differs', 'is', true]
      ]
    );
    g.add(`${place}Named`, 'std.logic.select', {
      label: `Mismatched ${title(place)}`,
      values: { whenTrue: place }
    });
    g.wire(mismatch, `${place}Named.condition`);
    g.wire(`${place}Named.result`, `mismatches.item${i + 1}`);
  }
  g.wire('mismatches.list', 'facts.zipStateMismatches');
  g.wire(
    condition(g, 'modifierValid', 'Valid Modifier', { modifier: r('originDestination') }, [
      ['modifier', 'present']
    ]),
    'facts.originDestinationValid'
  );
  g.wire(
    condition(g, 'conditions', 'Conditions Documented', { codes: r('conditionCodes') }, [
      ['codes', 'present']
    ]),
    'facts.conditionsDocumented'
  );
  g.wire(
    condition(
      g,
      'timesRecorded',
      'Times Recorded',
      {
        leftScene: r('leftScene'),
        atDestination: r('atDestination')
      },
      [
        ['leftScene', 'present'],
        ['atDestination', 'present']
      ]
    ),
    'facts.timesRecorded'
  );
  for (const [id, start, end, label] of [
    ['onScene', 'atScene', 'leftScene', 'Seconds on Scene'],
    ['enRoute', 'leftScene', 'atDestination', 'Seconds En Route']
  ] as const) {
    g.add(id, 'std.time.difference', { label, config: { unit: 'seconds' } });
    g.wire(`record.${start}`, `${id}.start`);
    g.wire(`record.${end}`, `${id}.end`);
  }
  const back = (id: string, label: string, gap: Port) =>
    condition(g, id, label, { seconds: ['integer', gap] }, [['seconds', 'lt', 0]]);
  g.wire(
    condition(
      g,
      'inOrder',
      'Times in Order',
      {
        leftEarly: ['boolean', back('leftEarly', 'Left Before Arriving', 'onScene.amount')],
        arrivedEarly: ['boolean', back('arrivedEarly', 'Arrived Before Leaving', 'enRoute.amount')]
      },
      [
        ['leftEarly', 'isNot', true],
        ['arrivedEarly', 'isNot', true]
      ]
    ),
    'facts.timesInOrder'
  );
  g.add('pcsDays', 'std.time.difference', {
    label: 'Days Signed Before the Trip',
    config: { unit: 'days' }
  });
  g.wire('record.pcsSignedOn', 'pcsDays.start');
  g.wire('record.serviceDate', 'pcsDays.end');
  g.wire('pcsDays.amount', 'facts.pcsDaysBeforeTrip');
  g.add('medicarePayers', 'std.list.where', {
    label: 'Medicare Payers',
    config: { field: 'claimFiling', op: 'oneOf', value: MEDICARE_FILINGS }
  });
  g.wire('record.payers', 'medicarePayers.list');
  g.wire(
    condition(
      g,
      'billsMedicare',
      'Bills Medicare',
      {
        medicare: ['integer', 'medicarePayers.count']
      },
      [['medicare', 'gt', 0]]
    ),
    'facts.billsMedicare'
  );
  g.add('payers', 'std.list.map-rule', {
    label: 'Each Payer',
    config: { rule: 'billing.payer-check-facts', version: 1, item: 'payer' }
  });
  g.wire('record.payers', 'payers.list');
  g.wire('record.serviceDate', 'payers.serviceDate');
  g.wire('record.today', 'payers.today');
  g.wire('payers.facts', 'facts.payers');
  g.add('authorizationDays', 'std.time.difference', {
    label: 'Days Authorization Runs Past the Trip',
    config: { unit: 'days' }
  });
  g.wire('record.serviceDate', 'authorizationDays.start');
  g.wire('record.priorAuthorizationExpiresOn', 'authorizationDays.end');
  g.wire('authorizationDays.amount', 'facts.priorAuthorizationDaysLeft');
  g.add('recordedParty', 'std.logic.select', { label: 'Recorded Party' });
  g.wire('record.responsibilityRecorded', 'recordedParty.condition');
  g.wire('record.responsibleParty', 'recordedParty.whenTrue');
  g.wire('recordedParty.result', 'facts.recordedParty');
  g.ret('return');
  g.wire('facts.facts', 'return.facts');
  return g.def;
};

export const checkFactGraphs: SeedGraph[] = [
  asRule(
    'billing.address-gaps',
    'Address Gaps',
    'Names the parts of an address that are empty: street address, city, state or ZIP code; none when there is no address.',
    addressGaps()
  ),
  asRule(
    'billing.diagnosis-text',
    'Diagnosis Text',
    'Writes a diagnosis as its meaning with its code, such as Abdominal pain (R10.9).',
    diagnosisText()
  ),
  asRule(
    'billing.payer-check-facts',
    'Payer Check Facts',
    'Works out what the checks read about one payer: linked to the directory, whether the insured is needed, its filing limit (the directory, else the Federal Filing Limits table) and days left to file, Medicare, and a facility stay it reports on the date of service.',
    payerCheckFacts()
  ),
  asRule(
    'billing.claim-check-facts',
    'Claim Check Facts',
    'Works out what the claim checks read from the saved claim: whether the patient was transported, address gaps, charge lines adding up, diagnoses to check, ZIP code problems, trip times in order, days a certification was signed before the trip, Medicare, each payer, and days a prior authorization runs past the trip.',
    claimCheckFacts()
  )
];
