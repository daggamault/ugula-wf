import { NO_TRANSPORT_CODE, NOTE_LENGTH } from '@ugula/billing';
import type { GraphDef, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  ADDRESS_PINS,
  asRule,
  type Builder,
  condition,
  d,
  firstOf,
  fixed,
  isListed,
  joinText,
  MEDICARE_CLAIM_FILINGS,
  makeList,
  P,
  type Port,
  reasonsOf,
  rule,
  select,
  shared,
  T,
  type Test,
  template
} from './shared.ts';

const DESTINATION_REASONS = [
  { key: '4220001', value: 'A' },
  { key: '4220003', value: 'A' },
  { key: '4220011', value: 'A' },
  { key: '4220019', value: 'A' },
  { key: '4220017', value: 'B' },
  { key: '4220005', value: 'C' },
  { key: '4220021', value: 'D' }
];

const DESTINATION_LETTERS = [
  { key: '4221001', value: 'R' },
  { key: '4221003', value: 'H' },
  { key: '4221005', value: 'H' },
  { key: '4221023', value: 'H' },
  { key: '4221007', value: 'P' },
  { key: '4221021', value: 'P' },
  { key: '4221011', value: 'E' },
  { key: '4221029', value: 'E' },
  { key: '4221033', value: 'E' },
  { key: '4221015', value: 'I' },
  { key: '4221025', value: 'J' },
  { key: '4221027', value: 'D' },
  { key: '4221041', value: 'N' }
];

const DOCUMENTATION_IN = d(
  'documentation',
  T.documentation,
  'Documentation',
  'What the report documents for billing, with the transport reason as reported.'
);

const LOCATIONS_IN = d('locations', T.locations, 'Location Facts', 'Pickup and destination facts.');

const transportReason = (): GraphDef => {
  const g = rule(
    [DOCUMENTATION_IN, LOCATIONS_IN],
    [
      d(
        'transportReason',
        'string',
        'Transport Reason',
        'The CMS ambulance transport reason (CR104, A to E), or nothing.',
        true
      ),
      P.reasons('the transport reason was chosen')
    ]
  );
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('locations', 'billing.location-facts.break', { label: 'Location Facts' });
  g.add('byDestination', 'std.table.lookup', {
    label: 'Transport Reason from the Destination Reason',
    config: shared.lookup(
      'billing.transport-reason-by-destination',
      'Transport Reason by Destination Reason',
      'The CMS transport reason a reason for choosing the destination (eDisposition.20) means, used when the crew reported none.',
      { type: 'string', rows: DESTINATION_REASONS }
    )
  });
  g.add('reason', 'std.logic.coalesce', { label: 'Reported, Else from the Destination' });
  g.add('notReported', 'std.logic.is-null', { label: 'Crew Reported None' });
  g.add('noDestinationReason', 'std.logic.is-null', { label: 'Destination Gives None' });
  const fromDestination = select(
    g,
    'whyDestination',
    'Why from the Destination',
    'noDestinationReason.result',
    fixed([]),
    fixed(['From the reason for choosing the destination'])
  );
  g.ret('return');
  g.wire('entry.documentation', 'documentation.documentation');
  g.wire('entry.locations', 'locations.locations');
  g.wire('locations.destinationReason', 'byDestination.key');
  g.wire('documentation.transportReason', 'reason.value', 'notReported.value');
  g.wire('byDestination.value', 'reason.fallback', 'noDestinationReason.value');
  g.wire('reason.result', 'return.transportReason');
  g.wire(
    select(
      g,
      'reasons',
      'Why',
      'notReported.result',
      fromDestination,
      fixed(['Reported by the crew'])
    ),
    'return.reasons'
  );
  return g.def;
};

const NO_TYPE_HOSPITAL =
  'The report gives no destination type and the destination is a Medicare-certified hospital (CMS hospital list)';

const originDestination = (): GraphDef => {
  const g = rule(
    [LOCATIONS_IN, d('trip', T.trip, 'Trip Facts', 'The type of service of the trip.')],
    [
      d(
        'originDestination',
        { code: 'modifier' },
        'Origin/Destination Modifier',
        'The origin letter, then the destination letter, as one modifier.',
        true
      ),
      P.reasons('the modifier letters were chosen')
    ]
  );
  g.add('locations', 'billing.location-facts.break', { label: 'Location Facts' });
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  const place = (id: string, label: string, prefix: string) =>
    condition(g, id, label, { locationType: ['string', 'locations.pickupType'] }, [
      { field: 'locationType', op: 'startsWith', value: prefix }
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
      reason: 'Picked up at home',
      when: place('atHome', 'Picked Up at Home', 'Y92.0')
    },
    {
      id: 'institution',
      letter: 'E',
      label: 'Picked Up at a Residential Institution',
      reason: 'Picked up at a nursing home or other residential institution',
      when: place('atInstitution', 'Picked Up at a Residential Institution', 'Y92.1')
    },
    {
      id: 'hospital',
      letter: 'H',
      label: 'Picked Up at a Hospital',
      reason: 'Picked up at a hospital',
      when: place('atHospital', 'Picked Up at a Hospital', 'Y92.23')
    },
    {
      id: 'office',
      letter: 'P',
      label: "Picked Up at a Physician's Office",
      reason: "Picked up at a physician's office or clinic",
      when: place('atOffice', "Picked Up at a Physician's Office", 'Y92.53')
    },
    {
      id: 'interfacility',
      letter: 'H',
      label: 'Leaving a Hospital',
      reason: 'Leaving a hospital (interfacility)',
      when: service('interfacility', 'Leaving a Hospital', ['2205005', '2205015'])
    },
    {
      id: 'careFacility',
      letter: 'E',
      label: 'Leaving a Care Facility',
      reason: 'Leaving a care facility',
      when: service('careFacility', 'Leaving a Care Facility', ['2205017', '2205019'])
    },
    {
      id: 'scene',
      letter: 'S',
      label: 'Emergency Response to a Scene',
      reason: 'Emergency response to a scene',
      when: service('scene', 'Emergency Response to a Scene', ['2205001', '2205003', '2205009'])
    }
  ];
  const origin = firstOf(
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
  g.add('destination', 'std.table.lookup', {
    label: 'Destination Letter by Type',
    config: shared.lookup(
      'billing.destination-modifier',
      'Destination Modifier',
      'The destination letter of the modifier each type of destination (eDisposition.21) means.',
      { type: 'string', rows: DESTINATION_LETTERS }
    )
  });
  const hospital = condition(
    g,
    'hospital',
    'No Type, Medicare-Certified Hospital',
    {
      destinationType: ['string', 'locations.destinationType'],
      hospital: ['boolean', 'locations.destinationHospital']
    },
    [
      { field: 'destinationType', op: 'empty' },
      { field: 'hospital', op: 'is', value: true }
    ]
  );
  g.add('destinationLetter', 'std.logic.coalesce', {
    label: 'By Type, Else H for a Hospital'
  });
  const letters = template(g, 'modifier', 'Origin Then Destination', '{origin}{destination}', {
    origin,
    destination: 'destinationLetter.result'
  });
  g.add('asModifier', 'std.convert.to-code', {
    label: 'As Modifier',
    config: { kind: 'modifier' }
  });
  g.ret('return');
  g.wire('entry.locations', 'locations.locations');
  g.wire('entry.trip', 'trip.trip');
  g.wire('locations.destinationType', 'destination.key');
  g.wire('destination.value', 'destinationLetter.value');
  g.wire(
    select(g, 'hospitalDestination', 'H for a Hospital', hospital, fixed('H')),
    'destinationLetter.fallback'
  );
  g.wire(letters, 'asModifier.text');
  g.wire('asModifier.code', 'return.originDestination');
  g.wire(
    reasonsOf(g, 'reasons', 'Why', [
      ...origins.map((o) => ({
        id: `${o.id}Why`,
        label: `${o.label} Reason`,
        when: o.when,
        reason: o.reason
      })),
      {
        id: 'destinationWhy',
        label: 'Hospital Without a Type',
        when: hospital,
        reason: NO_TYPE_HOSPITAL
      }
    ]),
    'return.reasons'
  );
  return g.def;
};

const CLAIM_OUT = d('claim', T.claim, 'Claim', 'The claim to save on the draft.');

const mapClaim = (): GraphDef => {
  const g = rule(
    [
      P.facts(),
      P.classification(),
      P.patient(),
      P.coverages(),
      P.service(),
      d('lines', T.lines, 'Priced Lines', 'The priced charge lines.'),
      d('totalCents', 'integer', 'Total (Cents)', 'The claim total.'),
      P.report()
    ],
    [CLAIM_OUT]
  );
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.add('locations', 'billing.location-facts.break', { label: 'Location Facts' });
  g.add('diagnoses', 'billing.assign-diagnoses', { label: 'Assign Diagnoses' });
  g.add('modifier', 'billing.origin-destination', { label: 'Origin/Destination Modifiers' });
  g.add('reason', 'billing.transport-reason', { label: 'Transport Reason' });
  g.add('documentation', 'std.object.set', {
    label: 'Documentation with the Transport Reason',
    values: { path: 'transportReason' }
  });
  g.add('patient', 'billing.patient.break', { label: 'Patient' });
  g.add('service', 'billing.service.break', { label: 'Service' });
  g.add('claim', 'billing.claim.make', { label: 'Claim' });
  g.ret('return');
  g.wire('entry.facts', 'facts.facts', 'diagnoses.facts');
  g.wire('facts.trip', 'trip.trip', 'modifier.trip');
  g.wire('facts.locations', 'locations.locations', 'modifier.locations', 'reason.locations');
  g.wire('facts.documentation', 'reason.documentation', 'documentation.object');
  g.wire('reason.transportReason', 'documentation.value');
  g.wire('documentation.object', 'claim.documentation');
  g.wire('entry.patient', 'patient.patient');
  g.wire('entry.service', 'service.service');
  g.wire('trip.pcrNumber', 'claim.pcrNumber');
  g.wire('trip.serviceDate', 'claim.serviceDate');
  g.wire('patient.id', 'claim.patientId');
  g.wire('locations.pickup', 'claim.pickup');
  g.wire('locations.destination', 'claim.destination');
  g.wire('diagnoses.diagnoses', 'claim.diagnoses');
  g.wire('modifier.originDestination', 'claim.originDestination');
  for (const pin of ['level', 'emergency', 'loadedMiles', 'deceased', 'nonCoveredMiles']) {
    g.wire(`service.${pin}`, `claim.${pin}`);
  }
  for (const pin of ['classification', 'coverages', 'lines', 'totalCents', 'report']) {
    g.wire(`entry.${pin}`, `claim.${pin}`);
  }
  g.wire('claim.claim', 'return.claim');
  return g.def;
};

const BY_EMERGENCY = 'Not documented, so by emergency status';

const ambulanceConditions = (): GraphDef => {
  const g = rule(
    [
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.', true),
      d(
        'documented',
        { list: 'string' },
        'Documented Conditions',
        'The ambulance condition codes the report documents.',
        true
      )
    ],
    [
      d(
        'codes',
        { list: 'string' },
        'Condition Codes',
        'The CRC ambulance condition codes to bill.'
      ),
      P.reasons('these conditions were billed')
    ]
  );
  const emergency = condition(
    g,
    'emergency',
    'Emergency Transport',
    { emergency: ['boolean', 'entry.emergency'] },
    [{ field: 'emergency', op: 'is', value: true }]
  );
  const documented = condition(
    g,
    'documented',
    'Conditions Documented',
    { documented: [{ list: 'string' }, 'entry.documented'] },
    [{ field: 'documented', op: 'present' }]
  );
  g.ret('return');
  g.wire(
    select(
      g,
      'codes',
      'Documented Conditions, Else by Emergency',
      documented,
      'entry.documented',
      select(
        g,
        'byEmergency',
        '06 for an Emergency, Else None',
        emergency,
        fixed(['06']),
        fixed([])
      )
    ),
    'return.codes'
  );
  g.wire(
    select(
      g,
      'reasons',
      'Why',
      documented,
      fixed(['Documented on the report']),
      select(
        g,
        'whyByEmergency',
        'Why by Emergency',
        emergency,
        fixed([BY_EMERGENCY, 'Transported in an emergency situation']),
        fixed([BY_EMERGENCY])
      )
    ),
    'return.reasons'
  );
  return g.def;
};

const MAX_LINE_MODIFIERS = 4;

const flagIn = (name: string, label: string, description: string) =>
  d(name, 'boolean', label, description, true);

const ORIGIN_DESTINATION_IN = d(
  'originDestination',
  { code: 'modifier' },
  'Origin/Destination Modifier',
  'The origin and destination letters.',
  true
);

const CLAIM_FILING_IN = d(
  'claimFiling',
  'string',
  'Claim Filing Indicator',
  'The claim filing indicator of the payer billed.',
  true
);

const pronouncedDead = (g: Builder, deceased: Port) =>
  condition(g, 'dead', 'Pronounced Dead Before Loading', { deceased: ['boolean', deceased] }, [
    { field: 'deceased', op: 'is', value: true }
  ]);

const severalPatients = (g: Builder, patientCount: Port) =>
  condition(
    g,
    'several',
    'Several Patients on the Trip',
    { patientCount: ['integer', patientCount] },
    [{ field: 'patientCount', op: 'gte', value: 2 }]
  );

const milesPastNearest = (g: Builder, miles: Port) =>
  condition(
    g,
    'pastNearest',
    'Miles Past the Nearest Facility',
    { nonCoveredMiles: ['number', miles] },
    [{ field: 'nonCoveredMiles', op: 'gt', value: 0 }]
  );

const lineModifiers = (): GraphDef => {
  const g = rule(
    [
      ORIGIN_DESTINATION_IN,
      CLAIM_FILING_IN,
      d(
        'codes',
        { list: { code: 'hcpcs' } },
        'Line Codes',
        'The HCPCS codes on the claim, line by line.'
      ),
      flagIn('emergency', 'Emergency', 'Whether the trip is billed as an emergency.'),
      flagIn('deceased', 'Pronounced Dead', 'The patient was pronounced dead before loading.'),
      d(
        'patientCount',
        'integer',
        'Patients Transported',
        'How many patients the trip transported.',
        true
      ),
      flagIn('abnOnFile', 'ABN on File', 'An Advance Beneficiary Notice is on file.'),
      flagIn(
        'denialExpected',
        'Denial Expected',
        'Medicare is expected to deny the transport as not reasonable and necessary.'
      )
    ],
    [
      d(
        'modifiers',
        { list: { list: 'string' } },
        'Modifiers',
        'The modifiers of each service line, in line order, at most four each.'
      ),
      P.reasons('these modifiers were added')
    ]
  );
  const dead = pronouncedDead(g, 'entry.deceased');
  const several = severalPatients(g, 'entry.patientCount');
  isListed(g, 'medicare', 'Medicare Payer', MEDICARE_CLAIM_FILINGS, 'entry.claimFiling');
  const medicare = (
    id: string,
    label: string,
    inputs: Record<string, [ValueType, Port]>,
    rules: Test[]
  ) =>
    condition(g, id, label, { medicare: ['boolean', 'medicare.found'], ...inputs }, [
      { field: 'medicare', op: 'is', value: true },
      ...rules
    ]);
  const coverages = [
    {
      id: 'gy',
      modifier: 'GY',
      label: 'GY When Not Covered',
      reason: 'Medicare does not cover treatment without transport',
      when: medicare(
        'notCovered',
        'Medicare, Treatment Without Transport',
        { codes: [{ list: { code: 'hcpcs' } }, 'entry.codes'] },
        [{ field: 'codes', op: 'is', value: NO_TRANSPORT_CODE }]
      )
    },
    {
      id: 'ga',
      modifier: 'GA',
      label: 'GA with an ABN',
      reason: 'ABN on file for a non-emergency Medicare transport',
      when: medicare(
        'abn',
        'Medicare, ABN on File, Not an Emergency',
        {
          abnOnFile: ['boolean', 'entry.abnOnFile'],
          emergency: ['boolean', 'entry.emergency']
        },
        [
          { field: 'abnOnFile', op: 'is', value: true },
          { field: 'emergency', op: 'is', value: false }
        ]
      )
    },
    {
      id: 'gz',
      modifier: 'GZ',
      label: 'GZ When a Denial Is Expected',
      reason: 'Medicare is expected to deny and no ABN is on file',
      when: medicare(
        'denial',
        'Medicare Denial Expected',
        { denialExpected: ['boolean', 'entry.denialExpected'] },
        [{ field: 'denialExpected', op: 'is', value: true }]
      )
    }
  ];
  const coverage = firstOf(
    g,
    'coverage',
    'Liability Modifier',
    'string',
    coverages.map((c) => ({
      id: c.id,
      label: c.label,
      when: c.when,
      value: fixed(c.modifier)
    })),
    fixed(null)
  );
  g.add('lines', 'std.list.map-rule', {
    label: 'Modifiers of Each Line',
    config: { rule: 'billing.modifiers-of-one-line', version: 1, item: 'code' }
  });
  g.add('codeReasons', 'std.list.flatten', { label: 'Why Each Line Code' });
  g.add('reasons', 'std.list.join', { label: 'Why', config: { count: 2, type: 'string' } });
  g.ret('return');
  g.wire('entry.codes', 'lines.list');
  g.wire('entry.claimFiling', 'lines.claimFiling');
  g.wire('entry.originDestination', 'lines.originDestination');
  g.wire(select(g, 'leading', 'QL When Pronounced Dead', dead, fixed('QL')), 'lines.leading');
  g.wire(select(g, 'added', 'GM When Several Patients', several, fixed('GM')), 'lines.added');
  g.wire(coverage, 'lines.coverage');
  g.wire('lines.modifiers', 'return.modifiers');
  g.wire('lines.reasons', 'codeReasons.list');
  g.wire(
    reasonsOf(g, 'tripWhy', 'Why for the Trip and Payer', [
      {
        id: 'deadWhy',
        label: 'Pronounced Dead',
        when: dead,
        reason: 'Pronounced dead before loading'
      },
      {
        id: 'severalWhy',
        label: 'Several Patients',
        when: several,
        reason: 'Several patients transported on one trip'
      },
      ...coverages.map((c) => ({
        id: `${c.id}Why`,
        label: c.label,
        when: c.when,
        reason: c.reason
      }))
    ]),
    'reasons.list1'
  );
  g.wire('codeReasons.list', 'reasons.list2');
  g.wire('reasons.list', 'return.reasons');
  return g.def;
};

const modifierIn = (name: string, label: string, description: string) =>
  d(name, 'string', label, description, true);

const oneLineModifiers = (): GraphDef => {
  const g = rule(
    [
      d('code', { code: 'hcpcs' }, 'Line Code', 'The HCPCS code of the line.', true),
      CLAIM_FILING_IN,
      modifierIn(
        'leading',
        'Replacement Modifier',
        'The modifier in place of the origin/destination letters, such as QL.'
      ),
      ORIGIN_DESTINATION_IN,
      modifierIn('added', 'Trip Modifier', 'The modifier the trip adds to every line, such as GM.'),
      modifierIn('coverage', 'Liability Modifier', 'The liability modifier: GY, GA or GZ.')
    ],
    [
      d('modifiers', { list: 'string' }, 'Modifiers', 'The modifiers of the line, at most four.'),
      P.reasons('the line code carries a modifier')
    ]
  );
  g.add('byCode', 'std.table.lookup', {
    label: 'Medicare Line Code Modifier',
    config: shared.lookup(
      'billing.code-modifier',
      'Line Code Modifier',
      'A modifier a single line carries because of its HCPCS code when Medicare is billed: GY on A0888 non-covered miles.',
      { type: 'string', rows: [{ key: 'A0888', value: 'GY' }] }
    )
  });
  const medicare = isListed(
    g,
    'medicare',
    'Medicare Payer',
    MEDICARE_CLAIM_FILINGS,
    'entry.claimFiling'
  );
  const codeModifier = select(
    g,
    'codeModifier',
    'Code Modifier When Medicare',
    medicare,
    'byCode.value'
  );
  g.add('leading', 'std.logic.coalesce', {
    label: 'Replacement Modifier, Else Origin/Destination'
  });
  const all = makeList(g, 'all', 'Origin/Destination, Trip, Liability and Code', 'string', [
    'leading.result',
    'entry.added',
    'entry.coverage',
    codeModifier
  ]);
  g.add('unique', 'std.list.unique', { label: 'Each Modifier Once' });
  g.add('modifiers', 'std.list.slice', {
    label: 'At Most Four',
    values: { start: 0, end: MAX_LINE_MODIFIERS }
  });
  const carries = template(g, 'carries', 'Code Carries Modifier', '[{code} carries {modifier}]', {
    code: 'entry.code',
    modifier: codeModifier
  });
  g.ret('return');
  g.wire('entry.code', 'byCode.key');
  g.wire('entry.leading', 'leading.value');
  g.wire('entry.originDestination', 'leading.fallback');
  g.wire(all, 'unique.list');
  g.wire('unique.list', 'modifiers.list');
  g.wire('modifiers.list', 'return.modifiers');
  g.wire(makeList(g, 'reasons', 'Why', 'string', [carries]), 'return.reasons');
  return g.def;
};

const SUBMISSION_IN = d('claim', T.submission, 'Claim', 'The claim as it goes to this payer.');

const CONDITIONS_IN = d(
  'conditionCodes',
  { list: 'string' },
  'Condition Codes',
  'The CRC ambulance condition codes billed.',
  true
);

const medicalNecessitySummary = (): GraphDef => {
  const g = rule(
    [
      SUBMISSION_IN,
      CONDITIONS_IN,
      d(
        'nonCoveredMiles',
        'number',
        'Non-Covered Miles',
        'The miles billed past the nearest facility (A0888).',
        true
      ),
      d(
        'deceased',
        'boolean',
        'Pronounced Dead',
        'The patient was pronounced dead before loading.'
      ),
      d('severalPatients', 'boolean', 'Several Patients', 'The trip transported several patients.'),
      d(
        'milesPastNearest',
        'boolean',
        'Miles Past the Nearest',
        'Miles were billed past the nearest facility.'
      )
    ],
    [
      d(
        'summary',
        'string',
        'Medical Necessity Summary',
        'The level and emergency, then each fact that explains the claim, cut to 80 characters.'
      )
    ]
  );
  g.add('claim', 'billing.submission.break', { label: 'Submitted Claim' });
  g.add('details', 'billing.submitted-details.break', { label: 'Claim Details' });
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('firstLine', 'std.list.first', { label: 'First Line' });
  g.add('urgency', 'std.logic.choose', {
    label: 'Emergency or Not',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { case1: 'EMERGENCY', otherwise: 'NON-EMERGENCY' }
  });
  g.add('primary', 'std.list.first', { label: 'Primary Diagnosis' });
  const text = template(
    g,
    'text',
    'Note Text',
    '{line.code} {urgency}[; {dead}][; {patients} PATIENTS TRANSPORTED][; {miles} MI PAST NEAREST FACILITY][; REASON {transportReason}][; COND {conditions}][; DX {diagnosis}]',
    {
      line: 'firstLine.item',
      urgency: 'urgency.value',
      dead: select(
        g,
        'deadText',
        'Pronounced Dead Text',
        'entry.deceased',
        fixed('PRONOUNCED DEAD BEFORE LOADING')
      ),
      patients: select(
        g,
        'severalCount',
        'Patients When Several',
        'entry.severalPatients',
        'documentation.patientCount'
      ),
      miles: select(
        g,
        'pastMiles',
        'Miles When Past the Nearest',
        'entry.milesPastNearest',
        'entry.nonCoveredMiles'
      ),
      transportReason: 'documentation.transportReason',
      conditions: joinText(g, 'conditions', 'Conditions with Spaces', ' ', 'entry.conditionCodes'),
      diagnosis: 'primary.item'
    }
  );
  g.add('summary', 'std.text.substring', {
    label: 'At Most 80 Characters',
    values: { start: 0, end: NOTE_LENGTH }
  });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
  g.wire('claim.lines', 'firstLine.list');
  g.wire('claim.emergency', 'urgency.key');
  g.wire('details.diagnoses', 'primary.list');
  g.wire(text, 'summary.text');
  g.wire('summary.result', 'return.summary');
  return g.def;
};

const narrativeNote = (): GraphDef => {
  const g = rule(
    [SUBMISSION_IN, CONDITIONS_IN],
    [
      d(
        'note',
        'string',
        'Narrative Note',
        'An 80-character medical necessity summary for the claim note (NTE ADD), or nothing.',
        true
      ),
      P.reasons('a note was or was not sent')
    ]
  );
  g.add('claim', 'billing.submission.break', { label: 'Submitted Claim' });
  g.add('details', 'billing.submitted-details.break', { label: 'Claim Details' });
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('nonCoveredLines', 'std.list.where', {
    label: 'Non-Covered Mile Lines',
    config: { field: 'code', op: 'is', value: 'A0888' }
  });
  g.add('nonCoveredUnits', 'std.list.pluck', { label: 'Their Units', values: { field: 'units' } });
  g.add('nonCovered', 'std.math.sum', { label: 'Non-Covered Miles Billed' });
  const dead = pronouncedDead(g, 'claim.deceased');
  const several = severalPatients(g, 'documentation.patientCount');
  const pastNearest = milesPastNearest(g, 'nonCovered.result');
  const send = condition(
    g,
    'send',
    'Explains QL, GM or A0888',
    {
      deceased: ['boolean', dead],
      severalPatients: ['boolean', several],
      milesPastNearest: ['boolean', pastNearest]
    },
    ['deceased', 'severalPatients', 'milesPastNearest'].map((field) => ({
      field,
      op: 'is',
      value: true
    })),
    'any'
  );
  g.add('summary', 'billing.medical-necessity-summary', { label: 'Medical Necessity Summary' });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim', 'summary.claim');
  g.wire('entry.conditionCodes', 'summary.conditionCodes');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
  g.wire('claim.lines', 'nonCoveredLines.list');
  g.wire('nonCoveredLines.list', 'nonCoveredUnits.list');
  g.wire('nonCoveredUnits.list', 'nonCovered.values');
  g.wire('nonCovered.result', 'summary.nonCoveredMiles');
  g.wire(dead, 'summary.deceased');
  g.wire(several, 'summary.severalPatients');
  g.wire(pastNearest, 'summary.milesPastNearest');
  g.wire(select(g, 'note', 'Only When Sent', send, 'summary.summary'), 'return.note');
  g.wire(
    reasonsOf(g, 'reasons', 'Why', [
      {
        id: 'deadWhy',
        label: 'Pronounced Dead',
        when: dead,
        reason: 'Explains QL: pronounced dead before loading'
      },
      {
        id: 'severalWhy',
        label: 'Several Patients',
        when: several,
        reason: 'Explains GM: several patients on one trip'
      },
      {
        id: 'pastNearestWhy',
        label: 'Miles Past the Nearest',
        when: pastNearest,
        reason: 'Explains A0888: miles past the nearest facility'
      }
    ]),
    'return.reasons'
  );
  return g.def;
};

const admissionDate = (): GraphDef => {
  const g = rule(
    [d('documentation', T.documentation, 'Documentation', 'What the claim documents.')],
    [
      d(
        'admissionDate',
        'string',
        'Admission Date',
        'The date the patient was admitted (DTP 435), when known.',
        true
      ),
      P.reasons('an admission date was or was not sent')
    ]
  );
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('notDocumented', 'std.logic.is-null', { label: 'Not Documented' });
  g.ret('return');
  g.wire('entry.documentation', 'documentation.documentation');
  g.wire('documentation.admissionDate', 'return.admissionDate', 'notDocumented.value');
  g.wire(
    select(
      g,
      'reasons',
      'Why',
      'notDocumented.result',
      fixed([]),
      fixed(['The admission date is documented'])
    ),
    'return.reasons'
  );
  return g.def;
};

const placeOfService = (): GraphDef => {
  const g = rule(
    [SUBMISSION_IN],
    [
      d('placeOfService', 'string', 'Place of Service', 'The place of service code (CLM05-1).'),
      P.reasons('this place of service was billed')
    ]
  );
  g.ret('return', undefined, {
    placeOfService: '41',
    reasons: ['Ground ambulance services are billed with place of service 41']
  });
  return g.def;
};

const claimFrequency = (): GraphDef => {
  const g = rule(
    [
      d(
        'payerClaimNumber',
        'string',
        'Payer Claim Number',
        'The claim number the payer adjudicated the claim under (835), if it did.',
        true
      ),
      d(
        'correctionMethod',
        'string',
        'Correction Method',
        "The payer directory's correction setting: replacement or reopening, if set.",
        true
      ),
      d('payerKind', 'string', 'Payer Kind', 'The claim filing indicator of the payer.', true)
    ],
    [
      d(
        'frequency',
        'string',
        'Claim Frequency',
        'The claim frequency code: 1 original, 7 replacement.'
      ),
      d(
        'replaces',
        'string',
        'Replaces',
        'The payer claim number a replacement names (REF*F8), or nothing for an original claim.',
        true
      ),
      P.reasons('this frequency was billed')
    ]
  );
  g.add('adjudicated', 'std.logic.not-equal', { label: 'Adjudicated by the Payer' });
  isListed(g, 'medicare', 'Medicare Payer', MEDICARE_CLAIM_FILINGS, 'entry.payerKind');
  const correction = (id: string, label: string, method: string) =>
    condition(g, id, label, { correctionMethod: ['string', 'entry.correctionMethod'] }, [
      { field: 'correctionMethod', op: 'is', value: method }
    ]);
  const rules = [
    {
      id: 'new',
      label: 'Never Adjudicated',
      frequency: '1',
      reason: 'The payer never adjudicated the claim: a new claim',
      when: condition(
        g,
        'notAdjudicated',
        'Never Adjudicated',
        { adjudicated: ['boolean', 'adjudicated.result'] },
        [{ field: 'adjudicated', op: 'is', value: false }]
      )
    },
    {
      id: 'replacement',
      label: 'Takes Replacements',
      frequency: '7',
      reason: 'The payer takes replacement claims (frequency 7)',
      when: correction('takesReplacements', 'Takes Replacements', 'replacement')
    },
    {
      id: 'reopening',
      label: 'Takes Reopenings',
      frequency: '1',
      reason: 'The payer takes no corrected claims, only reopenings',
      when: correction('takesReopenings', 'Takes Reopenings', 'reopening')
    },
    {
      id: 'partB',
      label: 'Medicare',
      frequency: '1',
      reason: 'Medicare Part B takes only original claims (CLM05-3 1)',
      when: 'medicare.found' as const
    }
  ];
  const frequency = firstOf(
    g,
    'frequency',
    'Claim Frequency',
    'string',
    rules.map((r) => ({
      id: `${r.id}Frequency`,
      label: `${r.frequency} When ${r.label}`,
      when: r.when,
      value: fixed(r.frequency)
    })),
    fixed('7')
  );
  const original = condition(
    g,
    'original',
    'Original Claim',
    { frequency: ['string', frequency] },
    [{ field: 'frequency', op: 'is', value: '1' }]
  );
  g.ret('return');
  g.wire('entry.payerClaimNumber', 'adjudicated.a');
  g.wire(frequency, 'return.frequency');
  g.wire(
    select(
      g,
      'replaces',
      'Claim Number It Replaces',
      original,
      undefined,
      'entry.payerClaimNumber'
    ),
    'return.replaces'
  );
  g.wire(
    firstOf(
      g,
      'reasons',
      'Why',
      { list: 'string' },
      rules.map((r) => ({
        id: `${r.id}Why`,
        label: `${r.label} Reason`,
        when: r.when,
        value: fixed([r.reason])
      })),
      fixed(['Replaces the claim the payer adjudicated (frequency 7)'])
    ),
    'return.reasons'
  );
  return g.def;
};

const X837_OUT = d('x837', T.x837, '837P Claim', 'The 837P claim the file serializes.');

const POUNDS_PER_KG = 2.20462;

const X837 = (T.x837 as { object: { lines: ValueType; payer: ValueType } }).object;

const X837_LINE_TYPE = (X837.lines as { list: ValueType }).list;

const ADJUSTMENT: ValueType = {
  object: { group: 'string', reason: { code: 'carc' }, cents: 'integer' }
};

const x837ServiceLine = (): GraphDef => {
  const g = rule(
    [
      d('position', 'integer', 'Position', 'The position of the line, counting from 0.'),
      d('lines', T.lines, 'Priced Lines', 'The priced charge lines of the claim.', true),
      d(
        'modifiers',
        { list: { list: 'string' } },
        'Modifiers',
        'The modifiers of each service line, in line order.',
        true
      ),
      d('serviceDate', 'string', 'Date of Service', 'The date of service of the claim.', true),
      d(
        'patientCount',
        'integer',
        'Patients Transported',
        'How many patients the trip transported.',
        true
      )
    ],
    [d('line', X837_LINE_TYPE, 'Service Line', 'The 837P service line at the position.')]
  );
  g.add('priced', 'std.list.get', { label: 'Line at the Position' });
  g.add('parts', 'billing.line.break', { label: 'Priced Line' });
  g.add('modifiersAt', 'std.list.get', { label: 'Its Modifiers' });
  g.add('modifiers', 'std.logic.coalesce', {
    label: 'Its Modifiers, Else None',
    values: { fallback: [] }
  });
  g.add('line', 'x837.line.make', { label: '837P Service Line' });
  g.ret('return');
  g.wire('entry.lines', 'priced.list');
  g.wire('entry.modifiers', 'modifiersAt.list');
  g.wire('entry.position', 'priced.index', 'modifiersAt.index');
  g.wire('priced.item', 'parts.line');
  g.wire('modifiersAt.item', 'modifiers.value');
  g.wire('parts.code', 'line.code');
  g.wire('modifiers.result', 'line.modifiers');
  g.wire('parts.totalCents', 'line.chargeCents');
  g.wire('parts.units', 'line.units');
  g.wire('entry.serviceDate', 'line.serviceDate');
  g.wire('entry.patientCount', 'line.patientCount');
  g.wire('line.line', 'return.line');
  return g.def;
};

const x837ServiceLines = (): GraphDef => {
  const g = rule(
    [SUBMISSION_IN],
    [
      d(
        'lines',
        X837.lines,
        'Service Lines',
        'The 837P service lines, one per priced line, with their modifiers.'
      )
    ]
  );
  g.add('claim', 'billing.submission.break', { label: 'Submitted Claim' });
  g.add('payer', 'billing.submitted-payer.break', { label: 'Payer Billed' });
  g.add('details', 'billing.submitted-details.break', { label: 'Claim Details' });
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('codes', 'std.list.pluck', { label: 'Line Codes', values: { field: 'code' } });
  g.add('modifiers', 'billing.line-modifiers', { label: 'Line Modifiers' });
  g.add('lineCount', 'std.list.length', { label: 'Line Count' });
  g.add('positions', 'std.list.range', { label: 'Line Positions', values: { start: 0 } });
  g.add('lines', 'std.list.map-rule', {
    label: 'Service Lines',
    config: { rule: 'billing.x837-service-line', version: 1, item: 'position' }
  });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
  g.wire('details.originDestination', 'modifiers.originDestination');
  g.wire('payer.claimFiling', 'modifiers.claimFiling');
  g.wire('claim.lines', 'codes.list', 'lines.lines', 'lineCount.list');
  g.wire('codes.list', 'modifiers.codes');
  g.wire('claim.emergency', 'modifiers.emergency');
  g.wire('claim.deceased', 'modifiers.deceased');
  for (const pin of ['patientCount', 'abnOnFile', 'denialExpected']) {
    g.wire(`documentation.${pin}`, `modifiers.${pin}`);
  }
  g.wire('documentation.patientCount', 'lines.patientCount');
  g.wire('modifiers.modifiers', 'lines.modifiers');
  g.wire('details.serviceDate', 'lines.serviceDate');
  g.wire('lineCount.length', 'positions.end');
  g.wire('positions.list', 'lines.list');
  g.wire('lines.line', 'return.lines');
  return g.def;
};

const x837Payer = (): GraphDef => {
  const g = rule(
    [SUBMISSION_IN],
    [
      d(
        'payer',
        X837.payer,
        '837P Payer',
        'The payer billed, with the Medicare Secondary Payer type when Medicare is billed after another payer.'
      )
    ]
  );
  g.add('claim', 'billing.submission.break', { label: 'Submitted Claim' });
  g.add('payer', 'billing.submitted-payer.break', { label: 'Payer Billed' });
  g.add('details', 'billing.submitted-details.break', { label: 'Claim Details' });
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('msp', 'billing.medicare-secondary-payer', { label: 'Medicare Secondary Payer' });
  g.add('priorPayers', 'std.list.length', { label: 'Prior Payers' });
  isListed(g, 'medicare', 'Medicare Payer', MEDICARE_CLAIM_FILINGS, 'payer.claimFiling');
  const afterAnother = condition(
    g,
    'afterAnother',
    'Medicare Billed After Another Payer',
    { medicare: ['boolean', 'medicare.found'], priorPayers: ['integer', 'priorPayers.length'] },
    [
      { field: 'medicare', op: 'is', value: true },
      { field: 'priorPayers', op: 'gte', value: 1 }
    ]
  );
  g.add('x12Payer', 'x837.payer.make', { label: '837P Payer' });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
  for (const pin of [
    'mspEmployerPlan',
    'mspEsrd',
    'mspDisability',
    'mspEmployerSize',
    'mspAccident'
  ]) {
    g.wire(`documentation.${pin}`, `msp.${pin}`);
  }
  g.wire('claim.priorPayers', 'priorPayers.list');
  for (const pin of ['name', 'payerId', 'claimFiling']) g.wire(`payer.${pin}`, `x12Payer.${pin}`);
  g.wire(
    select(g, 'insuranceType', 'Only When Sent', afterAnother, 'msp.insuranceType'),
    'x12Payer.insuranceType'
  );
  g.wire('x12Payer.payer', 'return.payer');
  return g.def;
};

const map837p = (): GraphDef => {
  const g = rule([SUBMISSION_IN], [X837_OUT]);
  g.add('claim', 'billing.submission.break', { label: 'Submitted Claim' });
  g.add('payer', 'billing.submitted-payer.break', { label: 'Payer Billed' });
  g.add('patient', 'billing.submitted-patient.break', { label: 'Patient Billed For' });
  g.add('details', 'billing.submitted-details.break', { label: 'Claim Details' });
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('conditions', 'billing.ambulance-conditions', { label: 'Ambulance Conditions' });
  g.add('pounds', 'std.math.multiply', {
    label: 'Weight in Pounds',
    values: { b: POUNDS_PER_KG }
  });
  g.add('weight', 'std.math.round', { label: 'Whole Pounds', values: { digits: 0 } });
  g.add('subscriber', 'x837.subscriber.make', { label: '837P Subscriber' });
  g.add('x12Patient', 'x837.patient.make', { label: '837P Patient' });
  g.add('x12Payer', 'billing.x837-payer', { label: '837P Payer' });
  g.add('otherPayers', 'std.list.reshape', {
    label: 'Prior Payers as Other Payers',
    config: {
      fields: [
        ...['name', 'payerId', 'claimFiling', 'memberId', 'groupId', 'relationship'].map(
          (name) => ({ name, type: 'string', from: name })
        ),
        { name: 'lastName', type: 'string', from: 'insuredLastName' },
        { name: 'firstName', type: 'string', from: 'insuredFirstName' },
        { name: 'paidCents', type: 'integer', from: 'paidCents' },
        { name: 'adjustedCents', type: 'integer', from: 'adjustedCents' },
        { name: 'paidOn', type: 'string', from: 'paidOn' },
        { name: 'adjustments', type: { list: ADJUSTMENT }, from: 'adjustments' },
        {
          name: 'lines',
          type: {
            list: {
              object: {
                line: 'integer',
                code: { code: 'hcpcs' },
                modifiers: { list: { code: 'modifier' } },
                paidCents: 'integer',
                units: 'number',
                adjustments: { list: ADJUSTMENT }
              }
            }
          },
          from: 'lines'
        }
      ]
    }
  });
  g.add('frequency', 'billing.claim-frequency', { label: 'Claim Frequency' });
  g.add('assignment', 'std.table.lookup', {
    label: 'Benefits Assignment',
    config: shared.lookup(
      'billing.benefits-assignment',
      'Benefits Assignment',
      'The benefits assignment certification (CLM08) by the billing signature: Y when the patient or a representative signed or a signature exception applies, W when the patient refused to assign benefits, N without a signature.',
      {
        type: 'string',
        rows: [
          { key: 'signed', value: 'Y' },
          { key: 'exception', value: 'Y' },
          { key: 'refused', value: 'W' }
        ],
        fallback: 'N'
      }
    )
  });
  g.add('place', 'billing.place-of-service', { label: 'Place of Service' });
  g.add('lines', 'billing.x837-service-lines', { label: 'Service Lines' });
  g.add('note', 'billing.narrative-note', { label: 'Narrative Note' });
  g.add('admitted', 'billing.admission-date', { label: 'Admission Date' });
  g.add('x837', 'x837.claim.make', { label: '837P Claim' });
  g.ret('return');
  g.wire(
    'entry.claim',
    'claim.claim',
    'place.claim',
    'x12Payer.claim',
    'lines.claim',
    'note.claim'
  );
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.patient', 'patient.patient');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation', 'admitted.documentation');
  g.wire('documentation.conditionCodes', 'conditions.documented');
  g.wire('claim.emergency', 'conditions.emergency');
  g.wire('documentation.weightKg', 'pounds.a');
  g.wire('pounds.result', 'weight.value');
  g.wire('documentation.transportReason', 'x837.transportReason');
  g.wire('documentation.priorAuthorization', 'x837.priorAuthorization');
  g.wire('weight.result', 'x837.weightPounds');
  for (const pin of ['firstName', 'lastName', 'birthDate', 'sex', ...ADDRESS_PINS]) {
    g.wire(`patient.${pin}`, `x12Patient.${pin}`);
  }
  for (const pin of ['relationship', 'memberId', 'groupId']) {
    g.wire(`payer.${pin}`, `subscriber.${pin}`);
  }
  g.wire('payer.insuredLastName', 'subscriber.lastName');
  g.wire('payer.insuredFirstName', 'subscriber.firstName');
  g.wire('conditions.codes', 'note.conditionCodes', 'x837.conditionCodes');
  g.wire('note.note', 'x837.note');
  g.wire('admitted.admissionDate', 'x837.admissionDate');
  g.wire('claim.priorPayers', 'otherPayers.list');
  g.wire('claim.payerClaimNumber', 'frequency.payerClaimNumber');
  g.wire('claim.correctionMethod', 'frequency.correctionMethod');
  g.wire('payer.claimFiling', 'frequency.payerKind');
  g.wire('frequency.frequency', 'x837.frequency');
  g.wire('frequency.replaces', 'x837.payerClaimNumber');
  g.wire('documentation.signature', 'assignment.key');
  g.wire('assignment.value', 'x837.benefitsAssignment');
  g.wire('place.placeOfService', 'x837.placeOfService');
  g.wire('claim.claimId', 'x837.claimId');
  g.wire('subscriber.subscriber', 'x837.subscriber');
  g.wire('x12Patient.patient', 'x837.patient');
  g.wire('x12Payer.payer', 'x837.payer');
  g.wire('otherPayers.list', 'x837.otherPayers');
  g.add('billedMiles', 'billing.billed-units', { label: 'Billed Loaded Miles' });
  g.wire('claim.loadedMiles', 'billedMiles.units');
  g.wire('billedMiles.units', 'x837.loadedMiles');
  g.wire('details.diagnoses', 'x837.diagnoses');
  g.wire('details.pickup', 'x837.pickup');
  g.wire('details.destination', 'x837.dropoff');
  g.wire('lines.lines', 'x837.lines');
  g.wire('x837.x837', 'return.x837');
  return g.def;
};

export const claimGraphs: SeedGraph[] = [
  asRule(
    'billing.transport-reason',
    'Transport Reason',
    'The CMS transport reason (CR104) as the crew reported it, else the one the reason for choosing the destination means (Transport Reason by Destination Reason table).',
    transportReason()
  ),
  asRule(
    'billing.origin-destination',
    'Origin/Destination Modifiers',
    'The origin letter from the incident location type, else the type of service, and the destination letter from the type of destination (Destination Modifier table), or H when the report gives no type and the destination is a Medicare-certified hospital.',
    originDestination()
  ),
  asRule(
    'billing.map-claim',
    'Assign Claim Properties',
    'Builds the claim from the encounter facts, patient, payers, confirmed service and priced lines: date of service, pickup and destination, Assign Diagnoses, Origin/Destination Modifiers and the documentation with its Transport Reason.',
    mapClaim()
  ),
  asRule(
    'billing.ambulance-conditions',
    'Ambulance Conditions',
    'The CRC ambulance condition codes the report documents, else 06 (transported in an emergency situation) for an emergency transport and none otherwise, as nothing the record does not show is attested.',
    ambulanceConditions()
  ),
  asRule(
    'billing.modifiers-of-one-line',
    'Modifiers of One Line',
    'The modifiers of one service line, each once and at most four: the replacement modifier (QL) or the origin/destination letters, the trip modifier, the liability modifier and a modifier for the line code (Line Code Modifier table).',
    oneLineModifiers()
  ),
  asRule(
    'billing.line-modifiers',
    'Line Modifiers',
    'The modifiers of each service line: the origin/destination letters, or QL when the patient was pronounced dead before loading, and GM for several patients; a liability modifier when Medicare is billed, GY for treatment without transport, GA with an ABN for a non-emergency transport, GZ when a denial is expected; and a modifier for the line code, such as GY on A0888 (Line Code Modifier table).',
    lineModifiers()
  ),
  asRule(
    'billing.medical-necessity-summary',
    'Medical Necessity Summary',
    'The claim note text, cut to 80 characters: the level and emergency, then pronounced dead, patients transported, miles past the nearest facility, transport reason, conditions and the primary diagnosis, each when known.',
    medicalNecessitySummary()
  ),
  asRule(
    'billing.narrative-note',
    'Narrative Note',
    'The Medical Necessity Summary as the claim note (NTE ADD), sent when it explains QL, GM or A0888.',
    narrativeNote()
  ),
  asRule(
    'billing.admission-date',
    'Admission Date',
    'The admission date the claim carries (DTP 435), when it is documented.',
    admissionDate()
  ),
  asRule(
    'billing.place-of-service',
    'Place of Service',
    'The place of service code of the claim: 41, ground ambulance.',
    placeOfService()
  ),
  asRule(
    'billing.claim-frequency',
    'Claim Frequency',
    'The claim frequency code: 7 with the claim number it replaces only when the payer adjudicated the claim and takes replacements, else 1 for an original claim, as for a claim rejected before adjudication, a payer that takes reopenings and Medicare Part B.',
    claimFrequency()
  ),
  asRule(
    'billing.x837-service-line',
    '837P Service Line',
    'The 837P service line at a position of the claim: the priced line with its modifiers, the date of service and the patients transported.',
    x837ServiceLine()
  ),
  asRule(
    'billing.x837-service-lines',
    '837P Service Lines',
    'The 837P service lines of the claim: Line Modifiers for every line, then an 837P Service Line for each priced line.',
    x837ServiceLines()
  ),
  asRule(
    'billing.x837-payer',
    '837P Payer',
    'The payer the 837P is filed with, naming the Medicare Secondary Payer type (SBR05) when Medicare is billed after another payer.',
    x837Payer()
  ),
  asRule(
    'billing.map-837p',
    'Map 837P Claim',
    'Maps a claim on its way to a payer onto an 837P claim: subscriber and patient, 837P Payer, prior payers for coordination of benefits, Claim Frequency, Benefits Assignment, Place of Service, Admission Date, Ambulance Conditions, Narrative Note and 837P Service Lines.',
    map837p()
  )
];
