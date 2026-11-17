import {
  billingModels,
  ICD10CM_FROM,
  NO_TRANSPORT_CODE,
  NO_TRANSPORT_TRIPS,
  SELF,
  SERVICE_LEVELS
} from '@ugula/billing';
import type { GraphDef, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  condition,
  d,
  fixed,
  getField,
  isListed,
  MEDICARE_CLAIM_FILINGS as MEDICARE,
  makeList,
  orElse,
  type Port,
  rule,
  select,
  shared,
  T,
  template
} from './shared.ts';

export const CLAIM_RECORD_IN = d(
  'record',
  T.claimRecord,
  'Claim Record',
  'The saved claim as it is stored.'
);

const typesOf = (key: string) =>
  new Map(
    (billingModels.find((m) => m.key === key)?.fields ?? []).map((f) => [f.name, f.type] as const)
  );

const RECORD = typesOf('billing.claim-record');
const PAYER = typesOf('billing.recorded-payer');
const objectOf = (types: ReadonlyMap<string, ValueType>): ValueType => ({
  object: Object.fromEntries(types)
});
const typeOf = (types: ReadonlyMap<string, ValueType>, name: string): ValueType =>
  types.get(name) ?? 'any';
const ADDRESS = typeOf(RECORD, 'pickup');
const DIAGNOSIS: ValueType = (RECORD.get('diagnoses') as { list: ValueType }).list;

const ADDRESS_PARTS = [
  ['addressLine', 'street address', 'Street Address'],
  ['city', 'city', 'City'],
  ['state', 'state', 'State'],
  ['postalCode', 'ZIP code', 'ZIP Code']
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
  g.wire('entry.place', 'parts.object');
  const named = ADDRESS_PARTS.map(([part, text, label]) => {
    const gap = condition(
      g,
      `${part}Gap`,
      `${label} Missing`,
      { place: [ADDRESS, 'entry.place'], [part]: ['string', `parts.${part}`] },
      [
        { field: 'place', op: 'present' },
        { field: part, op: 'empty' }
      ]
    );
    return select(g, `${part}Name`, `${label}, If Missing`, gap, fixed(text));
  });
  g.ret('return');
  g.wire(makeList(g, 'missing', 'Missing Parts', 'string', named), 'return.missing');
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
  g.ret('return');
  g.wire(
    template(g, 'text', 'Meaning and Code', '{diagnosis.description} ({diagnosis.code})', {
      diagnosis: 'entry.diagnosis'
    }),
    'return.text'
  );
  return g.def;
};

const zipInAnotherState = (): GraphDef => {
  const g = rule(
    [
      d('place', ADDRESS, 'Place', 'An address with its state and ZIP code.', true),
      d(
        'zipState',
        'string',
        'ZIP Code State',
        'The state the ZIP code of the address belongs to (GeoNames).',
        true
      )
    ],
    [
      d(
        'elsewhere',
        'boolean',
        'ZIP in Another State',
        'Whether the ZIP code belongs to another state than the address.'
      )
    ]
  );
  const state = getField(g, 'state', 'Address State', ADDRESS, 'state', 'entry.place');
  g.ret('return');
  g.wire(
    condition(
      g,
      'elsewhere',
      'ZIP Code in Another State',
      { zipState: ['string', 'entry.zipState'], state: ['string', state] },
      [
        { field: 'zipState', op: 'present' },
        { field: 'state', op: 'present' },
        { field: 'zipState', op: 'isNot', input: 'state' }
      ]
    ),
    'return.elsewhere'
  );
  return g.def;
};

const patientTransported = (): GraphDef => {
  const g = rule(
    [
      d('classification', 'string', 'Classification', 'How the trip is classified.', true),
      d('deceased', 'boolean', 'Deceased', 'Whether the patient was dead on scene.', true),
      d(
        'lineCodes',
        typeOf(RECORD, 'lineCodes'),
        'Charge Line Codes',
        'The HCPCS codes of the charge lines.',
        true
      )
    ],
    [
      d(
        'transported',
        'boolean',
        'Transported',
        'Whether a living patient was transported, by the classification, else by the charge lines.'
      )
    ]
  );
  const classification: [ValueType, Port] = ['string', 'entry.classification'];
  g.add('transportLines', 'std.list.where', {
    label: 'Lines Other Than No Transport',
    config: { field: '', op: 'isNot', value: NO_TRANSPORT_CODE }
  });
  g.wire('entry.lineCodes', 'transportLines.list');
  const classified = condition(g, 'classified', 'Classified', { classification }, [
    { field: 'classification', op: 'present' }
  ]);
  const transportTrip = condition(
    g,
    'transportTrip',
    'Classified as a Transport',
    { classification },
    [{ field: 'classification', op: 'notOneOf', value: [...NO_TRANSPORT_TRIPS] }]
  );
  const billedTransport = condition(
    g,
    'billedTransport',
    'Billed as a Transport',
    { lines: ['integer', 'transportLines.count'] },
    [{ field: 'lines', op: 'gt', value: 0 }]
  );
  const byWhat = select(
    g,
    'byWhat',
    'By Classification, Else Lines',
    classified,
    transportTrip,
    billedTransport
  );
  g.ret('return');
  g.wire(
    condition(
      g,
      'transported',
      'Living Patient Transported',
      { deceased: ['boolean', 'entry.deceased'], transport: ['boolean', byWhat] },
      [
        { field: 'deceased', op: 'isNot', value: true },
        { field: 'transport', op: 'is', value: true }
      ]
    ),
    'return.transported'
  );
  return g.def;
};

const diagnosesToCheck = (): GraphDef => {
  const g = rule(
    [
      d(
        'diagnoses',
        typeOf(RECORD, 'diagnoses'),
        'Diagnoses',
        'The diagnoses with what the code set says about each.',
        true
      ),
      d('serviceDate', 'string', 'Date of Service', 'The date of service.', true)
    ],
    [
      d(
        'unknown',
        { list: 'string' },
        'Unknown Codes',
        'The diagnosis codes that are not ICD-10-CM codes.'
      ),
      d(
        'unbillable',
        { list: 'string' },
        'Categories',
        'The diagnoses that are categories needing more characters to bill, as text.'
      )
    ]
  );
  const beforeCodes = condition(
    g,
    'beforeCodes',
    'Before the Loaded ICD-10-CM Year',
    { serviceDate: ['string', 'entry.serviceDate'] },
    [{ field: 'serviceDate', op: 'lt', value: ICD10CM_FROM }]
  );
  g.add('unknown', 'std.list.where', {
    label: 'Unknown Diagnoses',
    config: { field: 'description', op: 'empty' }
  });
  g.add('unknownCodes', 'std.list.pluck', {
    label: 'Unknown Diagnosis Codes',
    values: { field: 'code' }
  });
  g.add('known', 'std.list.where', {
    label: 'Known Diagnoses',
    config: { field: 'description', op: 'present' }
  });
  g.add('categories', 'std.list.where', {
    label: 'Categories',
    config: { field: 'billable', op: 'isNot', value: true }
  });
  g.add('categoryText', 'std.list.map-rule', {
    label: 'Each Category as Text',
    config: { rule: 'billing.diagnosis-text', version: 1, item: 'diagnosis' }
  });
  g.ret('return');
  g.wire('entry.diagnoses', 'unknown.list', 'known.list');
  g.wire('unknown.list', 'unknownCodes.list');
  g.wire('known.list', 'categories.list');
  g.wire('categories.list', 'categoryText.list');
  for (const [id, label, from, out] of [
    ['checkedUnknown', 'Unknown Codes to Check', 'unknownCodes.list', 'unknown'],
    ['checkedCategories', 'Categories to Check', 'categoryText.text', 'unbillable']
  ] as const)
    g.wire(select(g, id, label, beforeCodes, fixed([]), from), `return.${out}`);
  return g.def;
};

const tripTimes = (): GraphDef => {
  const time = (name: string, label: string) =>
    d(name, 'datetime', label, `When the unit ${label.toLowerCase()}.`, true);
  const g = rule(
    [
      time('atScene', 'Arrived at the Scene'),
      time('leftScene', 'Left the Scene'),
      time('atDestination', 'Arrived at the Destination')
    ],
    [
      d(
        'recorded',
        'boolean',
        'Times Recorded',
        'Whether the report says when the patient left the scene and arrived at the destination.'
      ),
      d(
        'inOrder',
        'boolean',
        'Times in Order',
        'Whether no trip time comes before the one ahead of it.'
      )
    ]
  );
  for (const [id, start, end, label] of [
    ['onScene', 'atScene', 'leftScene', 'Seconds on Scene'],
    ['enRoute', 'leftScene', 'atDestination', 'Seconds En Route']
  ] as const) {
    g.add(id, 'std.time.difference', { label, config: { unit: 'seconds' } });
    g.wire(`entry.${start}`, `${id}.start`);
    g.wire(`entry.${end}`, `${id}.end`);
  }
  const back = (id: string, label: string, gap: Port) =>
    condition(g, id, label, { seconds: ['integer', gap] }, [
      { field: 'seconds', op: 'lt', value: 0 }
    ]);
  g.ret('return');
  g.wire(
    condition(
      g,
      'recorded',
      'Trip Times Recorded',
      {
        leftScene: ['datetime', 'entry.leftScene'],
        atDestination: ['datetime', 'entry.atDestination']
      },
      [
        { field: 'leftScene', op: 'present' },
        { field: 'atDestination', op: 'present' }
      ]
    ),
    'return.recorded'
  );
  g.wire(
    condition(
      g,
      'inOrder',
      'Trip Times in Order',
      {
        leftEarly: ['boolean', back('leftEarly', 'Left Before Arriving', 'onScene.amount')],
        arrivedEarly: ['boolean', back('arrivedEarly', 'Arrived Before Leaving', 'enRoute.amount')]
      },
      [
        { field: 'leftEarly', op: 'isNot', value: true },
        { field: 'arrivedEarly', op: 'isNot', value: true }
      ]
    ),
    'return.inOrder'
  );
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
  const p = (name: string): [ValueType, Port] => [typeOf(PAYER, name), `payer.${name}`];
  const linked = condition(
    g,
    'linked',
    'Linked to the Payer Directory',
    { payerId: p('payerId'), claimFiling: p('claimFiling') },
    [
      { field: 'payerId', op: 'present' },
      { field: 'claimFiling', op: 'present' }
    ]
  );
  const needsInsured = condition(
    g,
    'needsInsured',
    'Patient Is Not the Insured',
    { relationship: p('relationship') },
    [{ field: 'relationship', op: 'isNot', value: SELF }]
  );
  const medicare = isListed(g, 'medicare', 'Medicare Payer', MEDICARE, 'payer.claimFiling');
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
  orElse(
    g,
    'limit',
    'Directory Limit, Else Federal',
    'payer.filingLimitDays',
    'federal.value',
    'integer'
  );
  const days = (id: string, label: string, start: Port, end: Port) => {
    g.add(id, 'std.time.difference', { label, config: { unit: 'days' } });
    g.wire(start, `${id}.start`);
    g.wire(end, `${id}.end`);
    return `${id}.amount` as const;
  };
  const elapsed = days('elapsed', 'Days Since Service', 'entry.serviceDate', 'entry.today');
  g.add('left', 'std.math.subtract', { label: 'Days Left to File' });
  g.wire('limit.value', 'left.a');
  g.wire(elapsed, 'left.b');
  const onOrAfter = (id: string, label: string, date: string, gap: Port) =>
    condition(
      g,
      id,
      label,
      { [date]: p(date), days: ['integer', gap] },
      [
        { field: date, op: 'empty' },
        { field: 'days', op: 'gte', value: 0 }
      ],
      'any'
    );
  const admitted = onOrAfter(
    'admitted',
    'Admitted by the Date of Service',
    'stayAdmittedOn',
    days('sinceAdmit', 'Days Since Admitted', 'payer.stayAdmittedOn', 'entry.serviceDate')
  );
  const notDischarged = onOrAfter(
    'notDischarged',
    'Not Discharged Before the Date of Service',
    'stayDischargedOn',
    days('untilDischarge', 'Days Until Discharged', 'entry.serviceDate', 'payer.stayDischargedOn')
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
      { field: 'stayKind', op: 'present' },
      { field: 'serviceDate', op: 'present' },
      { field: 'admitted', op: 'is', value: true },
      { field: 'notDischarged', op: 'is', value: true }
    ]
  );
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
  g.wire(select(g, 'stay', 'Stay Reported', during, 'payer.stayKind'), 'facts.stayReported');
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
  ['patient', 'Patient', 'patientAddressMissing'],
  ['pickup', 'Pickup', 'pickupMissing'],
  ['destination', 'Destination', 'destinationMissing']
] as const;

const claimCheckFacts = (): GraphDef => {
  const g = rule(
    [CLAIM_RECORD_IN],
    [d('facts', T.checkFacts, 'Check Facts', 'The claim as the checks read it.')]
  );
  g.add('record', 'billing.claim-record.break', { label: 'Claim Record' });
  g.wire('entry.record', 'record.record');
  const r = (name: string): [ValueType, Port] => [typeOf(RECORD, name), `record.${name}`];
  const present = (id: string, label: string, name: string, fact: string) =>
    g.wire(
      condition(g, id, label, { [name]: r(name) }, [{ field: name, op: 'present' }]),
      `facts.${fact}`
    );
  g.add('facts', 'billing.check-facts.make', { label: 'Check Facts' });
  for (const f of PASSED) g.wire(`record.${f}`, `facts.${f}`);
  present('patientLinked', 'Patient on the Claim', 'patientId', 'patientLinked');
  for (const [place, label, fact] of PLACES) {
    g.add(`${place}Gaps`, 'billing.address-gaps', { label: `${label} Address Gaps` });
    g.wire(`record.${place}`, `${place}Gaps.place`);
    g.wire(`${place}Gaps.missing`, `facts.${fact}`);
  }
  g.add('transported', 'billing.patient-transported', { label: 'Patient Transported' });
  for (const f of ['classification', 'deceased', 'lineCodes'])
    g.wire(`record.${f}`, `transported.${f}`);
  g.wire('transported.transported', 'facts.transports');
  g.wire(
    condition(g, 'levelValid', 'Level of Service Valid', { level: r('level') }, [
      { field: 'level', op: 'oneOf', value: [...SERVICE_LEVELS] }
    ]),
    'facts.levelValid'
  );
  g.add('lineCount', 'std.list.length', { label: 'Charge Line Count' });
  g.wire('record.lineCodes', 'lineCount.list');
  g.wire('lineCount.length', 'facts.lineCount');
  g.add('lineSum', 'std.math.sum', { label: 'Sum of the Lines' });
  g.wire('record.lineTotalCents', 'lineSum.values');
  g.add('addsUp', 'std.logic.equal', { label: 'Total Adds Up' });
  g.wire('lineSum.result', 'addsUp.a');
  g.wire('record.totalCents', 'addsUp.b');
  g.wire('addsUp.result', 'facts.linesAddUp');
  g.add('diagnoses', 'billing.diagnoses-to-check', { label: 'Diagnoses to Check' });
  g.wire('record.diagnoses', 'diagnoses.diagnoses');
  g.wire('record.serviceDate', 'diagnoses.serviceDate');
  g.wire('diagnoses.unknown', 'facts.unknownDiagnoses');
  g.wire('diagnoses.unbillable', 'facts.unbillableDiagnoses');
  g.wire('record.pickupZipKnown', 'facts.pickupZipPriced');
  const zip = template(g, 'zipText', 'Pickup ZIP Code', '{pickup.postalCode}', {
    pickup: 'record.pickup'
  });
  g.add('zipLength', 'std.text.length', { label: 'Pickup ZIP Code Length' });
  g.wire(zip, 'zipLength.text');
  g.wire(
    condition(
      g,
      'needsPlusFour',
      'Pickup Needs ZIP+4',
      { split: r('pickupZipSplit'), length: ['integer', 'zipLength.length'] },
      [
        { field: 'split', op: 'is', value: true },
        { field: 'length', op: 'lt', value: 9 }
      ]
    ),
    'facts.pickupZipNeedsPlusFour'
  );
  const mismatches = (['pickup', 'destination', 'patient'] as const).map((place) => {
    const label = PLACES.find(([p]) => p === place)?.[1] ?? place;
    g.add(`${place}Mismatch`, 'billing.zip-in-another-state', {
      label: `${label} ZIP in Another State`
    });
    g.wire(`record.${place}`, `${place}Mismatch.place`);
    g.wire(`record.${place}ZipState`, `${place}Mismatch.zipState`);
    return select(
      g,
      `${place}Named`,
      `${label}, If in Another State`,
      `${place}Mismatch.elsewhere`,
      fixed(place)
    );
  });
  g.wire(
    makeList(g, 'mismatches', 'Places with a ZIP in Another State', 'string', mismatches),
    'facts.zipStateMismatches'
  );
  present(
    'modifierValid',
    'Origin/Destination Modifier Valid',
    'originDestination',
    'originDestinationValid'
  );
  present(
    'conditions',
    'Ambulance Conditions Documented',
    'conditionCodes',
    'conditionsDocumented'
  );
  g.add('times', 'billing.trip-times', { label: 'Trip Times' });
  for (const f of ['atScene', 'leftScene', 'atDestination']) g.wire(`record.${f}`, `times.${f}`);
  g.wire('times.recorded', 'facts.timesRecorded');
  g.wire('times.inOrder', 'facts.timesInOrder');
  g.add('pcsDays', 'std.time.difference', {
    label: 'Days the PCS Was Signed Before the Trip',
    config: { unit: 'days' }
  });
  g.wire('record.pcsSignedOn', 'pcsDays.start');
  g.wire('record.serviceDate', 'pcsDays.end');
  g.wire('pcsDays.amount', 'facts.pcsDaysBeforeTrip');
  g.add('payers', 'std.list.map-rule', {
    label: 'Facts of Each Payer',
    config: { rule: 'billing.payer-check-facts', version: 1, item: 'payer' }
  });
  g.wire('record.payers', 'payers.list');
  g.wire('record.serviceDate', 'payers.serviceDate');
  g.wire('record.today', 'payers.today');
  g.wire('payers.facts', 'facts.payers');
  g.add('medicarePayers', 'std.list.where', {
    label: 'Medicare Payers',
    config: { field: 'medicare', op: 'is', value: true }
  });
  g.wire('payers.facts', 'medicarePayers.list');
  g.wire(
    condition(
      g,
      'billsMedicare',
      'Bills Medicare',
      { medicare: ['integer', 'medicarePayers.count'] },
      [{ field: 'medicare', op: 'gt', value: 0 }]
    ),
    'facts.billsMedicare'
  );
  g.add('authorizationDays', 'std.time.difference', {
    label: 'Days the Authorization Runs Past the Trip',
    config: { unit: 'days' }
  });
  g.wire('record.serviceDate', 'authorizationDays.start');
  g.wire('record.priorAuthorizationExpiresOn', 'authorizationDays.end');
  g.wire('authorizationDays.amount', 'facts.priorAuthorizationDaysLeft');
  g.wire(
    select(
      g,
      'recordedParty',
      'Recorded Responsible Party',
      'record.responsibilityRecorded',
      'record.responsibleParty'
    ),
    'facts.recordedParty'
  );
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
    'billing.zip-in-another-state',
    'ZIP in Another State',
    'Whether the ZIP code of an address belongs to another state than the address says, by the GeoNames ZIP codes.',
    zipInAnotherState()
  ),
  asRule(
    'billing.patient-transported',
    'Patient Transported',
    'Whether a living patient was transported: by the classification when the trip has one (not a treat-and-no-transport, refusal or not-billable trip), else by a charge line other than the no-transport code.',
    patientTransported()
  ),
  asRule(
    'billing.diagnoses-to-check',
    'Diagnoses to Check',
    'Finds the diagnosis codes that are not ICD-10-CM codes and the categories that need more characters to bill; none for trips before the year of the loaded ICD-10-CM codes.',
    diagnosesToCheck()
  ),
  asRule(
    'billing.trip-times',
    'Trip Times',
    'Whether the report says when the patient left the scene and arrived at the destination, and whether the arrival, departure and destination times are in order.',
    tripTimes()
  ),
  asRule(
    'billing.payer-check-facts',
    'Payer Check Facts',
    'Works out what the checks read about one payer: whether it is linked to the payer directory, whether the insured is needed, its filing limit (the directory, else the Federal Filing Limits table) and days left to file, whether the Medicare Claim Filings table makes it Medicare, and a facility stay it reports on the date of service.',
    payerCheckFacts()
  ),
  asRule(
    'billing.claim-check-facts',
    'Claim Check Facts',
    'Works out what the claim checks read from the saved claim: whether the patient was transported, address gaps, charge lines adding up, diagnoses to check, ZIP code problems, trip times, the days a physician certification was signed before the trip, each payer and whether one is Medicare, and the days a prior authorization runs past the trip.',
    claimCheckFacts()
  )
];
