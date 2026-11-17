import type { GraphDef, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  type Builder,
  breakRecord,
  codeTable,
  condition,
  d,
  ENCOUNTER,
  either,
  firstSet,
  firstThatHolds,
  fixed,
  joinLists,
  keepWhere,
  listOf,
  makeList,
  ODOMETER,
  PAYMENT,
  type Port,
  type Reason,
  reasonsOf,
  rule,
  select,
  T,
  type Test,
  TIMES
} from './shared.ts';

type Held = { id: string; label: string; reason: string; tests: Test[] };

const ENCOUNTER_IN = d('encounter', T.encounter, 'Encounter', 'The encounter to decide from.');

const REASONS_OUT = (what: string) =>
  d('reasons', listOf('string'), 'Reasons', `Every rule that held, so a biller sees why ${what}.`);

const heldRules = (g: Builder, inputs: Record<string, [ValueType, Port]>, rules: Held[]) =>
  Object.fromEntries(
    rules.map((r) => [
      r.id,
      condition(
        g,
        r.id,
        r.label,
        Object.fromEntries(
          [...new Set(r.tests.map((t) => t.field))].map((f) => {
            const input = inputs[f];
            if (!input) throw new Error(`${r.id} tests an unknown field ${f}`);
            return [f, input];
          })
        ),
        r.tests
      )
    ])
  ) as Record<string, Port>;

const anyHeld = (
  g: Builder,
  id: string,
  label: string,
  rules: Held[],
  held: Record<string, Port>
) =>
  either(
    g,
    id,
    label,
    rules.map((r) => held[r.id] as Port)
  );

const reasonsHeld = (g: Builder, rules: Held[], held: Record<string, Port>) =>
  reasonsOf(
    g,
    'reasons',
    'Rules That Held',
    rules.map(
      (r): Reason => ({
        id: `${r.id}Reason`,
        label: `Reason When ${r.label}`,
        when: held[r.id] as Port,
        reason: r.reason
      })
    )
  );

const tripFields = (...names: string[]) =>
  Object.fromEntries(names.map((n) => [n, ['string', `trip.${n}`]])) as Record<
    string,
    [ValueType, Port]
  >;

const INTERFACILITY = ['2205005', '2205015', '2205017', '2205019'];

const EMERGENCY_SERVICE = ['2205001', '2205003', '2205009'];

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

const NOT_BILLABLE: Held[] = [
  {
    id: 'cancelled',
    label: 'Cancelled, or No Patient Contact',
    reason: 'Cancelled, or no patient contact',
    tests: [{ field: 'incidentDisposition', op: 'oneOf', value: ['4212007', '4212009', '4212011'] }]
  },
  {
    id: 'assist',
    label: 'Assist, Standby or Non-Patient Transport',
    reason: 'Assist, standby or non-patient transport',
    tests: [
      {
        field: 'incidentDisposition',
        op: 'oneOf',
        value: ['4212001', '4212003', '4212005', '4212039', '4212041', '4212043']
      }
    ]
  },
  {
    id: 'unitCancelled',
    label: 'Unit Cancelled, Made No Patient Contact, or Had No Patient',
    reason: 'Unit cancelled, made no patient contact, or had no patient',
    tests: [
      {
        field: 'unitDisposition',
        op: 'oneOf',
        value: ['4227003', '4227005', '4227007', '4227009', '4227011']
      }
    ]
  },
  {
    id: 'nonPatientTransport',
    label: 'Non-Patient Transport',
    reason: 'Non-patient transport',
    tests: [{ field: 'transportDisposition', op: 'is', value: '4230011' }]
  },
  {
    id: 'nonPatientService',
    label: 'Non-Patient Service and Nobody Transported',
    reason: 'Non-patient service requested and nobody transported',
    tests: [
      { field: 'serviceType', op: 'oneOf', value: NON_PATIENT_SERVICES },
      { field: 'incidentDisposition', op: 'notOneOf', value: TRANSPORTED_INCIDENTS },
      { field: 'transportDisposition', op: 'notOneOf', value: TRANSPORTED }
    ]
  }
];

const REFUSAL: Held[] = [
  {
    id: 'refusedCare',
    label: 'Patient Refused Care',
    reason: 'Patient refused care',
    tests: [{ field: 'incidentDisposition', op: 'is', value: '4212025' }]
  },
  {
    id: 'refusedTransport',
    label: 'Patient Refused Care and Transport',
    reason: 'Patient refused care and transport',
    tests: [
      { field: 'patientEvaluation', op: 'oneOf', value: ['4228003', '4228007'] },
      { field: 'transportDisposition', op: 'oneOf', value: ['4230009', '4230013'] }
    ]
  }
];

const NO_TRANSPORT: Held[] = [
  {
    id: 'treated',
    label: 'Patient Treated and Not Transported',
    reason: 'Patient treated and not transported',
    tests: [
      {
        field: 'incidentDisposition',
        op: 'oneOf',
        value: [
          '4212015',
          '4212019',
          '4212021',
          '4212027',
          '4212029',
          '4212031',
          '4212035',
          '4212037'
        ]
      }
    ]
  },
  {
    id: 'notTransportedByUnit',
    label: 'Patient Not Transported by This Unit',
    reason: 'Patient not transported by this unit',
    tests: [
      {
        field: 'transportDisposition',
        op: 'oneOf',
        value: ['4230005', '4230007', '4230009', '4230013']
      }
    ]
  }
];

const TRANSPORT: Held[] = [
  {
    id: 'treatedAndTransported',
    label: 'Patient Treated and Transported by This Unit',
    reason: 'Patient treated and transported by this unit',
    tests: [{ field: 'incidentDisposition', op: 'oneOf', value: TRANSPORTED_INCIDENTS }]
  },
  {
    id: 'transported',
    label: 'Patient Transported by This Unit',
    reason: 'Patient transported by this unit',
    tests: [{ field: 'transportDisposition', op: 'oneOf', value: TRANSPORTED }]
  }
];

const SCHEDULED: Held = {
  id: 'scheduledService',
  label: 'Scheduled or Interfacility Transport',
  reason: 'Scheduled or interfacility transport',
  tests: [{ field: 'serviceType', op: 'oneOf', value: [...INTERFACILITY, '2205007'] }]
};

const BILLABLE = ['emergency', 'scheduled', 'treatNoTransport'];

const tripClassification = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'classification',
        'string',
        'Classification',
        'What kind of trip it was: emergency, scheduled, treatNoTransport, refusal or notBillable.'
      ),
      d('billable', 'boolean', 'Billable', 'Whether the trip is billed.'),
      REASONS_OUT('the trip was classified this way')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  const rules = [...NOT_BILLABLE, ...REFUSAL, ...NO_TRANSPORT, ...TRANSPORT, SCHEDULED];
  const held = heldRules(
    g,
    tripFields(
      'incidentDisposition',
      'unitDisposition',
      'transportDisposition',
      'patientEvaluation',
      'serviceType'
    ),
    rules
  );
  const transported = anyHeld(g, 'anyTransport', 'Transported by This Unit', TRANSPORT, held);
  g.add('scheduledTransport', 'std.logic.and', { label: 'Transported on a Schedule' });
  g.wire(transported, 'scheduledTransport.a');
  g.wire(held[SCHEDULED.id] as Port, 'scheduledTransport.b');
  const classification = firstThatHolds(
    g,
    'classification',
    'First Kind of Trip That Holds',
    'string',
    [
      {
        id: 'asNotBillable',
        label: 'Not Billable When a Not-Billable Rule Holds',
        when: anyHeld(g, 'notBillable', 'A Not-Billable Rule Holds', NOT_BILLABLE, held),
        value: fixed('notBillable')
      },
      {
        id: 'asRefusal',
        label: 'Refusal When a Refusal Rule Holds',
        when: anyHeld(g, 'refusal', 'A Refusal Rule Holds', REFUSAL, held),
        value: fixed('refusal')
      },
      {
        id: 'asNoTransport',
        label: 'Treated, No Transport When a No-Transport Rule Holds',
        when: anyHeld(g, 'noTransport', 'A No-Transport Rule Holds', NO_TRANSPORT, held),
        value: fixed('treatNoTransport')
      },
      {
        id: 'asScheduled',
        label: 'Scheduled When Transported on a Schedule',
        when: 'scheduledTransport.result',
        value: fixed('scheduled')
      },
      {
        id: 'asEmergency',
        label: 'Emergency When Transported',
        when: transported,
        value: fixed('emergency')
      }
    ],
    fixed('notBillable')
  );
  const billable = condition(
    g,
    'billable',
    'Billable Kind of Trip',
    { classification: ['string', classification] },
    [{ field: 'classification', op: 'oneOf', value: BILLABLE }]
  );
  g.add('noneHeld', 'std.logic.not', { label: 'No Rule Holds' });
  g.wire(anyHeld(g, 'anyRule', 'Any Rule Holds', rules, held), 'noneHeld.value');
  const ruleReasons = reasonsHeld(g, rules, held);
  const missing = makeList(g, 'missingAll', 'No Disposition Reported or Nothing', 'string', [
    select(
      g,
      'missingReason',
      'Reason When No Rule Holds',
      'noneHeld.result',
      fixed('No disposition says what happened on the trip')
    )
  ]);
  g.add('missing', 'std.list.compact', { label: 'No Disposition Reported' });
  g.wire(missing, 'missing.list');
  g.ret('return');
  g.wire(classification, 'return.classification');
  g.wire(billable, 'return.billable');
  g.wire(
    joinLists(g, 'allReasons', 'Every Reason', 'string', [ruleReasons, 'missing.list']),
    'return.reasons'
  );
  return g.def;
};

const IV_ROUTES = ['9927021', '9927023', '9927069'];

const IV_SOLUTIONS = codeTable(
  'billing.iv-solutions',
  'IV Solutions',
  'The coded medications (RxNorm) that are IV solutions, such as saline or dextrose, so giving them IV or IO does not count as an IV/IO medication for the level of service.',
  Object.fromEntries(
    [
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
    ].map((code) => [code, 'IV solution'])
  )
);

const ALS2_PROCEDURES = codeTable(
  'billing.als2-procedures',
  'ALS2 Procedures',
  'The coded procedures (SNOMED CT) that make a trip ALS2, the ones CMS names for it: manual defibrillation or cardioversion, endotracheal intubation, a central venous line, cardiac pacing, chest decompression, a surgical airway or an intraosseous line.',
  Object.fromEntries(
    [
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
    ].map((code) => [code, 'ALS2 procedure'])
  )
);

const tableKey = (table: unknown) => (table as { table: { key: string } }).table;

const SCT: Held[] = [
  {
    id: 'criticalCare',
    label: 'Critical Care on an Interfacility Transport',
    reason: 'Critical care documented on an interfacility transport',
    tests: [
      { field: 'levelOfCare', op: 'is', value: '4232009' },
      { field: 'serviceType', op: 'oneOf', value: INTERFACILITY }
    ]
  },
  {
    id: 'crewSct',
    label: 'Crew Reported Specialty Care on an Interfacility Transport',
    reason: 'Crew reported specialty care on an interfacility transport',
    tests: [
      { field: 'serviceLevel', op: 'is', value: '2650015' },
      { field: 'serviceType', op: 'oneOf', value: INTERFACILITY }
    ]
  }
];

const ALS2: Held[] = [
  {
    id: 'procedureCoded',
    label: 'ALS2 Procedure Coded',
    reason: 'ALS2 procedure coded',
    tests: [{ field: 'als2Procedures', op: 'gte', value: 1 }]
  },
  {
    id: 'threeMedications',
    label: 'Three or More IV/IO Medications Coded',
    reason: 'Three or more IV/IO medications coded',
    tests: [{ field: 'ivMedications', op: 'gte', value: 3 }]
  },
  {
    id: 'crewAls2',
    label: 'Crew Reported ALS2',
    reason: 'Crew reported ALS2',
    tests: [{ field: 'serviceLevel', op: 'is', value: '2650005' }]
  }
];

const ALS1: Held[] = [
  {
    id: 'alsAssessed',
    label: 'ALS Assessment Performed and Warranted',
    reason: 'ALS assessment performed and warranted',
    tests: [{ field: 'alsAssessment', op: 'is', value: '9923003' }]
  },
  {
    id: 'crewAls1',
    label: 'Crew Reported ALS1',
    reason: 'Crew reported ALS1',
    tests: [{ field: 'serviceLevel', op: 'oneOf', value: ['2650001', '2650003'] }]
  },
  {
    id: 'medicationCoded',
    label: 'IV/IO Medication Coded',
    reason: 'IV/IO medication coded',
    tests: [{ field: 'ivMedications', op: 'gte', value: 1 }]
  }
];

const levelOfService = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d('level', 'string', 'Level of Service', 'The level of service: BLS, ALS1, ALS2 or SCT.'),
      REASONS_OUT('the level was chosen')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  keepWhere(g, 'ivRoute', 'Medications Given IV or IO', 'trip.medications', {
    field: 'route',
    op: 'oneOf',
    value: IV_ROUTES
  });
  keepWhere(g, 'ivDrugs', 'IV/IO Medications Other Than Solutions', 'ivRoute.list', {
    field: 'code',
    op: 'notListed',
    table: tableKey(IV_SOLUTIONS)
  });
  keepWhere(g, 'als2Procedures', 'ALS2 Procedures Performed', 'trip.procedures', {
    field: 'code',
    op: 'listed',
    table: tableKey(ALS2_PROCEDURES)
  });
  const rules = [...SCT, ...ALS2, ...ALS1];
  const held = heldRules(
    g,
    {
      levelOfCare: ['string', 'trip.levelOfCare'],
      serviceType: ['string', 'trip.serviceType'],
      serviceLevel: ['string', 'payment.serviceLevel'],
      alsAssessment: ['string', 'payment.alsAssessment'],
      ivMedications: ['integer', 'ivDrugs.count'],
      als2Procedures: ['integer', 'als2Procedures.count']
    },
    rules
  );
  const level = firstThatHolds(
    g,
    'level',
    'Highest Level That Holds, Else BLS',
    'string',
    [
      {
        id: 'asSct',
        label: 'SCT When an SCT Rule Holds',
        when: anyHeld(g, 'sct', 'An SCT Rule Holds', SCT, held),
        value: fixed('SCT')
      },
      {
        id: 'asAls2',
        label: 'ALS2 When an ALS2 Rule Holds',
        when: anyHeld(g, 'als2', 'An ALS2 Rule Holds', ALS2, held),
        value: fixed('ALS2')
      },
      {
        id: 'asAls1',
        label: 'ALS1 When an ALS1 Rule Holds',
        when: anyHeld(g, 'als1', 'An ALS1 Rule Holds', ALS1, held),
        value: fixed('ALS1')
      }
    ],
    fixed('BLS')
  );
  g.ret('return');
  g.wire(level, 'return.level');
  g.wire(reasonsHeld(g, rules, held), 'return.reasons');
  return g.def;
};

const EMERGENT: Held[] = [
  {
    id: 'immediate',
    label: 'Immediate Response to the Call',
    reason: 'Immediate response to the call',
    tests: [{ field: 'responseMode', op: 'oneOf', value: ['2223001', '2223003', '2223007'] }]
  },
  {
    id: 'crewEmergency',
    label: 'No Response Mode, and the Crew Reported an Emergency Level',
    reason: 'No response mode, and the crew reported an emergency level',
    tests: [
      { field: 'responseMode', op: 'empty' },
      { field: 'serviceLevel', op: 'oneOf', value: ['2650003', '2650009'] }
    ]
  },
  {
    id: 'emergencyCall',
    label: 'No Response Mode, and an Emergency Call',
    reason: 'No response mode, and an emergency call',
    tests: [
      { field: 'responseMode', op: 'empty' },
      { field: 'serviceType', op: 'oneOf', value: EMERGENCY_SERVICE }
    ]
  }
];

const emergencyStatus = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
      REASONS_OUT('the trip is or is not an emergency')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  const held = heldRules(
    g,
    {
      responseMode: ['string', 'trip.responseMode'],
      serviceType: ['string', 'trip.serviceType'],
      serviceLevel: ['string', 'payment.serviceLevel']
    },
    EMERGENT
  );
  g.ret('return');
  g.wire(anyHeld(g, 'emergency', 'An Emergency Rule Holds', EMERGENT, held), 'return.emergency');
  g.wire(reasonsHeld(g, EMERGENT, held), 'return.reasons');
  return g.def;
};

const loadedMiles = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'loadedMiles',
        'number',
        'Loaded Miles',
        'Miles with the patient on board, from the scene and destination odometer readings, rounded up to the tenth; nothing when a reading is missing.',
        true
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'odometer', 'Odometer', ODOMETER, 'trip.odometer');
  g.add('distance', 'std.math.subtract', { label: 'Destination Minus Scene' });
  g.add('positive', 'std.math.max', { label: 'Never Below Zero', values: { b: 0 } });
  g.add('rounded', 'std.math.round', {
    label: 'Up to the Tenth',
    config: { direction: 'up' },
    values: { digits: 1 }
  });
  g.wire('odometer.destination', 'distance.a');
  g.wire('odometer.scene', 'distance.b');
  g.wire('distance.result', 'positive.a');
  g.wire('positive.result', 'rounded.value');
  g.ret('return');
  g.wire('rounded.result', 'return.loadedMiles');
  return g.def;
};

const serviceDate = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'serviceDate',
        'string',
        'Service Date',
        'The date of service: the day the crew reached the patient, else reached the scene, was notified or got the call.',
        true
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'times', 'Times', TIMES, 'trip.times');
  const first = firstSet(g, 'first', 'First Time Recorded', 'datetime', [
    'times.atPatient',
    'times.atScene',
    'times.unitNotified',
    'times.call'
  ]);
  g.add('day', 'std.time.parts', { label: 'Day of Service' });
  g.wire(first, 'day.time');
  g.ret('return');
  g.wire('day.date', 'return.serviceDate');
  return g.def;
};

const determineService = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'serviceDate',
        'string',
        'Service Date',
        'The date of service, when a time was recorded.',
        true
      ),
      d('level', 'string', 'Level of Service', 'The level of service: BLS, ALS1, ALS2 or SCT.'),
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
      d(
        'loadedMiles',
        'number',
        'Loaded Miles',
        'Miles with the patient on board, when the odometer was read.',
        true
      ),
      REASONS_OUT('the service was decided this way')
    ]
  );
  g.add('date', 'billing.service-date', { label: 'Service Date' });
  g.add('level', 'billing.level-of-service', { label: 'Level of Service' });
  g.add('emergency', 'billing.emergency-status', { label: 'Emergency Status' });
  g.add('miles', 'billing.loaded-miles', { label: 'Loaded Miles' });
  g.wire(
    'entry.encounter',
    'date.encounter',
    'level.encounter',
    'emergency.encounter',
    'miles.encounter'
  );
  g.ret('return');
  g.wire('date.serviceDate', 'return.serviceDate');
  g.wire('level.level', 'return.level');
  g.wire('emergency.emergency', 'return.emergency');
  g.wire('miles.loadedMiles', 'return.loadedMiles');
  g.wire(
    joinLists(g, 'reasons', 'Reasons for Level and Emergency', 'string', [
      'level.reasons',
      'emergency.reasons'
    ]),
    'return.reasons'
  );
  return g.def;
};

const assignDiagnoses = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'diagnoses',
        listOf({ code: 'icd10' }),
        'Diagnoses',
        'The primary impression, then the secondary ones, each once and at most twelve.'
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  const primary = makeList(g, 'primary', 'Primary Impression', { code: 'icd10' }, [
    'trip.primaryImpression'
  ]);
  const all = joinLists(g, 'all', 'Primary, Then Secondary', { code: 'icd10' }, [
    primary,
    'trip.secondaryImpressions'
  ]);
  g.add('present', 'std.list.compact', { label: 'Impressions Given' });
  g.add('once', 'std.list.unique', { label: 'Each Once' });
  g.add('twelve', 'std.list.slice', { label: 'At Most Twelve', values: { start: 0, end: 12 } });
  g.wire(all, 'present.list');
  g.wire('present.list', 'once.list');
  g.wire('once.list', 'twelve.list');
  g.ret('return');
  g.wire('twelve.list', 'return.diagnoses');
  return g.def;
};

export const serviceGraphs: SeedGraph[] = [
  asRule(
    'billing.trip-classification',
    'Trip Classification',
    'What kind of trip an encounter was, from its dispositions and type of service: not billable, refusal, treated without transport, scheduled or emergency, the first that holds, and whether it is billed.',
    tripClassification()
  ),
  asRule(
    'billing.level-of-service',
    'Level of Service',
    'The level of service: SCT for critical care between facilities, ALS2 for an ALS2 procedure or three IV/IO medications, ALS1 for an ALS assessment or an IV/IO medication, else BLS; or the level the crew reported.',
    levelOfService()
  ),
  asRule(
    'billing.emergency-status',
    'Emergency Status',
    'Whether a trip is an emergency: an immediate response, or, with no response mode, an emergency call or an emergency level the crew reported.',
    emergencyStatus()
  ),
  asRule(
    'billing.loaded-miles',
    'Loaded Miles',
    'Miles with the patient on board: the destination odometer less the scene odometer, never below zero, rounded up to the tenth.',
    loadedMiles()
  ),
  asRule(
    'billing.service-date',
    'Service Date',
    'The date of service: the day the crew reached the patient, else the scene, else was notified, else got the call.',
    serviceDate()
  ),
  asRule(
    'billing.determine-service',
    'Determine Service',
    'The date of service, level of service, emergency status and loaded miles of an encounter, with the reasons.',
    determineService()
  ),
  asRule(
    'billing.assign-diagnoses',
    'Assign Diagnoses',
    'The diagnoses of a claim: the primary impression, then the secondary impressions, each once and at most twelve.',
    assignDiagnoses()
  )
];
