import type { GraphDef, PinSpec, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
  asRule,
  asStage,
  type Builder,
  breakRecord,
  CODE,
  type Criterion,
  code,
  codes,
  codeTable,
  DESTINATION,
  d,
  ENCOUNTER,
  exit,
  firstSet,
  fixed,
  greaterThan,
  ID,
  isCode,
  isIn,
  isMissing,
  isText,
  joinLists,
  listOf,
  lookup,
  makeList,
  node,
  not,
  orZero,
  type Port,
  reasonsOf,
  rule,
  SCENE,
  SERVICE_TYPES,
  select,
  stage,
  startsWith,
  T,
  template
} from './shared.ts';

const LINE_FIELDS: { name: string; type: ValueType }[] = [
  { name: 'code', type: CODE.hcpcs },
  { name: 'modifiers', type: listOf(CODE.modifier) },
  { name: 'units', type: 'number' }
];

const UNPRICED: ValueType = {
  object: Object.fromEntries(LINE_FIELDS.map((f) => [f.name, f.type]))
};

const DESTINATION_LETTERS = codeTable(
  'billing.destination-letters',
  'Destination Letters',
  'The destination letter of the origin and destination modifier for each type of destination (eDisposition.21).',
  CODE.place,
  {
    '4221001': 'R',
    '4221003': 'H',
    '4221005': 'H',
    '4221023': 'H',
    '4221007': 'P',
    '4221021': 'P',
    '4221011': 'E',
    '4221029': 'E',
    '4221033': 'E',
    '4221015': 'I',
    '4221025': 'J',
    '4221027': 'D',
    '4221041': 'N'
  }
);

type Origin = { id: string; letter: string; label: string; holds: (g: Builder) => Port };

const pickedUpAt =
  (id: string, label: string, prefix: string) =>
  (g: Builder): Port =>
    startsWith(g, id, label, 'entry.pickupType', prefix);

const leaving =
  (id: string, label: string, services: readonly string[]) =>
  (g: Builder): Port =>
    isIn(
      g,
      id,
      label,
      'serviceType',
      'entry.serviceType',
      codes(g, `${id}Codes`, `${label}: Services`, 'serviceType', services)
    );

const ORIGINS: Origin[] = [
  {
    id: 'home',
    letter: 'R',
    label: 'Picked Up at Home',
    holds: pickedUpAt('atHome', 'Picked Up at Home', 'Y92.0')
  },
  {
    id: 'institution',
    letter: 'E',
    label: 'Picked Up at a Residential Institution',
    holds: pickedUpAt('atInstitution', 'Picked Up at a Residential Institution', 'Y92.1')
  },
  {
    id: 'hospital',
    letter: 'H',
    label: 'Picked Up at a Hospital',
    holds: pickedUpAt('atHospital', 'Picked Up at a Hospital', 'Y92.23')
  },
  {
    id: 'office',
    letter: 'P',
    label: "Picked Up at a Physician's Office",
    holds: pickedUpAt('atOffice', "Picked Up at a Physician's Office", 'Y92.53')
  },
  {
    id: 'interfacility',
    letter: 'H',
    label: 'Leaving a Hospital',
    holds: leaving('leavingHospital', 'Leaving a Hospital', SERVICE_TYPES.leavingHospital)
  },
  {
    id: 'careFacility',
    letter: 'E',
    label: 'Leaving a Care Facility',
    holds: leaving('leavingCare', 'Leaving a Care Facility', SERVICE_TYPES.leavingCare)
  },
  {
    id: 'scene',
    letter: 'S',
    label: 'Emergency Response to a Scene',
    holds: leaving('atScene', 'Emergency Response to a Scene', SERVICE_TYPES.emergency)
  }
];

const originLetter = (): GraphDef => {
  const g = rule(
    [
      d(
        'pickupType',
        code('locationType'),
        'Pickup Location Type',
        'The type of location the patient was picked up at, NEMSIS eScene.09.',
        true
      ),
      d(
        'serviceType',
        code('serviceType'),
        'Service Type',
        'The type of service requested, NEMSIS eResponse.05.',
        true
      )
    ],
    [
      d('letter', CODE.place, 'Origin', 'The origin letter, or nothing when unknown.', true),
      d('reason', 'string', 'Reason', 'Why that letter was chosen.', true)
    ]
  );
  const held = ORIGINS.map((o) => ({ ...o, when: o.holds(g) }));
  const letter = firstSet(
    g,
    'letter',
    'First Origin That Holds',
    CODE.place,
    held.map((o) =>
      select(g, `${o.id}Letter`, `${o.letter} When ${o.label}`, CODE.place, o.when, fixed(o.letter))
    )
  );
  const reason = firstSet(
    g,
    'reason',
    'Why That Origin',
    'string',
    held.map((o) =>
      select(
        g,
        `${o.id}Reason`,
        `Reason When ${o.label}`,
        'string',
        o.when,
        fixed(`Origin ${o.letter}: ${o.label.toLowerCase()}`)
      )
    )
  );
  g.ret('return');
  g.wire(letter, 'return.letter');
  g.wire(reason, 'return.reason');
  return g.def;
};

const originAndDestination = (): GraphDef => {
  const g = rule(
    [d('encounter', T.encounter, 'Encounter', 'The encounter, with where it started and ended.')],
    [
      d(
        'originCode',
        CODE.place,
        'Origin',
        'The origin letter, or nothing when either is unknown.',
        true
      ),
      d(
        'destinationCode',
        CODE.place,
        'Destination',
        'The destination letter, or nothing when either is unknown.',
        true
      ),
      d('reasons', listOf('string'), 'Reasons', 'Why the origin letter was chosen.')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'pickup', 'Pickup', SCENE, 'trip.pickup');
  breakRecord(g, 'destination', 'Destination', DESTINATION, 'trip.destination');
  node(g, 'origin', 'billing.origin-letter', 'Origin Letter', {
    pickupType: 'pickup.type',
    serviceType: 'trip.serviceType'
  });
  lookup(g, 'destinationLetter', 'Destination Letter', DESTINATION_LETTERS, 'destination.type');
  const both = allOf(g, 'both', 'Both Letters Known', [
    not(g, 'originKnown', 'Origin Known', isMissing(g, 'noOrigin', 'No Origin', 'origin.letter')),
    'destinationLetter.found'
  ]);
  const whenBoth = (id: string, label: string, type: PinSpec['type'], value: Port) =>
    select(g, id, label, type, both, value, fixed(null));
  g.ret('return');
  g.wire(
    whenBoth('originCode', 'Origin When Both Known', CODE.place, 'origin.letter'),
    'return.originCode'
  );
  g.wire(
    whenBoth(
      'destinationCode',
      'Destination When Both Known',
      CODE.place,
      'destinationLetter.value'
    ),
    'return.destinationCode'
  );
  g.wire(
    makeList(g, 'reasons', 'Origin Reason', 'string', [
      whenBoth('reasonApplied', 'Reason When Both Known', 'string', 'origin.reason')
    ]),
    'return.reasons'
  );
  return g.def;
};

const GROUND = 'Ground';

const VEHICLES = codeTable(
  'billing.vehicles',
  'Vehicles',
  'The kind of vehicle billed for each NEMSIS transport method (eDisposition.16): fixed wing, rotor wing, else ground.',
  'string',
  { '4216001': 'Fixed Wing', '4216003': 'Rotor Wing' },
  GROUND
);

const MILEAGE_CODES = codeTable(
  'billing.mileage-codes',
  'Mileage Codes',
  'The HCPCS mileage code for each kind of vehicle.',
  CODE.hcpcs,
  { [GROUND]: 'A0425', 'Fixed Wing': 'A0435', 'Rotor Wing': 'A0436' }
);

const BASE_RATES = codeTable(
  'billing.base-rate-codes',
  'Base Rate Codes',
  'The HCPCS base rate code for each ground level of service, emergency or not, and for each kind of aircraft.',
  CODE.hcpcs,
  {
    'Fixed Wing': 'A0430',
    'Rotor Wing': 'A0431',
    'BLS Emergency': 'A0429',
    'BLS Non-Emergency': 'A0428',
    'ALS1 Emergency': 'A0427',
    'ALS1 Non-Emergency': 'A0426',
    'ALS2 Emergency': 'A0433',
    'ALS2 Non-Emergency': 'A0433',
    'SCT Emergency': 'A0434',
    'SCT Non-Emergency': 'A0434'
  }
);

const CLASSIFICATION_IN = d(
  'classification',
  CODE.classification,
  'Classification',
  'What kind of trip it was.'
);

const SERVICE_IN: PinSpec[] = [
  CLASSIFICATION_IN,
  d('level', CODE.level, 'Level of Service', 'BLS, ALS1, ALS2 or SCT.'),
  d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.')
];

const VEHICLE_IN = d(
  'vehicle',
  'string',
  'Vehicle',
  'The kind of vehicle billed: Ground, Fixed Wing or Rotor Wing (Vehicles table).'
);

const TRANSPORT_METHOD_IN = d(
  'transportMethod',
  code('transportMethod'),
  'Transport Method',
  'How the patient was transported, such as ground or rotor craft, NEMSIS eDisposition.16.',
  true
);

const LOADED_MILES_IN = d(
  'loadedMiles',
  'number',
  'Loaded Miles',
  'Miles with the patient on board.',
  true
);

const ORIGIN_IN = d('originCode', CODE.place, 'Origin', 'The origin letter.', true);

const DESTINATION_IN = d(
  'destinationCode',
  CODE.place,
  'Destination',
  'The destination letter.',
  true
);

const PATIENTS_IN = d(
  'patientsTransported',
  'integer',
  'Patients Transported',
  'How many patients this unit transported together, NEMSIS eDisposition.11.',
  true
);

const TRANSPORT_REASON_IN = d(
  'transportReason',
  code('transportReason'),
  'Transport Reason',
  'Why the patient went to this destination, such as A for the nearest facility, NEMSIS ePayment.44.',
  true
);

const CLOSEST_MILES_IN = d(
  'closestFacilityMiles',
  'number',
  'Miles to the Closest Facility',
  'Miles to the closest appropriate facility, NEMSIS ePayment.48.',
  true
);

const CHARGE_IN: PinSpec[] = [
  ...SERVICE_IN,
  TRANSPORT_METHOD_IN,
  LOADED_MILES_IN,
  ORIGIN_IN,
  DESTINATION_IN,
  PATIENTS_IN,
  TRANSPORT_REASON_IN,
  CLOSEST_MILES_IN
];

const PAYER_IN = d('payerId', ID.payer, 'Payer', 'The payer billed first, for its own fees.', true);

const reasonsPin = (what: string) => d('reasons', listOf('string'), 'Reasons', what);

const TRANSPORTS = ['emergency', 'scheduled'];

const NON_COVERED_REASONS = ['B', 'C'];

const isClassification = (g: Builder, id: string, label: string, value: string) =>
  isCode(g, id, label, 'tripClassification', 'entry.classification', value);

const baseRateCode = (): GraphDef => {
  const g = rule(
    [...SERVICE_IN, VEHICLE_IN],
    [
      d('code', CODE.hcpcs, 'Base Rate Code', 'The HCPCS code of the trip itself.'),
      reasonsPin('Which code was chosen and why.')
    ]
  );
  const dead = isClassification(g, 'dead', 'Pronounced Dead Before Loading', 'pronouncedDead');
  const level = select(
    g,
    'level',
    'BLS When Pronounced Dead, Else the Level',
    CODE.level,
    dead,
    fixed('BLS'),
    'entry.level'
  );
  const kind = select(
    g,
    'kind',
    'Emergency or Not',
    'string',
    'entry.emergency',
    fixed('Emergency'),
    fixed('Non-Emergency')
  );
  const groundKey = template(g, 'groundKey', 'Level and Kind', '{level} {kind}', { level, kind });
  const key = select(
    g,
    'key',
    'Level and Kind by Ground, Else the Aircraft',
    'string',
    isText(g, 'ground', 'By Ground', 'entry.vehicle', GROUND),
    groundKey,
    'entry.vehicle'
  );
  lookup(g, 'rate', 'Base Rate Codes', BASE_RATES, key);
  const noTransport = isClassification(
    g,
    'noTransport',
    'Treated Without Transport',
    'treatNoTransport'
  );
  const rateCode = select(
    g,
    'code',
    'A0998 Without Transport, Else the Base Rate',
    CODE.hcpcs,
    noTransport,
    fixed('A0998'),
    'rate.value'
  );
  const reason = select(
    g,
    'reason',
    'Reason for the Code',
    'string',
    noTransport,
    fixed('A0998: treated without transport'),
    template(g, 'rateReason', 'Base Rate Reason', 'Base rate {code}: {key}', {
      code: rateCode,
      key
    })
  );
  g.ret('return');
  g.wire(rateCode, 'return.code');
  g.wire(makeList(g, 'reasons', 'Base Rate Reason Given', 'string', [reason]), 'return.reasons');
  return g.def;
};

const lineModifiers = (): GraphDef => {
  const g = rule(
    [CLASSIFICATION_IN, ORIGIN_IN, DESTINATION_IN, PATIENTS_IN],
    [
      d(
        'modifiers',
        listOf(CODE.modifier),
        'Modifiers',
        'The origin and destination modifier, then QL and GM when they apply.'
      ),
      reasonsPin('Why QL or GM is added.')
    ]
  );
  const letters = template(g, 'letters', 'Origin Then Destination', '{origin}{destination}', {
    origin: 'entry.originCode',
    destination: 'entry.destinationCode'
  });
  node(
    g,
    'places',
    'std.convert.to-code',
    'As a Modifier',
    { text: letters },
    { kind: 'modifier' }
  );
  const criteria: Criterion[] = [
    {
      id: 'dead',
      label: 'Pronounced Dead Before Loading',
      reason: 'QL: pronounced dead before loading',
      holds: isClassification(g, 'dead', 'Pronounced Dead Before Loading', 'pronouncedDead')
    },
    {
      id: 'several',
      label: 'More Than One Patient Transported',
      reason: 'GM: more than one patient transported',
      holds: greaterThan(
        g,
        'several',
        'More Than One Patient Transported',
        'number',
        orZero(g, 'patients', 'Patients or Zero', 'entry.patientsTransported'),
        1
      )
    }
  ];
  const modifier = (id: string, label: string, holds: Port, value: string) =>
    select(g, id, label, CODE.modifier, holds, fixed(value));
  g.ret('return');
  g.wire(
    makeList(g, 'modifiers', 'Modifiers', CODE.modifier, [
      'places.code',
      modifier('ql', 'QL When Pronounced Dead', 'dead.result', 'QL'),
      modifier('gm', 'GM When More Than One Patient', 'several.result', 'GM')
    ]),
    'return.modifiers'
  );
  g.wire(reasonsOf(g, 'reasons', 'Modifier Reasons', criteria), 'return.reasons');
  return g.def;
};

const coveredMiles = (): GraphDef => {
  const g = rule(
    [LOADED_MILES_IN, TRANSPORT_REASON_IN, CLOSEST_MILES_IN],
    [
      d(
        'coveredMiles',
        'number',
        'Covered Miles',
        'The loaded miles, or only the miles to the closest facility when the patient chose a farther one.',
        true
      ),
      d(
        'nonCoveredMiles',
        'number',
        'Non-Covered Miles',
        'The miles beyond the closest facility when the patient chose a farther one.',
        true
      ),
      reasonsPin('Why some miles are not covered.')
    ]
  );
  const farther = isIn(
    g,
    'farther',
    'Transported Farther by Choice',
    'transportReason',
    'entry.transportReason',
    codes(
      g,
      'choiceReasons',
      'Preferred Physician or Near Family',
      'transportReason',
      NON_COVERED_REASONS
    )
  );
  node(
    g,
    'closest',
    'std.math.round',
    'Closest Facility Up to the Tenth',
    { value: 'entry.closestFacilityMiles', digits: fixed(1) },
    { direction: 'up' }
  );
  node(g, 'extra', 'std.math.subtract', 'Loaded Minus Closest', {
    a: 'entry.loadedMiles',
    b: 'closest.result'
  });
  node(g, 'extraTenths', 'std.math.round', 'To the Tenth', {
    value: 'extra.result',
    digits: fixed(1)
  });
  const hasExtra = allOf(g, 'hasExtra', 'Miles Beyond the Closest Facility', [
    farther,
    greaterThan(
      g,
      'positiveExtra',
      'Some Miles Beyond',
      'number',
      orZero(g, 'extraOrZero', 'Extra Miles or Zero', 'extraTenths.result'),
      0
    )
  ]);
  const nonCovered = select(
    g,
    'nonCovered',
    'Extra Miles When Farther by Choice',
    'number',
    hasExtra,
    'extraTenths.result'
  );
  g.ret('return');
  g.wire(
    select(
      g,
      'covered',
      'Closest Facility Miles When Farther by Choice, Else Loaded Miles',
      'number',
      hasExtra,
      'closest.result',
      'entry.loadedMiles'
    ),
    'return.coveredMiles'
  );
  g.wire(nonCovered, 'return.nonCoveredMiles');
  const reason = select(
    g,
    'reason',
    'Reason When Farther by Choice',
    'string',
    hasExtra,
    template(
      g,
      'reasonText',
      'Non-Covered Miles Reason',
      'A0888: {miles} miles beyond the closest facility, which the patient chose to pass',
      { miles: nonCovered }
    )
  );
  g.wire(makeList(g, 'reasons', 'Non-Covered Miles Reason', 'string', [reason]), 'return.reasons');
  return g.def;
};

const chargeLines = (): GraphDef => {
  const g = rule(CHARGE_IN, [
    d(
      'lines',
      listOf(UNPRICED),
      'Lines',
      'The lines to charge, not yet priced: the base rate, then covered and non-covered mileage.'
    ),
    reasonsPin('Why each line is charged.')
  ]);
  const entry = (pins: readonly PinSpec[]) =>
    Object.fromEntries(pins.map((p) => [p.name, `entry.${p.name}` as const]));
  lookup(g, 'vehicle', 'Vehicle', VEHICLES, 'entry.transportMethod');
  node(g, 'base', 'billing.base-rate-code', 'Base Rate Code', {
    ...entry(SERVICE_IN),
    vehicle: 'vehicle.value'
  });
  node(
    g,
    'modifiers',
    'billing.line-modifiers',
    'Line Modifiers',
    entry([CLASSIFICATION_IN, ORIGIN_IN, DESTINATION_IN, PATIENTS_IN])
  );
  node(
    g,
    'miles',
    'billing.covered-miles',
    'Covered Miles',
    entry([LOADED_MILES_IN, TRANSPORT_REASON_IN, CLOSEST_MILES_IN])
  );
  const line = (id: string, label: string, lineCode: Port, units: Port | number) => {
    node(
      g,
      id,
      'std.object.make',
      label,
      {
        code: lineCode,
        modifiers: 'modifiers.modifiers',
        units: typeof units === 'number' ? fixed(units) : units
      },
      { fields: LINE_FIELDS }
    );
    return `${id}.object` as const;
  };
  const transported = isIn(
    g,
    'transported',
    'Transported',
    'tripClassification',
    'entry.classification',
    codes(g, 'transports', 'Kinds of Transport', 'tripClassification', TRANSPORTS)
  );
  const billsMiles = (id: string, label: string, miles: Port) =>
    allOf(g, id, label, [
      transported,
      greaterThan(
        g,
        `${id}Some`,
        `Some ${label}`,
        'number',
        orZero(g, `${id}OrZero`, `${label} or Zero`, miles),
        0
      )
    ]);
  lookup(g, 'mileageCode', 'Mileage Code', MILEAGE_CODES, 'vehicle.value');
  const coveredBilled = billsMiles('coveredBilled', 'Covered Miles', 'miles.coveredMiles');
  node(
    g,
    'nonCoveredCode',
    'std.value',
    'Non-Covered Mileage Code',
    {},
    {
      type: CODE.hcpcs,
      value: 'A0888'
    }
  );
  const nonCoveredBilled = billsMiles(
    'nonCoveredBilled',
    'Non-Covered Miles',
    'miles.nonCoveredMiles'
  );
  const mileageReason = select(
    g,
    'mileageReason',
    'Mileage Reason When Transported',
    'string',
    coveredBilled,
    template(g, 'mileageText', 'Mileage Reason', 'Mileage {code}: {miles} miles', {
      code: 'mileageCode.value',
      miles: 'miles.coveredMiles'
    })
  );
  g.ret('return');
  g.wire(
    makeList(g, 'lines', 'Lines to Charge', UNPRICED, [
      line('baseLine', 'Base Rate Line', 'base.code', 1),
      select(
        g,
        'mileage',
        'Mileage When Transported',
        UNPRICED,
        coveredBilled,
        line('mileageLine', 'Mileage Line', 'mileageCode.value', 'miles.coveredMiles')
      ),
      select(
        g,
        'nonCovered',
        'Non-Covered Mileage When Farther by Choice',
        UNPRICED,
        nonCoveredBilled,
        line(
          'nonCoveredLine',
          'Non-Covered Mileage Line',
          'nonCoveredCode.value',
          'miles.nonCoveredMiles'
        )
      )
    ]),
    'return.lines'
  );
  g.wire(
    joinLists(g, 'reasons', 'Reasons for the Lines', 'string', [
      'base.reasons',
      'modifiers.reasons',
      makeList(g, 'mileageReasons', 'Mileage Reason Given', 'string', [mileageReason]),
      'miles.reasons'
    ]),
    'return.reasons'
  );
  return g.def;
};

const priceLine = (): GraphDef => {
  const g = stage(
    [d('line', UNPRICED, 'Line', 'The line to price: its code, modifiers and units.'), PAYER_IN],
    [
      d('line', T.chargeLine, 'Charge Line', 'The line with its price.'),
      d('reason', 'string', 'Reason', 'Why the line has no price, when it has none.', true)
    ],
    { priced: exit('Priced', 'The line has its price, or none when the code has no fee.') }
  );
  node(g, 'parts', 'std.object.break', 'Line', { object: 'entry.line' }, { fields: LINE_FIELDS });
  node(g, 'fee', 'fee.find', 'Find Fee', { code: 'parts.code', payerId: 'entry.payerId' });
  node(g, 'total', 'std.math.multiply', 'Fee Times Units', {
    a: 'fee.unitCents',
    b: 'parts.units'
  });
  node(g, 'cents', 'std.math.round', 'To the Cent', { value: 'total.result' });
  const lineOf = (id: string, label: string, priced: boolean) =>
    node(g, id, 'charge-line.make', label, {
      code: 'parts.code',
      modifiers: 'parts.modifiers',
      units: 'parts.units',
      unitCents: priced ? 'fee.unitCents' : fixed(0),
      totalCents: priced ? 'cents.result' : fixed(0)
    });
  lineOf('priced', 'Priced Line', true);
  lineOf('unpriced', 'Line Without a Fee', false);
  g.ret('withFee', 'priced');
  g.ret('withoutFee', 'priced');
  g.wire('entry.exec', 'fee.exec');
  g.wire('fee.found', 'withFee.exec');
  g.wire('priced.line', 'withFee.line');
  g.wire('fee.notFound', 'withoutFee.exec');
  g.wire('unpriced.line', 'withoutFee.line');
  g.wire(
    template(g, 'noFee', 'No Fee Reason', 'No fee for {code}', { code: 'parts.code' }),
    'withoutFee.reason'
  );
  return g.def;
};

const assignCharges = (): GraphDef => {
  const g = stage(
    [...CHARGE_IN, PAYER_IN],
    [
      d('lines', listOf(T.chargeLine), 'Charge Lines', 'Every line, priced.'),
      d('totalCents', 'integer', 'Total', 'The total charge, in cents.'),
      reasonsPin('Why each line is charged, and any line that has no fee.')
    ],
    { charged: exit('Charged', 'Every line is priced, or has a reason it is not.') },
    [
      { name: 'lines', type: listOf(T.chargeLine), default: [] },
      { name: 'reasons', type: listOf('string'), default: [] }
    ]
  );
  node(
    g,
    'toCharge',
    'billing.charge-lines',
    'Charge Lines',
    Object.fromEntries(CHARGE_IN.map((p) => [p.name, `entry.${p.name}` as const]))
  );
  node(g, 'each', 'std.flow.for-each', 'Each Line', { list: 'toCharge.lines' }, { type: UNPRICED });
  node(g, 'price', 'billing.price-line', 'Price Line', {
    line: 'each.item',
    payerId: 'entry.payerId'
  });
  node(g, 'keep', 'std.var.append', 'Keep the Line', { item: 'price.line' }, { name: 'lines' });
  node(
    g,
    'note',
    'std.var.append',
    'Keep the Reason',
    { item: 'price.reason' },
    {
      name: 'reasons'
    }
  );
  node(g, 'kept', 'std.var.get', 'Lines', {}, { name: 'lines' });
  node(g, 'noted', 'std.var.get', 'Reasons', {}, { name: 'reasons' });
  node(
    g,
    'given',
    'std.list.compact',
    'Fee Reasons Given',
    { list: 'noted.value' },
    {
      type: 'string'
    }
  );
  node(g, 'totals', 'std.list.pluck', 'Line Totals', {
    list: 'kept.value',
    field: fixed('totalCents')
  });
  node(g, 'sum', 'std.math.sum', 'Total Charge', { values: 'totals.list' });
  g.ret('return', 'charged');
  g.wire('entry.exec', 'each.exec');
  g.wire('each.body', 'price.exec');
  g.wire('price.priced', 'keep.exec');
  g.wire('keep.then', 'note.exec');
  g.wire('each.completed', 'return.exec');
  g.wire('kept.value', 'return.lines');
  g.wire('sum.result', 'return.totalCents');
  g.wire(
    joinLists(g, 'reasons', 'Line and Fee Reasons', 'string', ['toCharge.reasons', 'given.list']),
    'return.reasons'
  );
  return g.def;
};

export const chargeGraphs: SeedGraph[] = [
  asRule(
    'billing.origin-letter',
    'Origin Letter',
    'The origin letter of the modifier: from where the patient was picked up, else from the type of service, the first that holds.',
    originLetter()
  ),
  asRule(
    'billing.origin-and-destination',
    'Origin and Destination',
    'The origin and destination letters of the modifier: the origin from the Origin Letter rule, the destination from the type of destination (Destination Letters table). Neither when either is unknown.',
    originAndDestination()
  ),
  asRule(
    'billing.base-rate-code',
    'Base Rate Code',
    'The HCPCS code of the trip: A0998 when treated without transport, else the Base Rate Codes table by the aircraft, or for ground by level of service and emergency; BLS when the patient was pronounced dead before loading.',
    baseRateCode()
  ),
  asRule(
    'billing.line-modifiers',
    'Line Modifiers',
    'The modifiers of every line: the origin and destination letters, then QL when the patient was pronounced dead before loading and GM when more than one patient was transported.',
    lineModifiers()
  ),
  asRule(
    'billing.covered-miles',
    'Covered Miles',
    'Splits the loaded miles when the patient chose a facility farther than the closest one (transport reason B or C): miles to the closest facility are covered, the rest are billed as non-covered A0888.',
    coveredMiles()
  ),
  asRule(
    'billing.charge-lines',
    'Charge Lines',
    'The lines to charge: the base rate, then the mileage code of the vehicle (Mileage Codes table) for the covered miles of a transport and A0888 for any non-covered miles, each with the line modifiers. Override it to add a charge of your own.',
    chargeLines()
  ),
  asStage(
    'billing.price-line',
    'Price Line',
    'Prices one line at the fee of the payer, else the standard fee, times its units, to the cent; a line whose code has no fee is priced at nothing, with the reason.',
    priceLine()
  ),
  asStage(
    'billing.assign-charges',
    'Assign Charges',
    'The priced charge lines of a claim, their total, and why each line is charged.',
    assignCharges()
  )
];
