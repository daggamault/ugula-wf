import { NO_TRANSPORT_CODE, NOTE_LENGTH } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  ADDRESS_PINS,
  asRule,
  atLeast,
  d,
  expr,
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
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      "reported != null ? ['Reported by the crew'] : byDestination != null ? ['From the reason for choosing the destination'] : []"
    )
  );
  g.ret('return');
  g.wire('entry.documentation', 'documentation.documentation');
  g.wire('entry.locations', 'locations.locations');
  g.wire('locations.destinationReason', 'byDestination.key');
  g.wire('documentation.transportReason', 'reason.value', 'reasons.reported');
  g.wire('byDestination.value', 'reason.fallback', 'reasons.byDestination');
  g.wire('reason.result', 'return.transportReason');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const originDestination = (): GraphDef => {
  const g = rule(
    [LOCATIONS_IN, d('trip', T.trip, 'Trip Facts', 'The type of service of the trip.')],
    [
      d(
        'originDestination',
        'string',
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
  g.add('destination', 'std.table.lookup', {
    label: 'Destination Modifier',
    config: shared.lookup(
      'billing.destination-modifier',
      'Destination Modifier',
      'The destination letter of the modifier for each type of destination (eDisposition.21).',
      {
        type: 'string',
        rows: [
          { key: '4221001', value: 'R' },
          { key: '4221003', value: 'H' },
          { key: '4221005', value: 'H' },
          { key: '4221007', value: 'P' },
          { key: '4221011', value: 'E' },
          { key: '4221015', value: 'I' },
          { key: '4221021', value: 'P' },
          { key: '4221023', value: 'H' },
          { key: '4221025', value: 'J' },
          { key: '4221027', value: 'D' },
          { key: '4221029', value: 'E' },
          { key: '4221033', value: 'E' },
          { key: '4221041', value: 'N' }
        ]
      }
    )
  });
  g.add('codes', 'std.list.make', { label: 'Origin and Destination', config: { count: 2 } });
  g.add('modifier', 'std.text.join', { label: 'Origin Then Destination' });
  g.ret('return');
  g.wire('entry.locations', 'locations.locations');
  g.wire('entry.trip', 'trip.trip');
  g.wire('locations.pickupType', 'origin.locationType');
  g.wire('trip.serviceType', 'origin.serviceType');
  g.wire('locations.destinationType', 'destination.key');
  g.wire('origin.code', 'codes.item1');
  g.wire('destination.value', 'codes.item2');
  g.wire('codes.list', 'modifier.items');
  g.wire('modifier.text', 'return.originDestination');
  g.wire('origin.rules', 'return.reasons');
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
      'The CRC ambulance condition codes billed when the report documents none.',
      table(
        [field('emergency', 'boolean', 'Emergency')],
        [field('codes', { list: 'string' }, 'CRC condition codes')],
        [{ label: 'Emergency', when: { emergency: is(true) }, set: { codes: ['09', '06'] } }],
        { codes: ['09'] }
      )
    )
  });
  g.add('codes', 'std.expr', {
    label: 'Documented Conditions, Else by Emergency',
    config: { expression: 'len(documented ?? []) > 0 ? documented : decided' }
  });
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      "len(documented ?? []) > 0 ? ['Documented on the report'] : concat(['Not documented, so by emergency status'], rules)"
    )
  );
  g.ret('return');
  g.wire('entry.emergency', 'decided.emergency');
  g.wire('entry.documented', 'codes.documented', 'reasons.documented');
  g.wire('decided.codes', 'codes.decided');
  g.wire('decided.rules', 'reasons.rules');
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
        'string',
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
      d('codes', { list: 'string' }, 'Line Codes', 'The HCPCS codes on the claim, line by line.'),
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
  g.add('byCode', 'std.table.lookup', {
    label: 'Line Code Modifier',
    config: shared.lookup(
      'billing.code-modifier',
      'Line Code Modifier',
      'A modifier a single line carries because of its HCPCS code, such as GY on A0888 non-covered miles.',
      { type: 'string', rows: [{ key: 'A0888', value: 'GY' }] }
    )
  });
  g.add('modifiers', 'std.expr', {
    ...expr(
      'Each Line, Trip Then Liability Then Code',
      "map(codes, (c, n) => slice(unique(filter([leading ?? originDestination, added, coverage, byCode[n]], m => m != null && m != '')), 0, max))"
    ),
    values: { max: MAX_LINE_MODIFIERS }
  });
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Why',
      'concat(trip, coverage, map(filter(map(codes, (c, n) => { code: c, modifier: byCode[n] }), l => l.modifier != null && l.modifier != ""), l => l.code + " carries " + l.modifier))'
    )
  );
  g.ret('return');
  g.wire('entry.deceased', 'trip.deceased');
  g.wire('entry.patientCount', 'trip.patientCount');
  for (const pin of ['claimFiling', 'codes', 'emergency', 'abnOnFile', 'denialExpected']) {
    g.wire(`entry.${pin}`, `coverage.${pin}`);
  }
  g.wire('entry.codes', 'byCode.keys', 'modifiers.codes');
  g.wire('entry.originDestination', 'modifiers.originDestination');
  g.wire('trip.leading', 'modifiers.leading');
  g.wire('trip.added', 'modifiers.added');
  g.wire('coverage.modifier', 'modifiers.coverage');
  g.wire('byCode.values', 'modifiers.byCode');
  g.wire('modifiers.result', 'return.modifiers');
  g.wire('trip.rules', 'reasons.trip');
  g.wire('coverage.rules', 'reasons.coverage');
  g.wire('byCode.values', 'reasons.byCode');
  g.wire('entry.codes', 'reasons.codes');
  g.wire('reasons.result', 'return.reasons');
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

const NARRATIVE = `substr(join(filter([
  lines[0].code + (emergency ? ' EMERGENCY' : ' NON-EMERGENCY'),
  deceased ? 'PRONOUNCED DEAD BEFORE LOADING' : null,
  (patientCount ?? 1) > 1 ? text(patientCount) + ' PATIENTS TRANSPORTED' : null,
  nonCoveredMiles > 0 ? text(nonCoveredMiles) + ' MI PAST NEAREST FACILITY' : null,
  transportReason != null ? 'REASON ' + transportReason : null,
  len(conditionCodes ?? []) > 0 ? 'COND ' + join(conditionCodes, ' ') : null,
  len(diagnoses) > 0 ? 'DX ' + diagnoses[0] : null
], x => x != null), '; '), 0, length)`;

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
  g.add(
    'nonCovered',
    'std.expr',
    expr(
      'Non-Covered Miles Billed',
      "sum(map(filter(lines, l => l.code == 'A0888'), l => l.units))"
    )
  );
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
  g.add('text', 'std.expr', {
    ...expr('Medical Necessity Summary', NARRATIVE),
    values: { length: NOTE_LENGTH }
  });
  g.add('note', 'std.logic.select', { label: 'Only When Sent' });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
  g.wire('claim.lines', 'nonCovered.lines', 'text.lines');
  g.wire('payer.claimFiling', 'decide.claimFiling');
  g.wire('claim.deceased', 'decide.deceased', 'text.deceased');
  g.wire('documentation.patientCount', 'decide.patientCount', 'text.patientCount');
  g.wire('nonCovered.result', 'decide.nonCoveredMiles', 'text.nonCoveredMiles');
  g.wire('claim.emergency', 'text.emergency');
  g.wire('documentation.transportReason', 'text.transportReason');
  g.wire('entry.conditionCodes', 'text.conditionCodes');
  g.wire('details.diagnoses', 'text.diagnoses');
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
  g.add(
    'reasons',
    'std.expr',
    expr('Why', "admissionDate != null ? ['The admission date is documented'] : []")
  );
  g.ret('return');
  g.wire('entry.documentation', 'documentation.documentation');
  g.wire('documentation.admissionDate', 'return.admissionDate', 'reasons.admissionDate');
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
        'The payer claim number of the claim this one replaces, if any.',
        true
      )
    ],
    [
      d('frequency', 'string', 'Frequency', 'The claim frequency code: 1 original, 7 replacement.'),
      P.reasons('this frequency was billed')
    ]
  );
  g.add('original', 'std.logic.is-null', { label: 'No Claim to Replace' });
  g.add('frequency', 'std.logic.select', {
    label: 'Original or Replacement',
    values: { whenTrue: '1', whenFalse: '7' }
  });
  g.add(
    'reasons',
    'std.expr',
    expr('Why', "original ? ['No earlier claim to replace'] : ['Replaces the payer claim on file']")
  );
  g.ret('return');
  g.wire('entry.payerClaimNumber', 'original.value');
  g.wire('original.result', 'frequency.condition', 'reasons.original');
  g.wire('frequency.result', 'return.frequency');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const X837_OUT = d('x837', T.x837, '837P Claim', 'The 837P claim the file serializes.');

const map837p = (): GraphDef => {
  const g = rule([SUBMISSION_IN], [X837_OUT]);
  g.add('claim', 'billing.submission.break');
  g.add('payer', 'billing.submitted-payer.break');
  g.add('patient', 'billing.submitted-patient.break');
  g.add('details', 'billing.submitted-details.break');
  g.add('documentation', 'billing.documentation.break');
  g.add('conditions', 'billing.ambulance-conditions', { label: 'Ambulance Conditions' });
  g.add('weight', 'std.expr', {
    label: 'Weight in Pounds',
    config: { expression: 'weightKg == null ? null : round(weightKg * 2.20462)' }
  });
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
          type: { list: { object: { group: 'string', reason: 'string', cents: 'integer' } } },
          from: 'adjustments'
        }
      ]
    }
  });
  g.add('frequency', 'billing.claim-frequency', { label: 'Claim Frequency' });
  g.add('place', 'billing.place-of-service', { label: 'Place of Service' });
  g.add('codes', 'std.list.pluck', { label: 'Line Codes', values: { field: 'code' } });
  g.add('modifiers', 'billing.line-modifiers', { label: 'Line Modifiers' });
  g.add(
    'lines',
    'std.expr',
    expr(
      'Service Lines',
      'map(lines, (l, n) => { code: l.code, modifiers: modifiers[n] ?? [], chargeCents: l.totalCents, units: l.units, serviceDate: serviceDate })'
    )
  );
  g.add('note', 'billing.narrative-note', { label: 'Narrative Note' });
  g.add('admitted', 'billing.admission-date', { label: 'Admission Date' });
  g.add('msp', 'billing.medicare-secondary-payer', { label: 'Medicare Secondary Payer' });
  g.add(
    'insuranceType',
    'std.expr',
    expr(
      'Only When Medicare Is Billed After Another Payer',
      "contains(['MA', 'MB'], claimFiling) && len(priorPayers ?? []) > 0 ? insuranceType : null"
    )
  );
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
  g.wire('documentation.weightKg', 'weight.weightKg');
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
  for (const pin of ['mspEmployerPlan', 'mspEsrd', 'mspDisability', 'mspAccident']) {
    g.wire(`documentation.${pin}`, `msp.${pin}`);
  }
  g.wire('payer.claimFiling', 'insuranceType.claimFiling');
  g.wire('claim.priorPayers', 'insuranceType.priorPayers');
  g.wire('msp.insuranceType', 'insuranceType.insuranceType');
  g.wire('insuranceType.result', 'x12Payer.insuranceType');
  g.wire('entry.claim', 'note.claim');
  g.wire('conditions.codes', 'note.conditionCodes');
  g.wire('note.note', 'x837.note');
  g.wire('details.documentation', 'admitted.documentation');
  g.wire('admitted.admissionDate', 'x837.admissionDate');
  g.wire('claim.priorPayers', 'otherPayers.list');
  g.wire('claim.payerClaimNumber', 'frequency.payerClaimNumber', 'x837.payerClaimNumber');
  g.wire('frequency.frequency', 'x837.frequency');
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
  g.wire('claim.lines', 'lines.lines');
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
  g.wire('lines.result', 'x837.lines');
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
    'The origin letter from the incident location type or type of service (Origin Modifier table) and the destination letter from the type of destination (Destination Modifier table).',
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
    'The claim frequency code: 1 for an original claim, 7 when it replaces a claim the payer has on file.',
    claimFrequency()
  ),
  asRule(
    'billing.map-837p',
    'Map 837P Claim',
    'Maps a claim on its way to a payer onto an 837P claim: subscriber and patient, payer (with the Medicare Secondary Payer type when Medicare is billed second), prior payers for coordination of benefits, Claim Frequency, Admission Date, Narrative Note, Place of Service, Ambulance Conditions, Line Modifiers and service lines, then the Agency 837P Rules.',
    map837p()
  )
];
