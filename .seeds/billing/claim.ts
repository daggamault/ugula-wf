import { NO_TRANSPORT_CODE, NOTE_LENGTH } from '@ugula/billing';
import type { GraphDef, ValueType } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  ADDRESS_PINS,
  asRule,
  atLeast,
  d,
  field,
  is,
  oneOf,
  P,
  rule,
  shared,
  startsWith,
  T,
  table
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
  g.add('documentation', 'billing.documentation.break');
  g.add('locations', 'billing.location-facts.break');
  g.add('byDestination', 'std.table.lookup', {
    label: 'Transport Reason From the Destination Reason',
    config: shared.lookup(
      'billing.transport-reason-by-destination',
      'Transport Reason by Destination Reason',
      'The CMS transport reason a reason for choosing the destination (eDisposition.20) means, used when the crew reported none.',
      { type: 'string', rows: DESTINATION_REASONS }
    )
  });
  g.add('reason', 'std.logic.coalesce', { label: 'Reported, Else From the Destination' });
  g.add('notReported', 'std.logic.is-null', { label: 'Not Reported' });
  g.add('noDestinationReason', 'std.logic.is-null', { label: 'Not From the Destination' });
  g.add('whyDestination', 'std.logic.select', {
    label: 'Why From the Destination',
    values: { whenTrue: [], whenFalse: ['From the reason for choosing the destination'] }
  });
  g.add('reasons', 'std.logic.select', {
    label: 'Why',
    values: { whenFalse: ['Reported by the crew'] }
  });
  g.ret('return');
  g.wire('entry.documentation', 'documentation.documentation');
  g.wire('entry.locations', 'locations.locations');
  g.wire('locations.destinationReason', 'byDestination.key');
  g.wire('documentation.transportReason', 'reason.value', 'notReported.value');
  g.wire('byDestination.value', 'reason.fallback', 'noDestinationReason.value');
  g.wire('noDestinationReason.result', 'whyDestination.condition');
  g.wire('notReported.result', 'reasons.condition');
  g.wire('whyDestination.result', 'reasons.whenTrue');
  g.wire('reason.result', 'return.transportReason');
  g.wire('reasons.result', 'return.reasons');
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
  g.add('locations', 'billing.location-facts.break');
  g.add('trip', 'billing.trip-facts.break');
  g.add('origin', 'std.table.decide', {
    label: 'Origin Modifier',
    config: shared.decision(
      'billing.origin-modifier',
      'Origin Modifier',
      'Picks the origin letter of the modifier from the incident location type and the type of service.',
      table(
        [
          field('locationType', 'string', 'Incident location type · eScene.09'),
          field('serviceType', 'string', 'Type of service requested · eResponse.05')
        ],
        [field('code', 'string', 'Origin code')],
        [
          { label: 'Home', when: { locationType: startsWith('Y92.0') }, set: { code: 'R' } },
          {
            label: 'Nursing home or other residential institution',
            when: { locationType: startsWith('Y92.1') },
            set: { code: 'E' }
          },
          { label: 'Hospital', when: { locationType: startsWith('Y92.23') }, set: { code: 'H' } },
          {
            label: "Physician's office or clinic",
            when: { locationType: startsWith('Y92.53') },
            set: { code: 'P' }
          },
          {
            label: 'Leaving a hospital (interfacility)',
            when: { serviceType: oneOf('2205005', '2205015') },
            set: { code: 'H' }
          },
          {
            label: 'Leaving a care facility',
            when: { serviceType: oneOf('2205017', '2205019') },
            set: { code: 'E' }
          },
          {
            label: 'Emergency response to a scene',
            when: { serviceType: oneOf('2205001', '2205003', '2205009') },
            set: { code: 'S' }
          }
        ]
      )
    )
  });
  g.add('destination', 'std.table.decide', {
    label: 'Destination Modifier',
    config: shared.decision(
      'billing.destination-modifier',
      'Destination Modifier',
      'Picks the destination letter of the modifier from the type of destination (eDisposition.21), or H when the report gives no type and the destination is a Medicare-certified hospital.',
      table(
        [
          field('destinationType', 'string', 'Type of destination · eDisposition.21'),
          field('hospital', 'boolean', 'Destination is a Medicare-certified hospital')
        ],
        [field('letter', 'string', 'Destination code')],
        [
          { label: 'Residence', when: { destinationType: oneOf('4221001') }, set: { letter: 'R' } },
          {
            label: 'Hospital',
            when: { destinationType: oneOf('4221003', '4221005', '4221023') },
            set: { letter: 'H' }
          },
          {
            label: "Physician's office",
            when: { destinationType: oneOf('4221007', '4221021') },
            set: { letter: 'P' }
          },
          {
            label: 'Residential, domiciliary or custodial facility',
            when: { destinationType: oneOf('4221011', '4221029', '4221033') },
            set: { letter: 'E' }
          },
          {
            label: 'Site of transfer between types of ambulance',
            when: { destinationType: oneOf('4221015') },
            set: { letter: 'I' }
          },
          {
            label: 'Freestanding dialysis facility',
            when: { destinationType: oneOf('4221025') },
            set: { letter: 'J' }
          },
          {
            label: 'Diagnostic or therapeutic site',
            when: { destinationType: oneOf('4221027') },
            set: { letter: 'D' }
          },
          {
            label: 'Skilled nursing facility',
            when: { destinationType: oneOf('4221041') },
            set: { letter: 'N' }
          },
          {
            label: NO_TYPE_HOSPITAL,
            when: { destinationType: is(null), hospital: is(true) },
            set: { letter: 'H' }
          }
        ]
      )
    )
  });
  g.add('hospitalReason', 'std.list.where', {
    label: 'Why a Hospital Without a Type',
    config: { field: '', op: 'is', value: NO_TYPE_HOSPITAL }
  });
  g.add('reasons', 'std.list.join', { label: 'Why', config: { count: 2, type: 'string' } });
  g.add('codes', 'std.list.make', { label: 'Origin and Destination', config: { count: 2 } });
  g.add('modifier', 'std.text.join', { label: 'Origin Then Destination' });
  g.add('asModifier', 'std.convert.to-code', {
    label: 'As Modifier',
    config: { kind: 'modifier' }
  });
  g.ret('return');
  g.wire('entry.locations', 'locations.locations');
  g.wire('entry.trip', 'trip.trip');
  g.wire('locations.pickupType', 'origin.locationType');
  g.wire('trip.serviceType', 'origin.serviceType');
  g.wire('locations.destinationType', 'destination.destinationType');
  g.wire('locations.destinationHospital', 'destination.hospital');
  g.wire('origin.code', 'codes.item1');
  g.wire('destination.letter', 'codes.item2');
  g.wire('codes.list', 'modifier.items');
  g.wire('modifier.text', 'asModifier.text');
  g.wire('asModifier.code', 'return.originDestination');
  g.wire('destination.rules', 'hospitalReason.list');
  g.wire('origin.rules', 'reasons.list1');
  g.wire('hospitalReason.list', 'reasons.list2');
  g.wire('reasons.list', 'return.reasons');
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
  g.add('facts', 'billing.encounter-facts.break');
  g.add('trip', 'billing.trip-facts.break');
  g.add('locations', 'billing.location-facts.break');
  g.add('diagnoses', 'billing.assign-diagnoses', { label: 'Assign Diagnoses' });
  g.add('modifier', 'billing.origin-destination', { label: 'Origin/Destination Modifiers' });
  g.add('reason', 'billing.transport-reason', { label: 'Transport Reason' });
  g.add('documentation', 'std.object.set', {
    label: 'Documentation With the Transport Reason',
    values: { path: 'transportReason' }
  });
  g.add('patient', 'billing.patient.break');
  g.add('service', 'billing.service.break');
  g.add('claim', 'billing.claim.make');
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
  g.add('decided', 'std.table.decide', {
    label: 'Conditions by Emergency',
    config: shared.decision(
      'billing.ambulance-conditions',
      'Ambulance Conditions',
      'The CRC ambulance condition codes the trip itself shows when the report documents none: 06 (transported in an emergency situation) for an emergency transport. Nothing the record does not show is attested, such as 09 (medically necessary); a non-emergency trip without documented conditions bills none.',
      table(
        [field('emergency', 'boolean', 'Emergency')],
        [field('codes', { list: 'string' }, 'CRC condition codes')],
        [
          {
            label: 'Transported in an emergency situation',
            when: { emergency: is(true) },
            set: { codes: ['06'] }
          }
        ],
        { codes: [] }
      )
    )
  });
  g.add('codes', 'std.logic.select', { label: 'Documented Conditions, Else by Emergency' });
  g.add('documented', 'std.logic.condition', {
    label: 'Conditions Documented',
    config: {
      inputs: [{ name: 'documented', type: { list: 'string' } }],
      rules: [{ field: 'documented', op: 'present' }]
    }
  });
  g.add('whyByEmergency', 'std.list.join', {
    label: 'Why by Emergency',
    config: { count: 2, type: 'string' },
    values: { list1: ['Not documented, so by emergency status'] }
  });
  g.add('reasons', 'std.logic.select', {
    label: 'Why',
    values: { whenTrue: ['Documented on the report'] }
  });
  g.ret('return');
  g.wire('entry.emergency', 'decided.emergency');
  g.wire('entry.documented', 'codes.whenTrue', 'documented.documented');
  g.wire('decided.codes', 'codes.whenFalse');
  g.wire('decided.rules', 'whyByEmergency.list2');
  g.wire('documented.result', 'codes.condition', 'reasons.condition');
  g.wire('whyByEmergency.list', 'reasons.whenFalse');
  g.wire('codes.result', 'return.codes');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const MEDICARE = ['MA', 'MB'];

const MAX_LINE_MODIFIERS = 4;

const flagIn = (name: string, label: string, description: string) =>
  d(name, 'boolean', label, description, true);

const lineModifiers = (): GraphDef => {
  const g = rule(
    [
      d(
        'originDestination',
        { code: 'modifier' },
        'Origin/Destination Modifier',
        'The origin and destination letters.',
        true
      ),
      d(
        'claimFiling',
        'string',
        'Claim Filing',
        'The claim filing indicator of the payer billed.',
        true
      ),
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
  g.add('trip', 'std.table.decide', {
    label: 'Trip Modifiers',
    config: shared.decision(
      'billing.trip-modifiers',
      'Trip Modifiers',
      'Modifiers the trip itself calls for on every line: QL in place of the origin/destination letters when the patient was pronounced dead before loading, GM when several patients rode on one trip.',
      table(
        [
          field('deceased', 'boolean', 'Pronounced dead before loading'),
          field('patientCount', 'integer', 'Patients transported')
        ],
        [
          field('leading', 'string', 'Modifier in place of the origin/destination letters'),
          field('added', 'string', 'Modifier added to every line')
        ],
        [
          {
            label: 'Pronounced dead before loading, with other patients on the trip',
            when: { deceased: is(true), patientCount: atLeast(2) },
            set: { leading: 'QL', added: 'GM' }
          },
          {
            label: 'Pronounced dead before loading',
            when: { deceased: is(true) },
            set: { leading: 'QL' }
          },
          {
            label: 'Several patients transported on one trip',
            when: { patientCount: atLeast(2) },
            set: { added: 'GM' }
          }
        ]
      )
    )
  });
  g.add('coverage', 'std.table.decide', {
    label: 'Coverage Modifier',
    config: shared.decision(
      'billing.coverage-modifier',
      'Coverage Modifier',
      'Adds a liability modifier for the payer being billed: GY when Medicare does not cover the service, GA when an ABN is on file for a non-emergency transport, GZ when Medicare is expected to deny and no ABN is on file.',
      table(
        [
          field('claimFiling', 'string', 'Claim filing indicator'),
          field('codes', { list: 'string' }, 'HCPCS codes'),
          field('emergency', 'boolean', 'Emergency'),
          field('abnOnFile', 'boolean', 'ABN on file'),
          field('denialExpected', 'boolean', 'Medicare denial expected')
        ],
        [field('modifier', 'string', 'Modifier')],
        [
          {
            label: 'Medicare does not cover treatment without transport',
            when: { claimFiling: oneOf(...MEDICARE), codes: oneOf(NO_TRANSPORT_CODE) },
            set: { modifier: 'GY' }
          },
          {
            label: 'ABN on file for a non-emergency Medicare transport',
            when: { claimFiling: oneOf(...MEDICARE), abnOnFile: is(true), emergency: is(false) },
            set: { modifier: 'GA' }
          },
          {
            label: 'Medicare is expected to deny and no ABN is on file',
            when: { claimFiling: oneOf(...MEDICARE), denialExpected: is(true) },
            set: { modifier: 'GZ' }
          }
        ]
      )
    )
  });
  g.add('lines', 'std.list.map-rule', {
    label: 'Modifiers of Each Line',
    config: { rule: 'billing.modifiers-of-one-line', version: 1, item: 'code' }
  });
  g.add('codeReasons', 'std.list.flatten', { label: 'Why Each Line Code' });
  g.add('reasons', 'std.list.join', { label: 'Why', config: { count: 3, type: 'string' } });
  g.ret('return');
  g.wire('entry.deceased', 'trip.deceased');
  g.wire('entry.patientCount', 'trip.patientCount');
  for (const pin of ['claimFiling', 'codes', 'emergency', 'abnOnFile', 'denialExpected']) {
    g.wire(`entry.${pin}`, `coverage.${pin}`);
  }
  g.wire('entry.codes', 'lines.list');
  g.wire('entry.claimFiling', 'lines.claimFiling');
  g.wire('entry.originDestination', 'lines.originDestination');
  g.wire('trip.leading', 'lines.leading');
  g.wire('trip.added', 'lines.added');
  g.wire('coverage.modifier', 'lines.coverage');
  g.wire('lines.modifiers', 'return.modifiers');
  g.wire('lines.reasons', 'codeReasons.list');
  g.wire('trip.rules', 'reasons.list1');
  g.wire('coverage.rules', 'reasons.list2');
  g.wire('codeReasons.list', 'reasons.list3');
  g.wire('reasons.list', 'return.reasons');
  return g.def;
};

const modifierIn = (name: string, label: string, description: string) =>
  d(name, 'string', label, description, true);

const oneLineModifiers = (): GraphDef => {
  const g = rule(
    [
      d('code', { code: 'hcpcs' }, 'Line Code', 'The HCPCS code of the line.', true),
      d(
        'claimFiling',
        'string',
        'Claim Filing',
        'The claim filing indicator of the payer billed.',
        true
      ),
      modifierIn(
        'leading',
        'Leading Modifier',
        'The modifier in place of the origin/destination letters, such as QL.'
      ),
      d(
        'originDestination',
        { code: 'modifier' },
        'Origin/Destination Modifier',
        'The origin and destination letters.',
        true
      ),
      modifierIn('added', 'Trip Modifier', 'The modifier the trip adds to every line, such as GM.'),
      modifierIn('coverage', 'Liability Modifier', 'The liability modifier: GY, GA or GZ.')
    ],
    [
      d('modifiers', { list: 'string' }, 'Modifiers', 'The modifiers of the line, at most four.'),
      P.reasons('the line code carries a modifier')
    ]
  );
  g.add('key', 'std.text.template', {
    label: 'Claim Filing and Code',
    config: { template: '{claimFiling} {code}' }
  });
  g.add('byCode', 'std.table.lookup', {
    label: 'Line Code Modifier',
    config: shared.lookup(
      'billing.code-modifier',
      'Line Code Modifier',
      'A modifier a single line carries because of its HCPCS code for a kind of payer, keyed by the claim filing indicator and the code: GY on A0888 non-covered miles for Medicare.',
      {
        type: 'string',
        rows: MEDICARE.map((filing) => ({ key: `${filing} A0888`, value: 'GY' }))
      }
    )
  });
  g.add('leading', 'std.logic.coalesce', { label: 'Leading Modifier, Else Origin/Destination' });
  g.add('all', 'std.list.make', {
    label: 'Trip Then Liability Then Code',
    config: { count: 4, type: 'string' }
  });
  g.add('unique', 'std.list.unique', { label: 'Each Modifier Once' });
  g.add('modifiers', 'std.list.slice', {
    label: 'At Most Four',
    values: { start: 0, end: MAX_LINE_MODIFIERS }
  });
  g.add('carries', 'std.text.template', {
    label: 'Code Carries Modifier',
    config: { template: '[{code} carries {modifier}]' }
  });
  g.add('reasons', 'std.list.make', { label: 'Why', config: { count: 1, type: 'string' } });
  g.ret('return');
  g.wire('entry.claimFiling', 'key.claimFiling');
  g.wire('entry.code', 'key.code', 'carries.code');
  g.wire('key.text', 'byCode.key');
  g.wire('entry.leading', 'leading.value');
  g.wire('entry.originDestination', 'leading.fallback');
  g.wire('leading.result', 'all.item1');
  g.wire('entry.added', 'all.item2');
  g.wire('entry.coverage', 'all.item3');
  g.wire('byCode.value', 'all.item4', 'carries.modifier');
  g.wire('all.list', 'unique.list');
  g.wire('unique.list', 'modifiers.list');
  g.wire('modifiers.list', 'return.modifiers');
  g.wire('carries.text', 'reasons.item1');
  g.wire('reasons.list', 'return.reasons');
  return g.def;
};

const NOTE_IN = [
  d('claim', T.submission, 'Claim', 'The claim as it goes to this payer.'),
  d(
    'conditionCodes',
    { list: 'string' },
    'Condition Codes',
    'The CRC ambulance condition codes billed.',
    true
  )
];

const moreThan = (label: string, name: string, type: ValueType, value: number) => ({
  label,
  config: { inputs: [{ name, type }], rules: [{ field: name, op: 'gt', value }] }
});

const narrativeNote = (): GraphDef => {
  const g = rule(NOTE_IN, [
    d(
      'note',
      'string',
      'Narrative Note',
      'An 80-character medical necessity summary for the claim note (NTE ADD), or nothing.',
      true
    ),
    P.reasons('a note was or was not sent')
  ]);
  g.add('claim', 'billing.submission.break');
  g.add('payer', 'billing.submitted-payer.break');
  g.add('details', 'billing.submitted-details.break');
  g.add('documentation', 'billing.documentation.break');
  g.add('nonCoveredLines', 'std.list.where', {
    label: 'Non-Covered Mile Lines',
    config: { field: 'code', op: 'is', value: 'A0888' }
  });
  g.add('nonCoveredUnits', 'std.list.pluck', { label: 'Their Units', values: { field: 'units' } });
  g.add('nonCovered', 'std.math.sum', { label: 'Non-Covered Miles Billed' });
  g.add('decide', 'std.table.decide', {
    label: 'Narrative Note',
    config: shared.decision(
      'billing.narrative-note',
      'Narrative Note',
      'Decides when the claim carries a medical necessity note (NTE ADD): when it explains QL, GM or A0888. Add a row, for a claim filing indicator say, to send it on more claims.',
      table(
        [
          field('claimFiling', 'string', 'Claim filing indicator'),
          field('deceased', 'boolean', 'Pronounced dead before loading'),
          field('patientCount', 'integer', 'Patients transported'),
          field('nonCoveredMiles', 'number', 'Non-covered miles billed')
        ],
        [field('send', 'boolean', 'Send the note')],
        [
          {
            label: 'Explains QL: pronounced dead before loading',
            when: { deceased: is(true) },
            set: { send: true }
          },
          {
            label: 'Explains GM: several patients on one trip',
            when: { patientCount: atLeast(2) },
            set: { send: true }
          },
          {
            label: 'Explains A0888: miles past the nearest facility',
            when: { nonCoveredMiles: { op: 'gt', value: 0 } },
            set: { send: true }
          }
        ],
        { send: false }
      )
    )
  });
  g.add('firstLine', 'std.list.first', { label: 'First Line' });
  g.add('urgency', 'std.logic.choose', {
    label: 'Emergency or Not',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { case1: 'EMERGENCY', otherwise: 'NON-EMERGENCY' }
  });
  g.add('levelText', 'std.text.template', {
    label: 'Code and Emergency',
    config: { template: '{line.code} {urgency}' }
  });
  g.add('dead', 'std.logic.condition', {
    label: 'Pronounced Dead',
    config: {
      inputs: [{ name: 'deceased', type: 'boolean' }],
      rules: [{ field: 'deceased', op: 'is', value: true }]
    }
  });
  g.add('deadText', 'std.logic.select', {
    label: 'Pronounced Dead Text',
    values: { whenTrue: 'PRONOUNCED DEAD BEFORE LOADING' }
  });
  g.add(
    'several',
    'std.logic.condition',
    moreThan('Several Patients', 'patientCount', 'integer', 1)
  );
  g.add('severalCount', 'std.logic.select', { label: 'Patients When Several' });
  g.add('patientsText', 'std.text.template', {
    label: 'Patients Text',
    config: { template: '[{count} PATIENTS TRANSPORTED]' }
  });
  g.add(
    'pastNearest',
    'std.logic.condition',
    moreThan('Miles Past the Nearest Facility', 'miles', 'number', 0)
  );
  g.add('pastMiles', 'std.logic.select', { label: 'Miles When Past the Nearest' });
  g.add('milesText', 'std.text.template', {
    label: 'Miles Text',
    config: { template: '[{miles} MI PAST NEAREST FACILITY]' }
  });
  g.add('reasonText', 'std.text.template', {
    label: 'Reason Text',
    config: { template: '[REASON {transportReason}]' }
  });
  g.add('conditions', 'std.text.join', {
    label: 'Conditions With Spaces',
    values: { separator: ' ' }
  });
  g.add('conditionText', 'std.text.template', {
    label: 'Conditions Text',
    config: { template: '[COND {conditions}]' }
  });
  g.add('primary', 'std.list.first', { label: 'Primary Diagnosis' });
  g.add('diagnosisText', 'std.text.template', {
    label: 'Diagnosis Text',
    config: { template: '[DX {diagnosis}]' }
  });
  g.add('parts', 'std.list.make', { label: 'Note Parts', config: { count: 7, type: 'string' } });
  g.add('joined', 'std.text.join', { label: 'With Semicolons', values: { separator: '; ' } });
  g.add('text', 'std.text.substring', {
    label: 'Medical Necessity Summary',
    values: { start: 0, end: NOTE_LENGTH }
  });
  g.add('note', 'std.logic.select', { label: 'Only When Sent' });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
  g.wire('claim.lines', 'nonCoveredLines.list', 'firstLine.list');
  g.wire('nonCoveredLines.list', 'nonCoveredUnits.list');
  g.wire('nonCoveredUnits.list', 'nonCovered.values');
  g.wire('payer.claimFiling', 'decide.claimFiling');
  g.wire('claim.deceased', 'decide.deceased', 'dead.deceased');
  g.wire('documentation.patientCount', 'decide.patientCount', 'several.patientCount');
  g.wire('documentation.patientCount', 'severalCount.whenTrue');
  g.wire('nonCovered.result', 'decide.nonCoveredMiles', 'pastNearest.miles', 'pastMiles.whenTrue');
  g.wire('firstLine.item', 'levelText.line');
  g.wire('claim.emergency', 'urgency.key');
  g.wire('urgency.value', 'levelText.urgency');
  g.wire('dead.result', 'deadText.condition');
  g.wire('several.result', 'severalCount.condition');
  g.wire('severalCount.result', 'patientsText.count');
  g.wire('pastNearest.result', 'pastMiles.condition');
  g.wire('pastMiles.result', 'milesText.miles');
  g.wire('documentation.transportReason', 'reasonText.transportReason');
  g.wire('entry.conditionCodes', 'conditions.items');
  g.wire('conditions.text', 'conditionText.conditions');
  g.wire('details.diagnoses', 'primary.list');
  g.wire('primary.item', 'diagnosisText.diagnosis');
  g.wire('levelText.text', 'parts.item1');
  g.wire('deadText.result', 'parts.item2');
  g.wire('patientsText.text', 'parts.item3');
  g.wire('milesText.text', 'parts.item4');
  g.wire('reasonText.text', 'parts.item5');
  g.wire('conditionText.text', 'parts.item6');
  g.wire('diagnosisText.text', 'parts.item7');
  g.wire('parts.list', 'joined.items');
  g.wire('joined.text', 'text.text');
  g.wire('decide.send', 'note.condition');
  g.wire('text.result', 'note.whenTrue');
  g.wire('note.result', 'return.note');
  g.wire('decide.rules', 'return.reasons');
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
  g.add('documentation', 'billing.documentation.break');
  g.add('notDocumented', 'std.logic.is-null', { label: 'Not Documented' });
  g.add('reasons', 'std.logic.select', {
    label: 'Why',
    values: { whenTrue: [], whenFalse: ['The admission date is documented'] }
  });
  g.ret('return');
  g.wire('entry.documentation', 'documentation.documentation');
  g.wire('documentation.admissionDate', 'return.admissionDate', 'notDocumented.value');
  g.wire('notDocumented.result', 'reasons.condition');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const SUBMISSION_IN = d('claim', T.submission, 'Claim', 'The claim as it goes to this payer.');

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
      d('frequency', 'string', 'Frequency', 'The claim frequency code: 1 original, 7 replacement.'),
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
  g.add('decide', 'std.table.decide', {
    label: 'Claim Frequencies',
    config: shared.decision(
      'billing.claim-frequencies',
      'Claim Frequencies',
      'Decides whether a claim goes to the payer as an original (1) or a replacement (7) of the claim it adjudicated: only a payer that adjudicated the claim and takes replacements gets a 7. A claim rejected before adjudication (999 or 277CA) or returned as unprocessable is a new claim, and Medicare Part B takes only originals (CLM05-3 1), correcting processed claims through reopenings.',
      table(
        [
          field('adjudicated', 'boolean', 'The payer adjudicated the claim (835)'),
          field('correctionMethod', 'string', 'Payer setting: replacement or reopening'),
          field('payerKind', 'string', 'Claim filing indicator of the payer')
        ],
        [field('frequency', 'string', 'Claim frequency')],
        [
          {
            label: 'The payer never adjudicated the claim: a new claim',
            when: { adjudicated: is(false) },
            set: { frequency: '1' }
          },
          {
            label: 'The payer takes replacement claims (frequency 7)',
            when: { correctionMethod: is('replacement') },
            set: { frequency: '7' }
          },
          {
            label: 'The payer takes no corrected claims, only reopenings',
            when: { correctionMethod: is('reopening') },
            set: { frequency: '1' }
          },
          {
            label: 'Medicare Part B takes only original claims (CLM05-3 1)',
            when: { payerKind: oneOf(...MEDICARE) },
            set: { frequency: '1' }
          }
        ],
        { frequency: '7' },
        'Replaces the claim the payer adjudicated (frequency 7)'
      )
    )
  });
  g.add('original', 'std.logic.condition', {
    label: 'Original Claim',
    config: {
      inputs: [{ name: 'frequency', type: 'string' }],
      rules: [{ field: 'frequency', op: 'is', value: '1' }]
    }
  });
  g.add('replaces', 'std.logic.select', { label: 'Claim Number It Replaces' });
  g.ret('return');
  g.wire('entry.payerClaimNumber', 'adjudicated.a', 'replaces.whenFalse');
  g.wire('adjudicated.result', 'decide.adjudicated');
  g.wire('entry.correctionMethod', 'decide.correctionMethod');
  g.wire('entry.payerKind', 'decide.payerKind');
  g.wire('decide.frequency', 'original.frequency', 'return.frequency');
  g.wire('original.result', 'replaces.condition');
  g.wire('replaces.result', 'return.replaces');
  g.wire('decide.reasons', 'return.reasons');
  return g.def;
};

const X837_OUT = d('x837', T.x837, '837P Claim', 'The 837P claim the file serializes.');

const POUNDS_PER_KG = 2.20462;

const X837_LINE_TYPE = (
  (T.x837 as { object: Record<string, ValueType> }).object.lines as { list: ValueType }
).list;

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
  g.add('parts', 'billing.line.break');
  g.add('modifiersAt', 'std.list.get', { label: 'Its Modifiers' });
  g.add('modifiers', 'std.logic.coalesce', {
    label: 'Its Modifiers, Else None',
    values: { fallback: [] }
  });
  g.add('line', 'x837.line.make');
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

const map837p = (): GraphDef => {
  const g = rule([SUBMISSION_IN], [X837_OUT]);
  g.add('claim', 'billing.submission.break');
  g.add('payer', 'billing.submitted-payer.break');
  g.add('patient', 'billing.submitted-patient.break');
  g.add('details', 'billing.submitted-details.break');
  g.add('documentation', 'billing.documentation.break');
  g.add('conditions', 'billing.ambulance-conditions', { label: 'Ambulance Conditions' });
  g.add('pounds', 'std.math.multiply', {
    label: 'Weight in Pounds',
    values: { b: POUNDS_PER_KG }
  });
  g.add('weight', 'std.math.round', { label: 'Whole Pounds', values: { digits: 0 } });
  g.add('subscriber', 'x837.subscriber.make');
  g.add('x12Patient', 'x837.patient.make');
  g.add('x12Payer', 'x837.payer.make');
  g.add('otherPayers', 'std.list.reshape', {
    label: 'Prior Payers as Other Payers',
    config: {
      fields: [
        { name: 'name', type: 'string', from: 'name' },
        { name: 'payerId', type: 'string', from: 'payerId' },
        { name: 'claimFiling', type: 'string', from: 'claimFiling' },
        { name: 'memberId', type: 'string', from: 'memberId' },
        { name: 'groupId', type: 'string', from: 'groupId' },
        { name: 'relationship', type: 'string', from: 'relationship' },
        { name: 'lastName', type: 'string', from: 'insuredLastName' },
        { name: 'firstName', type: 'string', from: 'insuredFirstName' },
        { name: 'paidCents', type: 'integer', from: 'paidCents' },
        { name: 'adjustedCents', type: 'integer', from: 'adjustedCents' },
        { name: 'paidOn', type: 'string', from: 'paidOn' },
        {
          name: 'adjustments',
          type: {
            list: { object: { group: 'string', reason: { code: 'carc' }, cents: 'integer' } }
          },
          from: 'adjustments'
        },
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
                adjustments: {
                  list: { object: { group: 'string', reason: { code: 'carc' }, cents: 'integer' } }
                }
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
  g.add('codes', 'std.list.pluck', { label: 'Line Codes', values: { field: 'code' } });
  g.add('modifiers', 'billing.line-modifiers', { label: 'Line Modifiers' });
  g.add('lineCount', 'std.list.length', { label: 'Line Count' });
  g.add('positions', 'std.list.range', { label: 'Line Positions', values: { start: 0 } });
  g.add('lines', 'std.list.map-rule', {
    label: 'Service Lines',
    config: { rule: 'billing.x837-service-line', version: 1, item: 'position' }
  });
  g.add('note', 'billing.narrative-note', { label: 'Narrative Note' });
  g.add('admitted', 'billing.admission-date', { label: 'Admission Date' });
  g.add('msp', 'billing.medicare-secondary-payer', { label: 'Medicare Secondary Payer' });
  g.add('medicareSecond', 'std.logic.condition', {
    label: 'Medicare Billed After Another Payer',
    config: {
      inputs: [
        { name: 'claimFiling', type: 'string' },
        { name: 'priorPayers', type: { list: 'any' } }
      ],
      rules: [
        { field: 'claimFiling', op: 'oneOf', value: MEDICARE },
        { field: 'priorPayers', op: 'present' }
      ]
    }
  });
  g.add('insuranceType', 'std.logic.select', {
    label: 'Only When Medicare Is Billed After Another Payer'
  });
  g.add('x837', 'x837.claim.make');
  g.add('agency', 'billing.agency-837p', { label: 'Agency 837P Rules' });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim', 'place.claim', 'agency.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.patient', 'patient.patient');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
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
  for (const pin of ['name', 'payerId', 'claimFiling']) g.wire(`payer.${pin}`, `x12Payer.${pin}`);
  for (const pin of [
    'mspEmployerPlan',
    'mspEsrd',
    'mspDisability',
    'mspEmployerSize',
    'mspAccident'
  ]) {
    g.wire(`documentation.${pin}`, `msp.${pin}`);
  }
  g.wire('payer.claimFiling', 'medicareSecond.claimFiling');
  g.wire('claim.priorPayers', 'medicareSecond.priorPayers');
  g.wire('medicareSecond.result', 'insuranceType.condition');
  g.wire('msp.insuranceType', 'insuranceType.whenTrue');
  g.wire('insuranceType.result', 'x12Payer.insuranceType');
  g.wire('entry.claim', 'note.claim');
  g.wire('conditions.codes', 'note.conditionCodes');
  g.wire('note.note', 'x837.note');
  g.wire('details.documentation', 'admitted.documentation');
  g.wire('admitted.admissionDate', 'x837.admissionDate');
  g.wire('claim.priorPayers', 'otherPayers.list');
  g.wire('claim.payerClaimNumber', 'frequency.payerClaimNumber');
  g.wire('claim.correctionMethod', 'frequency.correctionMethod');
  g.wire('payer.claimFiling', 'frequency.payerKind');
  g.wire('frequency.frequency', 'x837.frequency');
  g.wire('documentation.signature', 'assignment.key');
  g.wire('assignment.value', 'x837.benefitsAssignment');
  g.wire('documentation.patientCount', 'lines.patientCount');
  g.wire('frequency.replaces', 'x837.payerClaimNumber');
  g.wire('place.placeOfService', 'x837.placeOfService');
  g.wire('details.originDestination', 'modifiers.originDestination');
  g.wire('claim.lines', 'codes.list');
  g.wire('payer.claimFiling', 'modifiers.claimFiling');
  g.wire('codes.list', 'modifiers.codes');
  g.wire('claim.emergency', 'modifiers.emergency');
  g.wire('claim.deceased', 'modifiers.deceased');
  g.wire('documentation.patientCount', 'modifiers.patientCount');
  g.wire('documentation.abnOnFile', 'modifiers.abnOnFile');
  g.wire('documentation.denialExpected', 'modifiers.denialExpected');
  g.wire('modifiers.modifiers', 'lines.modifiers');
  g.wire('details.serviceDate', 'lines.serviceDate');
  g.wire('claim.lines', 'lines.lines', 'lineCount.list');
  g.wire('lineCount.length', 'positions.end');
  g.wire('positions.list', 'lines.list');
  g.wire('claim.claimId', 'x837.claimId');
  g.wire('subscriber.subscriber', 'x837.subscriber');
  g.wire('x12Patient.patient', 'x837.patient');
  g.wire('x12Payer.payer', 'x837.payer');
  g.wire('otherPayers.list', 'x837.otherPayers');
  g.wire('claim.loadedMiles', 'x837.loadedMiles');
  g.wire('conditions.codes', 'x837.conditionCodes');
  g.wire('details.diagnoses', 'x837.diagnoses');
  g.wire('details.pickup', 'x837.pickup');
  g.wire('details.destination', 'x837.dropoff');
  g.wire('lines.line', 'x837.lines');
  g.wire('x837.x837', 'agency.x837');
  g.wire('agency.x837', 'return.x837');
  return g.def;
};

const pure = (inputs: ReturnType<typeof d>[], outputs: ReturnType<typeof d>[]) => ({
  execIn: [],
  execOut: [],
  inputs,
  outputs
});

export const claimGraphs: SeedGraph[] = [
  slot(
    'billing.agency-claim',
    'Agency Claim Rules',
    'An agency rule after the claim is mapped: change claim properties such as modifiers, notes or documentation before the draft is saved. Passes the claim through unchanged until an agency overrides it.',
    pure(
      [d('claim', T.claim, 'Claim', 'The claim the base rules mapped.'), P.pcr(true)],
      [d('claim', T.claim, 'Claim', 'The claim to save.')]
    )
  ),
  slot(
    'billing.agency-837p',
    'Agency 837P Rules',
    'An agency rule after a claim is mapped onto an 837P for a payer: change what this payer is sent (a payer-specific modifier or reference). Passes the 837P claim through unchanged until an agency overrides it.',
    pure(
      [
        d('x837', T.x837, '837P Claim', 'The 837P claim the base rules mapped.'),
        d('claim', T.submission, 'Claim', 'The claim as it goes to this payer.', true)
      ],
      [d('x837', T.x837, '837P Claim', 'The 837P claim to file.')]
    )
  ),
  asRule(
    'billing.transport-reason',
    'Transport Reason',
    'The CMS transport reason (CR104): as the crew reported it, else from the reason for choosing the destination (Transport Reason by Destination Reason table).',
    transportReason()
  ),
  asRule(
    'billing.origin-destination',
    'Origin/Destination Modifiers',
    'The origin letter from the incident location type or type of service (Origin Modifier table) and the destination letter from the type of destination (Destination Modifier table), or H when the report gives no type and the destination is a Medicare-certified hospital.',
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
    'The CRC ambulance condition codes: those the report documents, else by emergency status (Ambulance Conditions table).',
    ambulanceConditions()
  ),
  asRule(
    'billing.line-modifiers',
    'Line Modifiers',
    'The modifiers of each service line: the origin/destination letters, or QL when the patient was pronounced dead before loading, and GM for several patients (Trip Modifiers table); a liability modifier for the payer billed, GY, GA or GZ (Coverage Modifier table); and a modifier for the line code, such as GY on A0888 (Line Code Modifier table).',
    lineModifiers()
  ),
  asRule(
    'billing.modifiers-of-one-line',
    'Modifiers of One Line',
    'The modifiers of one service line, at most four: the leading modifier or the origin/destination letters, the trip modifier, the liability modifier and a modifier for the line code (Line Code Modifier table), each once.',
    oneLineModifiers()
  ),
  asRule(
    'billing.narrative-note',
    'Narrative Note',
    'An 80-character medical necessity summary for the claim note (NTE ADD): level and emergency, pronounced dead, patients transported, miles past the nearest facility, transport reason, conditions and the primary diagnosis, sent when the Narrative Note table says so.',
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
    'The claim frequency code (Claim Frequencies table): 7 with the claim number it replaces only when the payer adjudicated the claim and takes replacements, else 1 for an original claim.',
    claimFrequency()
  ),
  asRule(
    'billing.x837-service-line',
    '837P Service Line',
    'The 837P service line at a position of the claim: the priced line with its modifiers, the date of service and the patients transported.',
    x837ServiceLine()
  ),
  asRule(
    'billing.map-837p',
    'Map 837P Claim',
    'Maps a claim on its way to a payer onto an 837P claim: subscriber and patient, payer (with the Medicare Secondary Payer type when Medicare is billed second), prior payers for coordination of benefits, Claim Frequency, Admission Date, Narrative Note, Place of Service, Ambulance Conditions, Line Modifiers and service lines, then the Agency 837P Rules.',
    map837p()
  )
];
