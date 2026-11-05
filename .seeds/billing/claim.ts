import { NO_TRANSPORT_CODE } from '@ugula/billing';
import type { GraphDef } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  ADDRESS_PINS,
  asRule,
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
      P.tripType(),
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
  for (const pin of ['level', 'emergency', 'loadedMiles']) g.wire(`service.${pin}`, `claim.${pin}`);
  for (const pin of ['tripType', 'coverages', 'lines', 'totalCents', 'report']) {
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
      d('codes', { list: 'string' }, 'Line Codes', 'The HCPCS codes on the claim.')
    ],
    [
      d('modifiers', { list: 'string' }, 'Modifiers', 'The modifiers every service line carries.'),
      P.reasons('these modifiers were added')
    ]
  );
  g.add('coverage', 'std.table.decide', {
    label: 'Coverage Modifier',
    config: shared.decision(
      'billing.coverage-modifier',
      'Coverage Modifier',
      'Adds a liability modifier for the payer being billed, such as GY when Medicare does not cover the service.',
      table(
        [
          field('claimFiling', 'string', 'Claim filing indicator'),
          field('codes', { list: 'string' }, 'HCPCS codes')
        ],
        [field('modifier', 'string', 'Modifier')],
        [
          {
            label: 'Medicare does not cover treatment without transport',
            when: { claimFiling: oneOf('MA', 'MB'), codes: oneOf(NO_TRANSPORT_CODE) },
            set: { modifier: 'GY' }
          }
        ]
      )
    )
  });
  g.add('modifiers', 'std.list.make', { label: 'Line Modifiers', config: { count: 2 } });
  g.ret('return');
  g.wire('entry.claimFiling', 'coverage.claimFiling');
  g.wire('entry.codes', 'coverage.codes');
  g.wire('entry.originDestination', 'modifiers.item1');
  g.wire('coverage.modifier', 'modifiers.item2');
  g.wire('modifiers.list', 'return.modifiers');
  g.wire('coverage.rules', 'return.reasons');
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
  g.add('shared', 'std.object.make', {
    label: 'Every Line',
    config: {
      fields: [
        { name: 'modifiers', type: { list: 'string' } },
        { name: 'serviceDate', type: 'string' }
      ]
    }
  });
  g.add('lines', 'std.list.reshape', {
    label: 'Service Lines',
    config: {
      fields: [
        { name: 'code', type: 'string', from: 'code' },
        { name: 'modifiers', type: { list: 'string' } },
        { name: 'chargeCents', type: 'integer', from: 'totalCents' },
        { name: 'units', type: 'number', from: 'units' },
        { name: 'serviceDate', type: 'string' }
      ]
    }
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
  g.wire('claim.priorPayers', 'otherPayers.list');
  g.wire('claim.payerClaimNumber', 'frequency.payerClaimNumber', 'x837.payerClaimNumber');
  g.wire('frequency.frequency', 'x837.frequency');
  g.wire('place.placeOfService', 'x837.placeOfService');
  g.wire('details.originDestination', 'modifiers.originDestination');
  g.wire('claim.lines', 'codes.list');
  g.wire('payer.claimFiling', 'modifiers.claimFiling');
  g.wire('codes.list', 'modifiers.codes');
  g.wire('modifiers.modifiers', 'shared.modifiers');
  g.wire('details.serviceDate', 'shared.serviceDate');
  g.wire('claim.lines', 'lines.list');
  g.wire('shared.object', 'lines.shared');
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
  g.wire('lines.list', 'x837.lines');
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
    'The modifiers on every service line: the origin/destination letters, then a liability modifier for the payer billed (Coverage Modifier table), such as GY for Medicare treat-no-transport.',
    lineModifiers()
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
    'Maps a claim on its way to a payer onto an 837P claim: subscriber and patient, payer, prior payers for coordination of benefits, Claim Frequency, Place of Service, Ambulance Conditions, Line Modifiers and service lines, then the Agency 837P Rules.',
    map837p()
  )
];
