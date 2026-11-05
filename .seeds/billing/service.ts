import { TRIP_TYPE_FIELD } from '@ugula/billing';
import type { GraphDef, Json } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  above,
  asRule,
  asStage,
  atLeast,
  d,
  exit,
  expr,
  field,
  is,
  named,
  notOneOf,
  oneOf,
  P,
  rule,
  shared,
  stage,
  summarize,
  T,
  table
} from './shared.ts';

export const INTERFACILITY = ['2205005', '2205015', '2205017', '2205019'];

const NON_PATIENT_SERVICES = [
  '2205011',
  '2205013',
  '2205021',
  '2205023',
  '2205025',
  '2205027',
  '2205029',
  '2205031',
  '2205033',
  '2205035'
];

const TRANSPORTED = ['4230001', '4230003'];

const TRANSPORTED_INCIDENTS = ['4212013', '4212017', '4212023', '4212033'];

const TRIP_TYPE_OUT = d('tripType', 'string', 'Trip Type', 'The trip type to bill the report as.');

const tripType = (): GraphDef => {
  const g = rule(
    [d('trip', T.trip, 'Trip Facts', 'The dispositions and type of service of the trip.')],
    [TRIP_TYPE_OUT, P.reason(), P.reasons('the trip type was chosen')]
  );
  g.add('trip', 'billing.trip-facts.break');
  g.add('decide', 'std.table.decide', {
    label: 'Trip Type',
    config: shared.decision(
      'billing.trip-type',
      'Trip Type',
      'Decides the trip type from the report dispositions and the type of service.',
      table(
        [
          field('incidentDisposition', 'string', 'Incident/patient disposition · eDisposition.12'),
          field('unitDisposition', 'string', 'Unit disposition · eDisposition.27'),
          field('patientEvaluation', 'string', 'Patient evaluation/care · eDisposition.28'),
          field('transportDisposition', 'string', 'Transport disposition · eDisposition.30'),
          field('serviceType', 'string', 'Type of service requested · eResponse.05')
        ],
        [field('tripType', 'string', 'Trip type')],
        [
          {
            label: 'Cancelled, or no patient contact',
            when: { incidentDisposition: oneOf('4212007', '4212009', '4212011') },
            set: { tripType: 'noClaim' }
          },
          {
            label: 'Assist, standby or non-patient transport',
            when: {
              incidentDisposition: oneOf(
                '4212001',
                '4212003',
                '4212005',
                '4212039',
                '4212041',
                '4212043'
              )
            },
            set: { tripType: 'noClaim' }
          },
          {
            label: 'Unit cancelled, made no patient contact, or had no patient',
            when: { unitDisposition: oneOf('4227003', '4227005', '4227007', '4227009', '4227011') },
            set: { tripType: 'noClaim' }
          },
          {
            label: 'Non-patient transport',
            when: { transportDisposition: oneOf('4230011') },
            set: { tripType: 'noClaim' }
          },
          {
            label: 'Non-patient service requested and nobody transported',
            when: {
              serviceType: oneOf(...NON_PATIENT_SERVICES),
              incidentDisposition: notOneOf(...TRANSPORTED_INCIDENTS),
              transportDisposition: notOneOf(...TRANSPORTED)
            },
            set: { tripType: 'noClaim' }
          },
          {
            label: 'Patient refused care',
            when: { incidentDisposition: oneOf('4212025') },
            set: { tripType: 'refusal' }
          },
          {
            label: 'Patient refused care and transport',
            when: {
              patientEvaluation: oneOf('4228003', '4228007'),
              transportDisposition: oneOf('4230009', '4230013')
            },
            set: { tripType: 'refusal' }
          },
          {
            label: 'Patient treated and not transported',
            when: {
              incidentDisposition: oneOf(
                '4212015',
                '4212019',
                '4212021',
                '4212027',
                '4212029',
                '4212031',
                '4212035',
                '4212037'
              )
            },
            set: { tripType: 'treatNoTransport' }
          },
          {
            label: 'Patient not transported by this unit',
            when: { transportDisposition: oneOf('4230005', '4230007', '4230009', '4230013') },
            set: { tripType: 'treatNoTransport' }
          },
          {
            label: 'Scheduled or interfacility transport',
            when: { serviceType: oneOf(...INTERFACILITY, '2205007') },
            set: { tripType: 'scheduled' }
          },
          {
            label: 'Emergency response',
            when: { serviceType: oneOf('2205001', '2205003', '2205009') },
            set: { tripType: 'emergency' }
          },
          {
            label: 'Patient treated and transported by this unit',
            when: { incidentDisposition: oneOf(...TRANSPORTED_INCIDENTS) },
            set: { tripType: 'emergency' }
          },
          {
            label: 'Patient transported by this unit',
            when: { transportDisposition: oneOf(...TRANSPORTED) },
            set: { tripType: 'emergency' }
          }
        ],
        { tripType: 'emergency' }
      )
    )
  });
  g.ret('return');
  g.wire('entry.trip', 'trip.trip');
  for (const pin of [
    'incidentDisposition',
    'unitDisposition',
    'patientEvaluation',
    'transportDisposition',
    'serviceType'
  ]) {
    g.wire(`trip.${pin}`, `decide.${pin}`);
  }
  g.wire('decide.tripType', 'return.tripType');
  g.wire('decide.rule', 'return.reason');
  g.wire('decide.rules', 'return.reasons');
  return g.def;
};

const classifyTrip = (): GraphDef => {
  const g = rule([P.facts()], [TRIP_TYPE_OUT, P.reason(), P.reasons('the trip type was chosen')]);
  g.add('facts', 'billing.encounter-facts.break');
  g.add('base', 'billing.trip-type', { label: 'Trip Type' });
  g.add('agency', 'billing.agency-trip-type', { label: 'Agency Trip Type' });
  g.add(
    'reasons',
    'std.expr',
    expr(
      'Reasons for the Trip Type Billed',
      "tripType == baseType ? reasons : [reason ?? 'Changed by an agency rule']"
    )
  );
  g.ret('return');
  g.wire('entry.facts', 'facts.facts', 'agency.facts');
  g.wire('facts.trip', 'base.trip');
  g.wire('base.tripType', 'agency.tripType', 'reasons.baseType');
  g.wire('base.reason', 'agency.reason');
  g.wire('agency.tripType', 'return.tripType', 'reasons.tripType');
  g.wire('agency.reason', 'return.reason', 'reasons.reason');
  g.wire('base.reasons', 'reasons.reasons');
  g.wire('reasons.result', 'return.reasons');
  return g.def;
};

const tripContext = `{ trip: trip }`;

const NO_CLAIM_SUMMARY = `'No claim looks needed for this report' +
  (${named('reason', 'null')} != null ? ' (' + reason + ')' : '') +
  '; skip it, or choose the trip type and make a claim if care was given'`;

const decideClaim = (): GraphDef => {
  const g = stage([P.pcr(), P.facts()], [TRIP_TYPE_OUT, P.reason()], {
    claim: exit(
      'Claim',
      'The report is billed, as the trip type it was classified or confirmed as.'
    ),
    skip: exit('Skip', 'A biller confirmed no claim is needed.')
  });
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('needed', 'std.flow.switch', {
    label: 'Claim Needed?',
    config: { cases: ['noClaim'] }
  });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('context', 'std.expr', expr('Trip Context', tripContext));
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('noClaim', 'std.human.task', {
    label: 'Confirm No Claim',
    config: {
      title: 'Confirm no claim',
      queue: 'billing-review',
      instructions:
        'This report looks like a cancelled call or a trip without patient contact, so no claim would be made. Skip it, or choose the trip type that was billed and make a claim if care was given.',
      fields: [{ ...TRIP_TYPE_FIELD, required: ['claim'] }],
      outcomes: ['skip', 'claim'],
      hints: {
        skip: 'Makes no claim for this report.',
        claim: 'Makes a claim for this report as the chosen trip type.'
      }
    }
  });
  g.ret('classified', 'claim');
  g.ret('confirmed', 'claim');
  g.ret('skipped', 'skip');
  g.wire('entry.exec', 'needed.exec');
  g.wire('entry.facts', 'classify.facts');
  g.wire('entry.pcr', 'trip.pcr', 'subject.pcr');
  g.wire('classify.tripType', 'needed.value', 'trip.tripType');
  g.wire('classify.tripType', 'classified.tripType', 'skipped.tripType');
  g.wire('classify.reason', 'trip.reason', 'classified.reason');
  g.wire('classify.reason', 'confirmed.reason', 'skipped.reason');
  g.wire('trip.trip', 'context.trip');
  g.wire('needed.default', 'classified.exec');
  g.wire('needed.noClaim', 'noClaim.exec');
  g.wire('context.result', 'noClaim.context');
  g.wire('subject.subject', 'noClaim.subject');
  summarize(g, 'noClaim', NO_CLAIM_SUMMARY, { reason: 'classify.reason' });
  g.wire('noClaim.claim', 'confirmed.exec');
  g.wire('noClaim.tripType', 'confirmed.tripType');
  g.wire('noClaim.skip', 'skipped.exec');
  return g.def;
};

const loadedMiles = (): GraphDef => {
  const g = rule(
    [
      d(
        'sceneOdometer',
        'number',
        'Scene Odometer',
        'The odometer when the unit arrived on scene.',
        true
      ),
      d(
        'destinationOdometer',
        'number',
        'Destination Odometer',
        'The odometer when the unit arrived at the destination.',
        true
      )
    ],
    [
      d(
        'loadedMiles',
        'number',
        'Loaded Miles',
        'Destination minus scene, never below zero, or nothing when either is missing.',
        true
      )
    ]
  );
  g.add('scene', 'std.logic.coalesce', { label: 'Scene Odometer or 0', values: { fallback: 0 } });
  g.add('destination', 'std.logic.coalesce', {
    label: 'Destination Odometer or 0',
    values: { fallback: 0 }
  });
  g.add('distance', 'std.math.subtract', { label: 'Destination Minus Scene' });
  g.add('positive', 'std.math.max', { label: 'Never Below Zero', values: { b: 0 } });
  g.add('rounded', 'std.math.round', {
    label: 'Hundredths, Without Float Noise',
    values: { digits: 2 }
  });
  g.add('noScene', 'std.logic.is-null', { label: 'No Scene Odometer' });
  g.add('noDestination', 'std.logic.is-null', { label: 'No Destination Odometer' });
  g.add('missing', 'std.logic.or', { label: 'Either Missing' });
  g.add('miles', 'std.logic.select', { label: 'Miles When Both Are Recorded' });
  g.ret('return');
  g.wire('entry.sceneOdometer', 'scene.value', 'noScene.value');
  g.wire('entry.destinationOdometer', 'destination.value', 'noDestination.value');
  g.wire('destination.result', 'distance.a');
  g.wire('scene.result', 'distance.b');
  g.wire('distance.result', 'positive.a');
  g.wire('positive.result', 'rounded.value');
  g.wire('noScene.result', 'missing.a');
  g.wire('noDestination.result', 'missing.b');
  g.wire('missing.result', 'miles.condition');
  g.wire('rounded.result', 'miles.whenFalse');
  g.wire('miles.result', 'return.loadedMiles');
  return g.def;
};

const IV_ROUTES = ['9927021', '9927023', '9927069'];

const IV_SOLUTIONS = [
  '9863',
  '4850',
  '56489',
  '313002',
  '1807639',
  '309778',
  '1795477',
  '1795480',
  '1795481',
  '2262603',
  '260258',
  '237653',
  '847630',
  '847627'
];

const ALS2_PROCEDURES = [
  '16883004',
  '182682004',
  '429161001',
  '232681006',
  '427331009',
  '439868004',
  '182705007',
  '232690004',
  '785906002',
  '785907006',
  '449860009',
  '112798008',
  '232674004',
  '232678001',
  '232679009',
  '232682004',
  '308842001',
  '426220008',
  '429500007',
  '428909008',
  '250980009',
  '180325003',
  '426961001',
  '703984002',
  '275148007',
  '18590009',
  '59218006',
  '233181000',
  '233527006',
  '233528001',
  '233530004',
  '233534008',
  '302776009',
  '1290622004',
  '173067007',
  '398142004',
  '232689008',
  '232692007',
  '430824005',
  '440009003'
];

const ALS_ASSESSMENT_YES = '9923003';

const LEVEL_OUT = d('level', 'string', 'Level of Service', 'BLS, ALS1, ALS2 or SCT.');

const levelOfService = (): GraphDef => {
  const g = rule([P.facts(), P.findings(true)], [LEVEL_OUT, P.reasons('the level was chosen')]);
  g.add('facts', 'billing.encounter-facts.break');
  g.add('trip', 'billing.trip-facts.break');
  g.add('clinical', 'billing.clinical-facts.break');
  g.add('ivMedications', 'std.list.where', {
    label: 'IV/IO Medications Coded',
    config: { field: 'route', op: 'oneOf', value: IV_ROUTES }
  });
  g.add('ivDrugs', 'std.list.where', {
    label: 'Not IV Solutions',
    config: { field: 'medication', op: 'notOneOf', value: IV_SOLUTIONS }
  });
  g.add('findings', 'billing.findings.break');
  g.add('procedures', 'std.logic.coalesce', {
    label: 'Narrative Procedures',
    values: { fallback: [] }
  });
  g.add('procedureCount', 'std.list.length', { label: 'How Many ALS2 Procedures' });
  g.add('codedProcedures', 'std.list.where', {
    label: 'ALS2 Procedures Coded',
    config: { field: 'procedure', op: 'oneOf', value: ALS2_PROCEDURES }
  });
  g.add('level', 'std.table.decide', {
    label: 'Level of Service',
    config: shared.decision(
      'billing.service-level',
      'Level of Service',
      'Decides BLS, ALS1, ALS2 or SCT from the level of care, CMS service level, IV/IO medications, ALS2 procedures and the ALS assessment.',
      table(
        [
          field('levelOfCare', 'string', 'Level of care provided · eDisposition.32'),
          field('cmsServiceLevel', 'string', 'CMS service level · ePayment.50'),
          field('serviceType', 'string', 'Type of service requested · eResponse.05'),
          field('codedIvMedications', 'integer', 'IV/IO medications coded'),
          field('narrativeIvDoses', 'integer', 'IV/IO doses in the narrative'),
          field('narrativeProcedures', 'integer', 'ALS2 procedures in the narrative'),
          field('codedProcedures', 'integer', 'ALS2 procedures coded · eProcedures.03'),
          field('alsAssessment', 'string', 'ALS assessment performed and warranted · ePayment.49')
        ],
        [field('level', 'string', 'Level of service')],
        [
          {
            label: 'Critical care documented on an interfacility transport',
            when: { levelOfCare: is('4232009'), serviceType: oneOf(...INTERFACILITY) },
            set: { level: 'SCT' }
          },
          {
            label: 'Crew reported specialty care on an interfacility transport',
            when: { cmsServiceLevel: is('2650015'), serviceType: oneOf(...INTERFACILITY) },
            set: { level: 'SCT' }
          },
          {
            label: 'ALS2 procedure coded',
            when: { codedProcedures: atLeast(1) },
            set: { level: 'ALS2' }
          },
          {
            label: 'ALS2 procedures in the narrative',
            when: { narrativeProcedures: atLeast(1) },
            set: { level: 'ALS2' }
          },
          {
            label: 'Three or more IV/IO medications coded',
            when: { codedIvMedications: atLeast(3) },
            set: { level: 'ALS2' }
          },
          {
            label: 'Three or more IV/IO doses in the narrative',
            when: { narrativeIvDoses: atLeast(3) },
            set: { level: 'ALS2' }
          },
          {
            label: 'Crew reported ALS2',
            when: { cmsServiceLevel: is('2650005') },
            set: { level: 'ALS2' }
          },
          {
            label: 'ALS care documented',
            when: { levelOfCare: oneOf('4232003', '4232005') },
            set: { level: 'ALS1' }
          },
          {
            label: 'ALS assessment performed and warranted',
            when: { alsAssessment: is(ALS_ASSESSMENT_YES) },
            set: { level: 'ALS1' }
          },
          {
            label: 'Crew reported ALS1',
            when: { cmsServiceLevel: oneOf('2650001', '2650003') },
            set: { level: 'ALS1' }
          },
          {
            label: 'IV/IO medications coded',
            when: { codedIvMedications: atLeast(1) },
            set: { level: 'ALS1' }
          },
          {
            label: 'IV/IO doses in the narrative',
            when: { narrativeIvDoses: atLeast(1) },
            set: { level: 'ALS1' }
          },
          {
            label: 'BLS care documented',
            when: { levelOfCare: is('4232001') },
            set: { level: 'BLS' }
          }
        ],
        { level: 'BLS' }
      )
    )
  });
  g.ret('return');
  g.wire('entry.facts', 'facts.facts');
  g.wire('entry.findings', 'findings.findings');
  g.wire('facts.trip', 'trip.trip');
  g.wire('facts.clinical', 'clinical.clinical');
  g.wire('clinical.medications', 'ivMedications.list');
  g.wire('findings.procedures', 'procedures.value');
  g.wire('procedures.result', 'procedureCount.list');
  g.wire('trip.levelOfCare', 'level.levelOfCare');
  g.wire('trip.cmsServiceLevel', 'level.cmsServiceLevel');
  g.wire('trip.serviceType', 'level.serviceType');
  g.wire('ivMedications.list', 'ivDrugs.list');
  g.wire('ivDrugs.count', 'level.codedIvMedications');
  g.wire('findings.ivDoses', 'level.narrativeIvDoses');
  g.wire('procedureCount.length', 'level.narrativeProcedures');
  g.wire('clinical.procedures', 'codedProcedures.list');
  g.wire('codedProcedures.count', 'level.codedProcedures');
  g.wire('trip.alsAssessment', 'level.alsAssessment');
  g.wire('level.level', 'return.level');
  g.wire('level.rules', 'return.reasons');
  return g.def;
};

const emergencyStatus = (): GraphDef => {
  const g = rule(
    [d('trip', T.trip, 'Trip Facts', 'The response mode and CMS service level of the trip.')],
    [
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
      P.reasons('the trip is or is not an emergency')
    ]
  );
  g.add('trip', 'billing.trip-facts.break');
  g.add('emergency', 'std.table.decide', {
    label: 'Emergency Response',
    config: shared.decision(
      'billing.emergency-response',
      'Emergency Response',
      'Decides whether a trip is billed as an emergency from the response mode and the CMS service level.',
      table(
        [
          field('responseMode', 'string', 'Response mode to scene · eResponse.23'),
          field('cmsServiceLevel', 'string', 'CMS service level · ePayment.50')
        ],
        [field('emergency', 'boolean', 'Emergency')],
        [
          {
            label: 'Immediate response to the call',
            when: { responseMode: oneOf('2223001', '2223003', '2223007') },
            set: { emergency: true }
          },
          {
            label: 'No response mode, and the crew reported an emergency level',
            when: { responseMode: is(null), cmsServiceLevel: oneOf('2650003', '2650009') },
            set: { emergency: true }
          }
        ],
        { emergency: false }
      )
    )
  });
  g.ret('return');
  g.wire('entry.trip', 'trip.trip');
  g.wire('trip.responseMode', 'emergency.responseMode');
  g.wire('trip.cmsServiceLevel', 'emergency.cmsServiceLevel');
  g.wire('emergency.emergency', 'return.emergency');
  g.wire('emergency.rules', 'return.reasons');
  return g.def;
};

const SERVICE_OUT = d(
  'service',
  T.service,
  'Service',
  'The suggested level of service, emergency status and loaded miles, with the reasons for the level.'
);

const nonCoveredMiles = (): GraphDef => {
  const g = rule(
    [P.facts(), d('loadedMiles', 'number', 'Loaded Miles', 'The loaded miles of the trip.', true)],
    [
      d(
        'nonCoveredMiles',
        'number',
        'Non-Covered Miles',
        'Miles beyond the nearest appropriate facility, billed on A0888, or nothing.',
        true
      ),
      P.reasons('miles were or were not billed as non-covered')
    ]
  );
  g.add('facts', 'billing.encounter-facts.break');
  g.add('documentation', 'billing.documentation.break');
  g.add('reason', 'billing.transport-reason', { label: 'Transport Reason' });
  g.add(
    'excess',
    'std.expr',
    expr(
      'Miles Past the Closest Hospital',
      'loadedMiles == null || closest == null ? null : round(loadedMiles - closest, 2)'
    )
  );
  g.add('decide', 'std.table.decide', {
    label: 'Non-Covered Miles',
    config: shared.decision(
      'billing.non-covered-miles',
      'Non-Covered Miles',
      'Decides when the miles past the closest hospital (ePayment.48) are billed as non-covered (A0888 with GY): when the patient chose a farther facility.',
      table(
        [
          field('transportReason', 'string', 'Transport reason (CR104)'),
          field('excessMiles', 'number', 'Miles past the closest hospital')
        ],
        [field('nonCovered', 'boolean', 'Bill the excess as non-covered')],
        [
          {
            label: 'The patient chose a farther facility',
            when: { transportReason: oneOf('B', 'C'), excessMiles: above(0) },
            set: { nonCovered: true }
          }
        ],
        { nonCovered: false }
      )
    )
  });
  g.add('miles', 'std.logic.select', { label: 'Excess Miles When Non-Covered' });
  g.ret('return');
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.documentation', 'documentation.documentation', 'reason.documentation');
  g.wire('facts.locations', 'reason.locations');
  g.wire('entry.loadedMiles', 'excess.loadedMiles');
  g.wire('documentation.closestFacilityMiles', 'excess.closest');
  g.wire('reason.transportReason', 'decide.transportReason');
  g.wire('excess.result', 'decide.excessMiles', 'miles.whenTrue');
  g.wire('decide.nonCovered', 'miles.condition');
  g.wire('miles.result', 'return.nonCoveredMiles');
  g.wire('decide.rules', 'return.reasons');
  return g.def;
};

const DEAD_AT_SCENE = ['4212013', '4212015', '4212017', '4212019'];

const NOT_TRANSPORTED = ['4230005', '4230007', '4230009', '4230013'];

const EXPIRED_IN_FIELD = '3018003';

const ARREST_AFTER_LOADING = ['3018001', '3018005', '3018009'];

const deceasedHandling = (): GraphDef => {
  const g = rule(
    [
      d('service', T.service, 'Service', 'The service suggested for the trip type.'),
      d('trip', T.trip, 'Trip Facts', 'The dispositions and cardiac arrest outcome of the trip.')
    ],
    [SERVICE_OUT]
  );
  g.add('trip', 'billing.trip-facts.break');
  g.add('decide', 'std.table.decide', {
    label: 'Pronounced Dead',
    config: shared.decision(
      'billing.pronounced-dead',
      'Pronounced Dead',
      'Decides whether the patient was pronounced dead after the ambulance was called and before being loaded, before or after it reached them, which Medicare pays as the BLS base rate with QL and no mileage (Benefit Policy Manual ch. 10 §10.2.6); a death after loading is billed as the service furnished.',
      table(
        [
          field('incidentDisposition', 'string', 'Incident/patient disposition · eDisposition.12'),
          field('transportDisposition', 'string', 'Transport disposition · eDisposition.30'),
          field('arrestOutcome', 'string', 'End of the cardiac arrest event · eArrest.18')
        ],
        [field('deceased', 'boolean', 'Pronounced dead before loading')],
        [
          {
            label: 'Resuscitation went on after loading (expired in the ED, ROSC or ongoing)',
            when: { arrestOutcome: oneOf(...ARREST_AFTER_LOADING) },
            set: { deceased: false }
          },
          {
            label: 'Pronounced dead at the scene, whether or not the body was then transported',
            when: { incidentDisposition: oneOf(...DEAD_AT_SCENE) },
            set: { deceased: true }
          },
          {
            label: 'Expired in the field and not transported',
            when: {
              arrestOutcome: is(EXPIRED_IN_FIELD),
              transportDisposition: oneOf(...NOT_TRANSPORTED)
            },
            set: { deceased: true }
          }
        ],
        { deceased: false }
      )
    )
  });
  g.add(
    'service',
    'std.expr',
    expr(
      'BLS Without Miles When Pronounced Dead',
      "deceased ? merge(service, { level: 'BLS', loadedMiles: null, nonCoveredMiles: null, deceased: true, basis: concat(service.basis ?? [], rules, ['Billed as BLS with QL and no mileage']) }) : merge(service, { deceased: false })"
    )
  );
  g.ret('return');
  g.wire('entry.trip', 'trip.trip');
  for (const pin of ['incidentDisposition', 'transportDisposition', 'arrestOutcome']) {
    g.wire(`trip.${pin}`, `decide.${pin}`);
  }
  g.wire('entry.service', 'service.service');
  g.wire('decide.deceased', 'service.deceased');
  g.wire('decide.rules', 'service.rules');
  g.wire('service.result', 'return.service');
  return g.def;
};

const baseService = (): GraphDef => {
  const g = rule([P.facts(), P.findings(true)], [SERVICE_OUT]);
  g.add('facts', 'billing.encounter-facts.break');
  g.add('trip', 'billing.trip-facts.break');
  g.add('level', 'billing.level-of-service', { label: 'Level of Service' });
  g.add('emergency', 'billing.emergency-status', { label: 'Emergency Status' });
  g.add('miles', 'billing.loaded-miles', { label: 'Loaded Miles' });
  g.add('nonCovered', 'billing.non-covered-miles', { label: 'Non-Covered Miles' });
  g.add('service', 'billing.service.make');
  g.ret('return');
  g.wire('entry.facts', 'facts.facts', 'level.facts', 'nonCovered.facts');
  g.wire('entry.findings', 'level.findings');
  g.wire('facts.trip', 'trip.trip', 'emergency.trip');
  g.wire('trip.sceneOdometer', 'miles.sceneOdometer');
  g.wire('trip.destinationOdometer', 'miles.destinationOdometer');
  g.wire('level.level', 'service.level');
  g.wire('level.reasons', 'service.basis');
  g.wire('emergency.emergency', 'service.emergency');
  g.wire('miles.loadedMiles', 'service.loadedMiles', 'nonCovered.loadedMiles');
  g.wire('nonCovered.nonCoveredMiles', 'service.nonCoveredMiles');
  g.wire('service.service', 'return.service');
  return g.def;
};

const tripService = (fixed: Record<string, Json>): GraphDef => {
  const g = rule([P.facts(), P.findings(true)], [SERVICE_OUT]);
  g.add('suggested', 'billing.base-service', { label: 'Base Service' });
  g.ret('return');
  g.wire('entry.facts', 'suggested.facts');
  g.wire('entry.findings', 'suggested.findings');
  if (!Object.keys(fixed).length) {
    g.wire('suggested.service', 'return.service');
    return g.def;
  }
  g.add('parts', 'billing.service.break');
  g.add('service', 'billing.service.make', { values: fixed });
  g.wire('suggested.service', 'parts.service');
  for (const pin of ['level', 'emergency', 'loadedMiles', 'basis', 'nonCoveredMiles'].filter(
    (x) => !(x in fixed)
  )) {
    g.wire(`parts.${pin}`, `service.${pin}`);
  }
  g.wire('service.service', 'return.service');
  return g.def;
};

const TRIP_SERVICES = [
  ['emergency', 'billing.trip-emergency'],
  ['scheduled', 'billing.trip-scheduled'],
  ['treatNoTransport', 'billing.trip-treat-no-transport'],
  ['refusal', 'billing.trip-refusal']
] as const;

const determineService = (): GraphDef => {
  const g = rule([P.tripType(), P.facts(), P.findings(true)], [SERVICE_OUT]);
  for (const [id, type] of TRIP_SERVICES) {
    g.add(id, type);
    g.wire('entry.facts', `${id}.facts`);
    g.wire('entry.findings', `${id}.findings`);
  }
  g.add(
    'byTrip',
    'std.expr',
    expr(
      'Service for the Trip Type',
      '{ scheduled: scheduled, treatNoTransport: treatNoTransport, refusal: refusal }[tripType] ?? emergency'
    )
  );
  g.add('facts', 'billing.encounter-facts.break');
  g.add('deceased', 'billing.deceased-handling', { label: 'Deceased Handling (QL)' });
  g.add('agency', 'billing.agency-service', { label: 'Agency Service' });
  g.ret('return');
  g.wire('entry.tripType', 'byTrip.tripType', 'agency.tripType');
  for (const [id] of TRIP_SERVICES) g.wire(`${id}.service`, `byTrip.${id}`);
  g.wire('entry.facts', 'facts.facts', 'agency.facts');
  g.wire('facts.trip', 'deceased.trip');
  g.wire('byTrip.result', 'deceased.service');
  g.wire('deceased.service', 'agency.service');
  g.wire('agency.service', 'return.service');
  return g.def;
};

const DIAGNOSES_OUT = d(
  'diagnoses',
  { list: 'string' },
  'Diagnoses',
  'ICD-10 diagnoses, primary first.'
);

const diagnosesFromImpressions = (): GraphDef => {
  const g = rule(
    [d('clinical', T.clinical, 'Clinical Facts', 'The primary and secondary impressions.')],
    [DIAGNOSES_OUT]
  );
  g.add('clinical', 'billing.clinical-facts.break');
  g.add('primary', 'std.list.make', { label: 'Primary Impression', config: { count: 1 } });
  g.add('diagnoses', 'std.list.concat', { label: 'With Secondary Impressions' });
  g.ret('return');
  g.wire('entry.clinical', 'clinical.clinical');
  g.wire('clinical.primaryImpression', 'primary.item1');
  g.wire('primary.list', 'diagnoses.list');
  g.wire('clinical.secondaryImpressions', 'diagnoses.other');
  g.wire('diagnoses.list', 'return.diagnoses');
  return g.def;
};

const assignDiagnoses = (): GraphDef => {
  const g = rule([P.facts()], [DIAGNOSES_OUT]);
  g.add('facts', 'billing.encounter-facts.break');
  g.add('impressions', 'billing.diagnoses-from-impressions', {
    label: 'Diagnoses From Coded Impressions'
  });
  g.add('agency', 'billing.agency-diagnoses', { label: 'Agency Diagnoses' });
  g.ret('return');
  g.wire('entry.facts', 'facts.facts', 'agency.facts');
  g.wire('facts.clinical', 'impressions.clinical');
  g.wire('impressions.diagnoses', 'agency.diagnoses');
  g.wire('agency.diagnoses', 'return.diagnoses');
  return g.def;
};

const pureSlot = (inputs: ReturnType<typeof d>[], outputs: ReturnType<typeof d>[]) => ({
  execIn: [],
  execOut: [],
  inputs,
  outputs
});

const FACTS_CONTEXT = P.facts(true);

export const serviceGraphs: SeedGraph[] = [
  slot(
    'billing.agency-trip-type',
    'Agency Trip Type',
    'An agency rule after the trip type is decided: bill a kind of trip differently (a contract that bills standbys, say). Passes the trip type through unchanged until an agency overrides it.',
    pureSlot(
      [
        d('tripType', 'string', 'Trip Type', 'The trip type the base rules chose.'),
        d('reason', 'string', 'Classified By', 'The rule that chose it.', true),
        FACTS_CONTEXT
      ],
      [
        d('tripType', 'string', 'Trip Type', 'The trip type to bill.'),
        d('reason', 'string', 'Classified By', 'Why, for the biller.', true)
      ]
    )
  ),
  slot(
    'billing.agency-service',
    'Agency Service',
    'An agency rule after the service is suggested for the trip type: change the level, emergency status or miles a biller is asked to confirm. Passes the service through unchanged until an agency overrides it.',
    pureSlot(
      [
        d('service', T.service, 'Service', 'The service the base rules suggested.'),
        d('tripType', 'string', 'Trip Type', 'The trip type being billed.', true),
        FACTS_CONTEXT
      ],
      [d('service', T.service, 'Service', 'The service to suggest to the biller.')]
    )
  ),
  slot(
    'billing.agency-diagnoses',
    'Agency Diagnoses',
    'An agency rule after the diagnoses are assigned: add, drop or reorder ICD-10 codes. Passes the diagnoses through unchanged until an agency overrides it.',
    pureSlot(
      [
        d('diagnoses', { list: 'string' }, 'Diagnoses', 'The diagnoses the base rules assigned.'),
        FACTS_CONTEXT
      ],
      [d('diagnoses', { list: 'string' }, 'Diagnoses', 'The diagnoses to bill, primary first.')]
    )
  ),
  asRule(
    'billing.trip-type',
    'Trip Type',
    'Decides the trip type (emergency, scheduled, treatNoTransport, refusal or noClaim) from the dispositions and type of service with the Trip Type table, with the rule that matched.',
    tripType()
  ),
  asRule(
    'billing.classify-trip',
    'Classify Trip',
    'Classifies the trip from the encounter facts: the Trip Type rule, then the Agency Trip Type rule.',
    classifyTrip()
  ),
  asRule(
    'billing.loaded-miles',
    'Loaded Miles',
    'Destination minus scene odometer, or nothing when either is missing. Fractions are billed rounded up to the next tenth of a mile when the claim is priced.',
    loadedMiles()
  ),
  asRule(
    'billing.level-of-service',
    'Level of Service',
    'Decides BLS, ALS1, ALS2 or SCT from the level of care, CMS service level, coded IV/IO medications other than IV solutions, coded ALS2 procedures and the narrative findings, with every reason that applied.',
    levelOfService()
  ),
  asRule(
    'billing.emergency-status',
    'Emergency Status',
    'Decides whether the trip is billed as an emergency from the response mode and CMS service level (Emergency Response table).',
    emergencyStatus()
  ),
  asRule(
    'billing.non-covered-miles',
    'Non-Covered Miles',
    'The miles past the closest hospital (ePayment.48) billed as non-covered on A0888, when the Non-Covered Miles table says the patient chose a farther facility.',
    nonCoveredMiles()
  ),
  asRule(
    'billing.deceased-handling',
    'Deceased Handling (QL)',
    'Bills a patient pronounced dead after the call and before loading (Pronounced Dead table) as BLS with no loaded or non-covered miles, so the base rate carries QL.',
    deceasedHandling()
  ),
  asRule(
    'billing.base-service',
    'Base Service',
    'The service every trip type starts from: Level of Service, Emergency Status, Loaded Miles and Non-Covered Miles.',
    baseService()
  ),
  asRule(
    'billing.trip-emergency',
    'Emergency Trip',
    'The service an emergency transport is billed for.',
    tripService({})
  ),
  asRule(
    'billing.trip-scheduled',
    'Scheduled Trip',
    'The service a scheduled or interfacility transport is billed for: an emergency only when the unit responded immediately.',
    tripService({})
  ),
  asRule(
    'billing.trip-treat-no-transport',
    'Treat, No Transport',
    'The service a trip where the crew treated but did not transport is billed for: no loaded or non-covered miles.',
    tripService({ loadedMiles: null, nonCoveredMiles: null })
  ),
  asRule(
    'billing.trip-refusal',
    'Refusal',
    'The service a trip where the patient refused care or transport is billed for: no loaded or non-covered miles.',
    tripService({ loadedMiles: null, nonCoveredMiles: null })
  ),
  asRule(
    'billing.determine-service',
    'Determine Service',
    'Suggests the service for the trip type (Emergency Trip, Scheduled Trip, Treat, No Transport or Refusal), bills a patient pronounced dead before loading as BLS without miles (Deceased Handling), then the Agency Service rule.',
    determineService()
  ),
  asRule(
    'billing.diagnoses-from-impressions',
    'Diagnoses From Coded Impressions',
    'The primary impression, then the secondary impressions, as ICD-10 diagnoses.',
    diagnosesFromImpressions()
  ),
  asRule(
    'billing.assign-diagnoses',
    'Assign Diagnoses',
    'Assigns the claim diagnoses: Diagnoses From Coded Impressions, then the Agency Diagnoses rule.',
    assignDiagnoses()
  ),
  asStage(
    'billing.decide-claim',
    'Decide Whether to Claim',
    'Classifies the trip and, when it looks like no claim is needed, asks a biller to skip the report or name the trip type to claim it as.',
    decideClaim()
  )
];
