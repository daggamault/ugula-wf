import type { GraphDef, Json, PinSpec } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  type Builder,
  breakRecord,
  codeTable,
  condition,
  d,
  ENCOUNTER,
  exit,
  firstThatHolds,
  fixed,
  ID,
  joinLists,
  LOCATION,
  listOf,
  lookup,
  type Port,
  presentOf,
  rule,
  SERVICE_TYPES,
  select,
  stage,
  T
} from './shared.ts';

const HCPCS = { code: 'hcpcs' } as const;

const MODIFIER = { code: 'modifier' } as const;

const LINE_FIELDS = [
  { name: 'code', type: HCPCS },
  { name: 'modifiers', type: listOf(MODIFIER) },
  { name: 'units', type: 'number' }
] as const;

const UNPRICED = {
  object: Object.fromEntries(LINE_FIELDS.map((f) => [f.name, f.type]))
};

const lineRecord = (
  g: Builder,
  id: string,
  kind: 'make' | 'break',
  label: string,
  values?: Record<string, Json>
) =>
  g.add(id, `std.object.${kind}`, {
    label,
    config: { fields: LINE_FIELDS } as unknown as Json,
    ...(values ? { values } : {})
  });

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
  const service = (id: string, label: string, types: readonly string[]) =>
    condition(g, id, label, { serviceType: ['string', 'trip.serviceType'] }, [
      { field: 'serviceType', op: 'oneOf', value: [...types] }
    ]);
  const origins = [
    ['home', 'R', 'Picked Up at Home', place('atHome', 'Picked Up at Home', 'Y92.0')],
    [
      'institution',
      'E',
      'Picked Up at a Residential Institution',
      place('atInstitution', 'Picked Up at a Residential Institution', 'Y92.1')
    ],
    [
      'hospital',
      'H',
      'Picked Up at a Hospital',
      place('atHospital', 'Picked Up at a Hospital', 'Y92.23')
    ],
    [
      'office',
      'P',
      "Picked Up at a Physician's Office",
      place('atOffice', "Picked Up at a Physician's Office", 'Y92.53')
    ],
    [
      'interfacility',
      'H',
      'Leaving a Hospital',
      service('leavingHospital', 'Leaving a Hospital', SERVICE_TYPES.leavingHospital)
    ],
    [
      'careFacility',
      'E',
      'Leaving a Care Facility',
      service('leavingCare', 'Leaving a Care Facility', SERVICE_TYPES.leavingCare)
    ],
    [
      'scene',
      'S',
      'Emergency Response to a Scene',
      service('atScene', 'Emergency Response to a Scene', SERVICE_TYPES.emergency)
    ]
  ] as const;
  const origin = firstThatHolds(
    g,
    'origin',
    'Origin Letter',
    'string',
    origins.map(([id, letter, label, when]) => ({
      id: `${id}Letter`,
      label: `${letter} When ${label}`,
      when,
      value: fixed(letter)
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
  const reason = firstThatHolds(
    g,
    'originReason',
    'Why That Origin',
    'string',
    origins.map(([id, letter, label, when]) => ({
      id: `${id}Reason`,
      label: `Reason When ${label}`,
      when,
      value: fixed(`Origin ${letter}: ${label.toLowerCase()}`)
    })),
    fixed(null)
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
  g.wire(
    presentOf(g, 'reasons', 'Origin Reason', 'string', [
      select(g, 'reasonApplied', 'Reason When Both Known', both, reason, fixed(null))
    ]),
    'return.reasons'
  );
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

const SERVICE_IN: PinSpec[] = [
  d('classification', 'string', 'Classification', 'What kind of trip it was.'),
  d('level', 'string', 'Level of Service', 'BLS, ALS1, ALS2 or SCT.'),
  d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.')
];

const CHARGE_IN: PinSpec[] = [
  ...SERVICE_IN,
  d('loadedMiles', 'number', 'Loaded Miles', 'Miles with the patient on board.', true),
  d('originCode', 'string', 'Origin', 'The origin letter.', true),
  d('destinationCode', 'string', 'Destination', 'The destination letter.', true)
];

const PAYER_IN = d('payerId', ID.payer, 'Payer', 'The payer billed first, for its own fees.', true);

const reasonsPin = (what: string) => d('reasons', listOf('string'), 'Reasons', what);

const baseRateCode = (): GraphDef => {
  const g = rule(SERVICE_IN, [
    d('code', HCPCS, 'Base Rate Code', 'The HCPCS code of the trip itself.'),
    reasonsPin('Which code was chosen and why.')
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
  g.add('rateReason', 'std.text.template', {
    label: 'Base Rate Reason',
    config: { template: 'Base rate {code}: {key}' }
  });
  g.wire(code, 'rateReason.code');
  g.wire('key.text', 'rateReason.key');
  const reason = select(
    g,
    'reason',
    'Reason for the Code',
    noTransport,
    fixed('A0998: treated without transport'),
    'rateReason.text'
  );
  g.add('asCode', 'std.convert.to-code', { label: 'As a HCPCS Code', config: { kind: 'hcpcs' } });
  g.wire(code, 'asCode.text');
  g.ret('return');
  g.wire('asCode.code', 'return.code');
  g.wire(presentOf(g, 'reasons', 'Base Rate Reason Given', 'string', [reason]), 'return.reasons');
  return g.def;
};

const chargeLines = (): GraphDef => {
  const g = rule(CHARGE_IN, [
    d(
      'lines',
      listOf(UNPRICED),
      'Lines',
      'The lines to charge, not yet priced: the base rate, then mileage.'
    ),
    reasonsPin('Why each line is charged.')
  ]);
  g.add('base', 'billing.base-rate-code', { label: 'Base Rate Code' });
  for (const pin of SERVICE_IN) g.wire(`entry.${pin.name}`, `base.${pin.name}`);
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
  const modifiers = presentOf(g, 'modifiers', 'Modifiers', MODIFIER, ['modifier.code']);
  const line = (id: string, label: string, code: Port, units: Port | number) => {
    lineRecord(g, id, 'make', label, typeof units === 'number' ? { units } : undefined);
    g.wire(code, `${id}.code`);
    g.wire(modifiers, `${id}.modifiers`);
    if (typeof units !== 'number') g.wire(units, `${id}.units`);
    return `${id}.object` as const;
  };
  g.add('mileageCode', 'std.value', {
    label: 'Mileage Code',
    config: { type: HCPCS, value: 'A0425' }
  });
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
    line('mileageLine', 'Mileage Line', 'mileageCode.value', 'entry.loadedMiles'),
    fixed(null)
  );
  g.add('mileageText', 'std.text.template', {
    label: 'Mileage Reason',
    config: { template: 'Mileage A0425: {miles} loaded miles' }
  });
  g.wire('entry.loadedMiles', 'mileageText.miles');
  const mileageReason = select(
    g,
    'mileageReason',
    'Mileage Reason When Transported',
    billsMiles,
    'mileageText.text',
    fixed(null)
  );
  g.ret('return');
  g.wire(
    presentOf(g, 'lines', 'Lines to Charge', UNPRICED, [
      line('baseLine', 'Base Rate Line', 'base.code', 1),
      mileage
    ]),
    'return.lines'
  );
  g.wire(
    joinLists(g, 'reasons', 'Reasons for the Lines', 'string', [
      'base.reasons',
      presentOf(g, 'mileageReasons', 'Mileage Reason Given', 'string', [mileageReason])
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
  lineRecord(g, 'parts', 'break', 'Line');
  g.wire('entry.line', 'parts.object');
  g.add('fee', 'fee.find', { label: 'Find Fee' });
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
  g.add('toCharge', 'billing.charge-lines', { label: 'Charge Lines' });
  for (const pin of CHARGE_IN) g.wire(`entry.${pin.name}`, `toCharge.${pin.name}`);
  g.add('each', 'std.flow.for-each', { label: 'Each Line' });
  g.add('price', 'billing.price-line', { label: 'Price Line' });
  g.add('keep', 'std.var.append', { label: 'Keep the Line', config: { name: 'lines' } });
  g.add('note', 'std.var.append', { label: 'Keep the Reason', config: { name: 'reasons' } });
  g.add('kept', 'std.var.get', { label: 'Lines', config: { name: 'lines' } });
  g.add('noted', 'std.var.get', { label: 'Reasons', config: { name: 'reasons' } });
  g.add('given', 'std.list.compact', { label: 'Fee Reasons Given' });
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
  g.wire(
    joinLists(g, 'reasons', 'Line and Fee Reasons', 'string', ['toCharge.reasons', 'given.list']),
    'return.reasons'
  );
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
    'The priced charge lines of a claim, their total, and why each line is charged.',
    assignCharges()
  )
];
