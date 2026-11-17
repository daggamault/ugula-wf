import type { GraphDef, Json } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  breakRecord,
  codeTable,
  condition,
  d,
  ENCOUNTER,
  exit,
  firstThatHolds,
  fixed,
  LOCATION,
  listOf,
  lookup,
  makeList,
  type Port,
  rule,
  select,
  stage,
  T
} from './shared.ts';

const HCPCS = { code: 'hcpcs' } as const;

const MODIFIER = { code: 'modifier' } as const;

const PAYER_ID = { id: 'payer' } as const;

const UNPRICED = {
  object: { code: HCPCS, modifiers: listOf(MODIFIER), units: 'number' }
} as const;

const DESTINATION_LETTERS = codeTable(
  'billing.destination-letters',
  'Destination Letters',
  'The destination letter of the origin and destination modifier for each type of destination (eDisposition.21).',
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

const originAndDestination = (): GraphDef => {
  const g = rule(
    [d('encounter', T.encounter, 'Encounter', 'The encounter, with where it started and ended.')],
    [
      d(
        'originCode',
        'string',
        'Origin',
        'The origin letter, or nothing when either is unknown.',
        true
      ),
      d(
        'destinationCode',
        'string',
        'Destination',
        'The destination letter, or nothing when either is unknown.',
        true
      ),
      d('reasons', listOf('string'), 'Reasons', 'Why the origin letter was chosen.')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'pickup', 'Pickup', LOCATION, 'trip.pickup');
  breakRecord(g, 'destination', 'Destination', LOCATION, 'trip.destination');
  const place = (id: string, label: string, prefix: string) =>
    condition(g, id, label, { pickupType: ['string', 'pickup.type'] }, [
      { field: 'pickupType', op: 'startsWith', value: prefix }
    ]);
  const service = (id: string, label: string, types: string[]) =>
    condition(g, id, label, { serviceType: ['string', 'trip.serviceType'] }, [
      { field: 'serviceType', op: 'oneOf', value: types }
    ]);
  const origins = [
    {
      id: 'home',
      letter: 'R',
      label: 'Picked Up at Home',
      when: place('atHome', 'Picked Up at Home', 'Y92.0')
    },
    {
      id: 'institution',
      letter: 'E',
      label: 'Picked Up at a Residential Institution',
      when: place('atInstitution', 'Picked Up at a Residential Institution', 'Y92.1')
    },
    {
      id: 'hospital',
      letter: 'H',
      label: 'Picked Up at a Hospital',
      when: place('atHospital', 'Picked Up at a Hospital', 'Y92.23')
    },
    {
      id: 'office',
      letter: 'P',
      label: "Picked Up at a Physician's Office",
      when: place('atOffice', "Picked Up at a Physician's Office", 'Y92.53')
    },
    {
      id: 'interfacility',
      letter: 'H',
      label: 'Leaving a Hospital',
      when: service('leavingHospital', 'Leaving a Hospital', ['2205005', '2205015'])
    },
    {
      id: 'careFacility',
      letter: 'E',
      label: 'Leaving a Care Facility',
      when: service('leavingCare', 'Leaving a Care Facility', ['2205017', '2205019'])
    },
    {
      id: 'scene',
      letter: 'S',
      label: 'Emergency Response to a Scene',
      when: service('atScene', 'Emergency Response to a Scene', ['2205001', '2205003', '2205009'])
    }
  ];
  const origin = firstThatHolds(
    g,
    'origin',
    'Origin Letter',
    'string',
    origins.map((o) => ({
      id: `${o.id}Letter`,
      label: `${o.letter} When ${o.label}`,
      when: o.when,
      value: fixed(o.letter)
    })),
    fixed(null)
  );
  lookup(g, 'destinationLetter', 'Destination Letter', DESTINATION_LETTERS, 'destination.type');
  const both = condition(
    g,
    'both',
    'Both Letters Known',
    { origin: ['string', origin], destination: ['string', 'destinationLetter.value'] },
    [
      { field: 'origin', op: 'present' },
      { field: 'destination', op: 'present' }
    ]
  );
  g.ret('return');
  g.wire(
    select(g, 'originCode', 'Origin When Both Known', both, origin, fixed(null)),
    'return.originCode'
  );
  g.wire(
    select(
      g,
      'destinationCode',
      'Destination When Both Known',
      both,
      'destinationLetter.value',
      fixed(null)
    ),
    'return.destinationCode'
  );
  const reason = firstThatHolds(
    g,
    'originReason',
    'Why That Origin',
    'string',
    origins.map((o) => ({
      id: `${o.id}Reason`,
      label: `Reason When ${o.label}`,
      when: o.when,
      value: fixed(`Origin ${o.letter}: ${o.label.toLowerCase()}`)
    })),
    fixed(null)
  );
  const applied = select(g, 'reasonApplied', 'Reason When Both Known', both, reason, fixed(null));
  const listed = makeList(g, 'reasonListed', 'Origin Reason or Nothing', 'string', [applied]);
  g.add('reasons', 'std.list.compact', { label: 'Origin Reason' });
  g.wire(listed, 'reasons.list');
  g.wire('reasons.list', 'return.reasons');
  return g.def;
};

const BASE_RATES = codeTable(
  'billing.base-rate-codes',
  'Base Rate Codes',
  'The HCPCS base rate code for each level of service, emergency or not.',
  {
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

const SERVICE_IN = [
  d('classification', 'string', 'Classification', 'What kind of trip it was.'),
  d('level', 'string', 'Level of Service', 'BLS, ALS1, ALS2 or SCT.'),
  d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.')
];

const baseRateCode = (): GraphDef => {
  const g = rule(SERVICE_IN, [
    d('code', HCPCS, 'Base Rate Code', 'The HCPCS code of the trip itself.')
  ]);
  const kind = select(
    g,
    'kind',
    'Emergency or Not',
    'entry.emergency',
    fixed('Emergency'),
    fixed('Non-Emergency')
  );
  g.add('key', 'std.text.template', {
    label: 'Level and Kind',
    config: { template: '{level} {kind}' }
  });
  g.wire('entry.level', 'key.level');
  g.wire(kind, 'key.kind');
  lookup(g, 'rate', 'Base Rate Codes', BASE_RATES, 'key.text');
  const noTransport = condition(
    g,
    'noTransport',
    'Treated Without Transport',
    { classification: ['string', 'entry.classification'] },
    [{ field: 'classification', op: 'is', value: 'treatNoTransport' }]
  );
  const code = select(
    g,
    'code',
    'A0998 Without Transport, Else the Base Rate',
    noTransport,
    fixed('A0998'),
    'rate.value'
  );
  g.add('asCode', 'std.convert.to-code', { label: 'As a HCPCS Code', config: { kind: 'hcpcs' } });
  g.wire(code, 'asCode.text');
  g.ret('return');
  g.wire('asCode.code', 'return.code');
  return g.def;
};

const chargeLines = (): GraphDef => {
  const g = rule(
    [
      ...SERVICE_IN,
      d('loadedMiles', 'number', 'Loaded Miles', 'Miles with the patient on board.', true),
      d('originCode', 'string', 'Origin', 'The origin letter.', true),
      d('destinationCode', 'string', 'Destination', 'The destination letter.', true)
    ],
    [
      d(
        'lines',
        listOf(UNPRICED),
        'Lines',
        'The lines to charge, not yet priced: the base rate, then mileage.'
      )
    ]
  );
  g.add('base', 'billing.base-rate-code', { label: 'Base Rate Code' });
  for (const pin of ['classification', 'level', 'emergency']) g.wire(`entry.${pin}`, `base.${pin}`);
  g.add('letters', 'std.text.template', {
    label: 'Origin Then Destination',
    config: { template: '{origin}{destination}' }
  });
  g.wire('entry.originCode', 'letters.origin');
  g.wire('entry.destinationCode', 'letters.destination');
  g.add('modifier', 'std.convert.to-code', {
    label: 'As a Modifier',
    config: { kind: 'modifier' }
  });
  g.wire('letters.text', 'modifier.text');
  const listed = makeList(g, 'listed', 'Origin and Destination Modifier', MODIFIER, [
    'modifier.code'
  ]);
  g.add('modifiers', 'std.list.compact', { label: 'Modifiers' });
  g.wire(listed, 'modifiers.list');
  const line = (id: string, label: string, code: Port, units: Port | { value: Json }) => {
    g.add(id, 'std.object.make', {
      label,
      config: {
        fields: [
          { name: 'code', type: HCPCS },
          { name: 'modifiers', type: listOf(MODIFIER) },
          { name: 'units', type: 'number' }
        ]
      } as Json,
      ...(typeof units === 'string' ? {} : { values: { units: units.value } })
    });
    g.wire(code, `${id}.code`);
    g.wire('modifiers.list', `${id}.modifiers`);
    if (typeof units === 'string') g.wire(units, `${id}.units`);
    return `${id}.object` as const;
  };
  const baseLine = line('baseLine', 'Base Rate Line', 'base.code', { value: 1 });
  g.add('mileageCode', 'std.value', {
    label: 'Mileage Code',
    config: { type: HCPCS, value: 'A0425' }
  });
  const mileageLine = line('mileageLine', 'Mileage Line', 'mileageCode.value', 'entry.loadedMiles');
  const billsMiles = condition(
    g,
    'billsMiles',
    'Transported With Miles',
    {
      classification: ['string', 'entry.classification'],
      loadedMiles: ['number', 'entry.loadedMiles']
    },
    [
      { field: 'classification', op: 'isNot', value: 'treatNoTransport' },
      { field: 'loadedMiles', op: 'gt', value: 0 }
    ]
  );
  const mileage = select(
    g,
    'mileage',
    'Mileage When Transported',
    billsMiles,
    mileageLine,
    fixed(null)
  );
  const all = makeList(g, 'all', 'Base Rate, Then Mileage', UNPRICED, [baseLine, mileage]);
  g.add('lines', 'std.list.compact', { label: 'Lines to Charge' });
  g.wire(all, 'lines.list');
  g.ret('return');
  g.wire('lines.list', 'return.lines');
  return g.def;
};

const priceLine = (): GraphDef => {
  const g = stage(
    [
      d('line', UNPRICED, 'Line', 'The line to price: its code, modifiers and units.'),
      d('payerId', PAYER_ID, 'Payer', 'The payer billed first, for its own fees.', true)
    ],
    [
      d('line', T.chargeLine, 'Charge Line', 'The line with its price.'),
      d('reason', 'string', 'Reason', 'Why the line has no price, when it has none.', true)
    ],
    { priced: exit('Priced', 'The line has its price, or none when the code has no fee.') }
  );
  g.add('parts', 'std.object.break', {
    label: 'Line',
    config: {
      fields: [
        { name: 'code', type: HCPCS },
        { name: 'modifiers', type: listOf(MODIFIER) },
        { name: 'units', type: 'number' }
      ]
    } as Json
  });
  g.wire('entry.line', 'parts.object');
  g.add('fee', 'fee.find', { label: 'Find the Fee' });
  g.add('total', 'std.math.multiply', { label: 'Fee Times Units' });
  g.add('cents', 'std.math.round', { label: 'To the Cent' });
  g.add('priced', 'charge-line.make', { label: 'Priced Line' });
  g.add('unpriced', 'charge-line.make', {
    label: 'Line Without a Fee',
    values: { unitCents: 0, totalCents: 0 }
  });
  g.add('noFee', 'std.text.template', {
    label: 'No Fee Reason',
    config: { template: 'No fee for {code}' }
  });
  g.ret('withFee', 'priced');
  g.ret('withoutFee', 'priced');
  g.wire('entry.exec', 'fee.exec');
  g.wire('parts.code', 'fee.code', 'priced.code', 'unpriced.code', 'noFee.code');
  g.wire('entry.payerId', 'fee.payerId');
  g.wire('fee.unitCents', 'total.a', 'priced.unitCents');
  g.wire('parts.units', 'total.b', 'priced.units', 'unpriced.units');
  g.wire('parts.modifiers', 'priced.modifiers', 'unpriced.modifiers');
  g.wire('total.result', 'cents.value');
  g.wire('cents.result', 'priced.totalCents');
  g.wire('fee.found', 'withFee.exec');
  g.wire('priced.line', 'withFee.line');
  g.wire('fee.notFound', 'withoutFee.exec');
  g.wire('unpriced.line', 'withoutFee.line');
  g.wire('noFee.text', 'withoutFee.reason');
  return g.def;
};

const assignCharges = (): GraphDef => {
  const g = stage(
    [
      ...SERVICE_IN,
      d('loadedMiles', 'number', 'Loaded Miles', 'Miles with the patient on board.', true),
      d('originCode', 'string', 'Origin', 'The origin letter.', true),
      d('destinationCode', 'string', 'Destination', 'The destination letter.', true),
      d('payerId', PAYER_ID, 'Payer', 'The payer billed first, for its own fees.', true)
    ],
    [
      d('lines', listOf(T.chargeLine), 'Charge Lines', 'Every line, priced.'),
      d('totalCents', 'integer', 'Total', 'The total charge, in cents.'),
      d('reasons', listOf('string'), 'Reasons', 'Lines that have no fee.')
    ],
    { charged: exit('Charged', 'Every line is priced, or has a reason it is not.') },
    [
      { name: 'lines', type: listOf(T.chargeLine), default: [] },
      { name: 'reasons', type: listOf('string'), default: [] }
    ]
  );
  g.add('toCharge', 'billing.charge-lines', { label: 'Charge Lines' });
  for (const pin of [
    'classification',
    'level',
    'emergency',
    'loadedMiles',
    'originCode',
    'destinationCode'
  ]) {
    g.wire(`entry.${pin}`, `toCharge.${pin}`);
  }
  g.add('each', 'std.flow.for-each', { label: 'Each Line' });
  g.add('price', 'billing.price-line', { label: 'Price Line' });
  g.add('keep', 'std.var.append', { label: 'Keep the Line', config: { name: 'lines' } });
  g.add('note', 'std.var.append', { label: 'Keep the Reason', config: { name: 'reasons' } });
  g.add('kept', 'std.var.get', { label: 'Lines', config: { name: 'lines' } });
  g.add('noted', 'std.var.get', { label: 'Reasons', config: { name: 'reasons' } });
  g.add('given', 'std.list.compact', { label: 'Reasons Given' });
  g.add('totals', 'std.list.pluck', { label: 'Line Totals', values: { field: 'totalCents' } });
  g.add('sum', 'std.math.sum', { label: 'Total Charge' });
  g.ret('return', 'charged');
  g.wire('entry.exec', 'each.exec');
  g.wire('toCharge.lines', 'each.list');
  g.wire('each.body', 'price.exec');
  g.wire('each.item', 'price.line');
  g.wire('entry.payerId', 'price.payerId');
  g.wire('price.priced', 'keep.exec');
  g.wire('price.line', 'keep.item');
  g.wire('keep.then', 'note.exec');
  g.wire('price.reason', 'note.item');
  g.wire('each.completed', 'return.exec');
  g.wire('kept.value', 'return.lines', 'totals.list');
  g.wire('totals.list', 'sum.values');
  g.wire('sum.result', 'return.totalCents');
  g.wire('noted.value', 'given.list');
  g.wire('given.list', 'return.reasons');
  return g.def;
};

export const chargeGraphs: SeedGraph[] = [
  asRule(
    'billing.origin-and-destination',
    'Origin and Destination',
    'The origin and destination letters of the modifier: the origin from where the patient was picked up, else the type of service; the destination from the type of destination (Destination Letters table). Neither when either is unknown.',
    originAndDestination()
  ),
  asRule(
    'billing.base-rate-code',
    'Base Rate Code',
    'The HCPCS code of the trip: A0998 when treated without transport, else the Base Rate Codes table by level of service and emergency.',
    baseRateCode()
  ),
  asRule(
    'billing.charge-lines',
    'Charge Lines',
    'The lines to charge: the base rate, then A0425 for the loaded miles of a transport, each with the origin and destination modifier. Override it to add a charge of your own.',
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
    'The priced charge lines of a claim and their total.',
    assignCharges()
  )
];
