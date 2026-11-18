import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
  anyOf,
  asRule,
  atLeast,
  type Builder,
  breakRecord,
  CODE,
  CRITERIA_OUT,
  type Criterion,
  code,
  codes,
  criteriaResult,
  d,
  ENCOUNTER,
  firstSet,
  fixed,
  INTERFACILITY,
  isCode,
  isIn,
  isMissing,
  joinLists,
  keepWhere,
  listOf,
  MEDICATION,
  makeList,
  node,
  not,
  ODOMETER,
  orZero,
  PAYMENT,
  PERSON,
  PROCEDURE,
  reasonsOf,
  reasonsOut,
  rule,
  SERVICE_TYPES,
  select,
  T,
  TIMES
} from './shared.ts';

const ENCOUNTER_IN = d('encounter', T.encounter, 'Encounter', 'The encounter to decide from.');

const KIND = {
  incident: 'incidentDisposition',
  unit: 'unitDisposition',
  transport: 'transportDisposition',
  evaluation: 'patientEvaluation',
  arrestOutcome: 'arrestOutcome',
  service: 'serviceType',
  levelOfCare: 'levelOfCare',
  cmsServiceLevel: 'cmsServiceLevel',
  yesNo: 'yesNo',
  responseUrgency: 'responseUrgency',
  responseMode: 'responseMode',
  route: 'medicationRoute',
  rxnorm: 'rxnorm',
  snomed: 'snomed'
} as const;

const codeIn = (name: string, kind: string, label: string, description: string) =>
  d(name, code(kind), label, description, true);

const SERVICE_IN = codeIn(
  'serviceType',
  KIND.service,
  'Service Type',
  'The type of service requested, NEMSIS eResponse.05.'
);

const SERVICE_LEVEL_IN = codeIn(
  'serviceLevel',
  KIND.cmsServiceLevel,
  'CMS Service Level',
  'The level of service the crew reported, NEMSIS ePayment.50.'
);

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

const resultOut = (description: string) => [d('result', 'boolean', 'Result', description)];

const YES = '9923003';

const byThisUnit = (): GraphDef => {
  const g = rule(
    [
      codeIn(
        'priorToCare',
        KIND.yesNo,
        'Before This Unit Arrived',
        'Whether the care was given before this unit arrived.'
      ),
      codeIn('byAnotherUnit', KIND.yesNo, 'By Another Unit', 'Whether another unit gave the care.')
    ],
    resultOut('Whether this unit gave the care, so it counts toward the level of service.')
  );
  g.ret('return');
  g.wire(
    not(
      g,
      'byThisUnit',
      'Given by This Unit',
      anyOf(g, 'elsewhere', 'Given Elsewhere', [
        isCode(g, 'before', 'Before This Unit Arrived', KIND.yesNo, 'entry.priorToCare', YES),
        isCode(g, 'other', 'By Another Unit', KIND.yesNo, 'entry.byAnotherUnit', YES)
      ])
    ),
    'return.result'
  );
  return g.def;
};

const wireFields = (g: Builder, from: string, to: string, names: readonly string[]) => {
  for (const name of names) g.wire(`${from}.${name}`, `${to}.${name}`);
};

const careByThisUnit = (g: Builder, record: string) => {
  g.add('thisUnit', 'billing.by-this-unit', { label: 'Given by This Unit' });
  wireFields(g, record, 'thisUnit', ['priorToCare', 'byAnotherUnit']);
  return 'thisUnit.result' as const;
};

const ivMedication = (): GraphDef => {
  const g = rule(
    [d('medication', T.medication, 'Medication', 'One medication the crew gave.')],
    resultOut('Whether this unit gave it IV or IO and it is not an IV solution.')
  );
  breakRecord(g, 'medication', 'Medication', MEDICATION, 'entry.medication');
  g.ret('return');
  g.wire(
    allOf(g, 'ivMedication', 'Given IV or IO by This Unit, Not a Solution', [
      careByThisUnit(g, 'medication'),
      isIn(
        g,
        'ivRoute',
        'Given IV or IO',
        KIND.route,
        'medication.route',
        codes(g, 'ivRoutes', 'IV and IO Routes', KIND.route, IV_ROUTES)
      ),
      not(
        g,
        'notSolution',
        'Not an IV Solution',
        isIn(
          g,
          'solution',
          'Is an IV Solution',
          KIND.rxnorm,
          'medication.code',
          codes(g, 'solutions', 'IV Solutions', KIND.rxnorm, IV_SOLUTIONS)
        )
      )
    ]),
    'return.result'
  );
  return g.def;
};

const als2Procedure = (): GraphDef => {
  const g = rule(
    [d('procedure', T.procedure, 'Procedure', 'One procedure the crew performed.')],
    resultOut('Whether this unit performed it and it is one CMS names for ALS2.')
  );
  breakRecord(g, 'procedure', 'Procedure', PROCEDURE, 'entry.procedure');
  g.ret('return');
  g.wire(
    allOf(g, 'als2ByThisUnit', 'ALS2 Procedure by This Unit', [
      careByThisUnit(g, 'procedure'),
      isIn(
        g,
        'als2',
        'ALS2 Procedure',
        KIND.snomed,
        'procedure.code',
        codes(g, 'als2Codes', 'ALS2 Procedures', KIND.snomed, ALS2_PROCEDURES)
      )
    ]),
    'return.result'
  );
  return g.def;
};

const IV_MEDICATIONS_IN = d(
  'ivMedications',
  'integer',
  'IV/IO Medications',
  'How many medications were given IV or IO, not counting IV solutions.'
);

const ALS2_PROCEDURES_IN = d(
  'als2Procedures',
  'integer',
  'ALS2 Procedures',
  'How many ALS2 procedures were performed.'
);

const sctCriteria = (): GraphDef => {
  const g = rule(
    [
      codeIn(
        'levelOfCare',
        KIND.levelOfCare,
        'Level of Care',
        'The level of care provided, NEMSIS eDisposition.32.'
      ),
      SERVICE_IN,
      SERVICE_LEVEL_IN
    ],
    CRITERIA_OUT
  );
  const interfacility = isIn(
    g,
    'interfacility',
    'Interfacility Transport',
    KIND.service,
    'entry.serviceType',
    codes(g, 'interfacilityCodes', 'Interfacility Services', KIND.service, INTERFACILITY)
  );
  return criteriaResult(g, 'SCT', [
    {
      id: 'criticalCare',
      label: 'Critical Care on an Interfacility Transport',
      reason: 'Critical care documented on an interfacility transport',
      holds: allOf(g, 'criticalCare', 'Critical Care on an Interfacility Transport', [
        isCode(
          g,
          'critical',
          'Critical Care Provided',
          KIND.levelOfCare,
          'entry.levelOfCare',
          '4232009'
        ),
        interfacility
      ])
    },
    {
      id: 'crewSct',
      label: 'Crew Reported Specialty Care on an Interfacility Transport',
      reason: 'Crew reported specialty care on an interfacility transport',
      holds: allOf(g, 'crewSct', 'Crew Reported SCT Between Facilities', [
        isCode(
          g,
          'reportedSct',
          'Crew Reported SCT',
          KIND.cmsServiceLevel,
          'entry.serviceLevel',
          '2650015'
        ),
        interfacility
      ])
    }
  ]);
};

const als2Criteria = (): GraphDef => {
  const g = rule([ALS2_PROCEDURES_IN, IV_MEDICATIONS_IN, SERVICE_LEVEL_IN], CRITERIA_OUT);
  return criteriaResult(g, 'ALS2', [
    {
      id: 'procedureCoded',
      label: 'ALS2 Procedure Coded',
      reason: 'ALS2 procedure coded',
      holds: atLeast(
        g,
        'procedureCoded',
        'ALS2 Procedure Coded',
        'integer',
        'entry.als2Procedures',
        1
      )
    },
    {
      id: 'threeMedications',
      label: 'Three or More IV/IO Medications Coded',
      reason: 'Three or more IV/IO medications coded',
      holds: atLeast(
        g,
        'threeMedications',
        'Three or More IV/IO Medications',
        'integer',
        'entry.ivMedications',
        3
      )
    },
    {
      id: 'crewAls2',
      label: 'Crew Reported ALS2',
      reason: 'Crew reported ALS2',
      holds: isCode(
        g,
        'crewAls2',
        'Crew Reported ALS2',
        KIND.cmsServiceLevel,
        'entry.serviceLevel',
        '2650005'
      )
    }
  ]);
};

const als1Criteria = (): GraphDef => {
  const g = rule(
    [
      codeIn(
        'alsAssessment',
        KIND.yesNo,
        'ALS Assessment',
        'Whether an ALS assessment was performed and warranted, NEMSIS ePayment.49.'
      ),
      SERVICE_LEVEL_IN,
      IV_MEDICATIONS_IN
    ],
    CRITERIA_OUT
  );
  return criteriaResult(g, 'ALS1', [
    {
      id: 'alsAssessed',
      label: 'ALS Assessment Performed and Warranted',
      reason: 'ALS assessment performed and warranted',
      holds: isCode(
        g,
        'alsAssessed',
        'ALS Assessment Performed',
        KIND.yesNo,
        'entry.alsAssessment',
        '9923003'
      )
    },
    {
      id: 'crewAls1',
      label: 'Crew Reported ALS1',
      reason: 'Crew reported ALS1',
      holds: isIn(
        g,
        'crewAls1',
        'Crew Reported ALS1',
        KIND.cmsServiceLevel,
        'entry.serviceLevel',
        codes(g, 'als1Codes', 'ALS1 Service Levels', KIND.cmsServiceLevel, ['2650001', '2650003'])
      )
    },
    {
      id: 'medicationCoded',
      label: 'IV/IO Medication Coded',
      reason: 'IV/IO medication coded',
      holds: atLeast(
        g,
        'medicationCoded',
        'IV/IO Medication Coded',
        'integer',
        'entry.ivMedications',
        1
      )
    }
  ]);
};

const LEVEL_CRITERIA = [
  { id: 'sct', key: 'billing.sct-criteria', label: 'SCT Criteria', level: 'SCT' },
  { id: 'als2', key: 'billing.als2-criteria', label: 'ALS2 Criteria', level: 'ALS2' },
  { id: 'als1', key: 'billing.als1-criteria', label: 'ALS1 Criteria', level: 'ALS1' }
];

const levelOfService = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d('level', CODE.level, 'Level of Service', 'The level of service: BLS, ALS1, ALS2 or SCT.'),
      reasonsOut('the level was chosen')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  keepWhere(
    g,
    'ivDrugs',
    'IV/IO Medications',
    'billing.iv-medication',
    'medication',
    'trip.medications'
  );
  keepWhere(
    g,
    'als2Done',
    'ALS2 Procedures Performed',
    'billing.als2-procedure',
    'procedure',
    'trip.procedures'
  );
  for (const c of LEVEL_CRITERIA) g.add(c.id, c.key, { label: c.label });
  g.wire('trip.levelOfCare', 'sct.levelOfCare');
  g.wire('trip.serviceType', 'sct.serviceType');
  g.wire('payment.serviceLevel', 'sct.serviceLevel', 'als2.serviceLevel', 'als1.serviceLevel');
  g.wire('als2Done.count', 'als2.als2Procedures');
  g.wire('ivDrugs.count', 'als2.ivMedications', 'als1.ivMedications');
  g.wire('payment.alsAssessment', 'als1.alsAssessment');
  const level = firstSet(g, 'level', 'Highest Level That Holds, Else BLS', CODE.level, [
    ...LEVEL_CRITERIA.map((c) =>
      select(
        g,
        `as${c.level}`,
        `${c.level} When Its Criteria Hold`,
        CODE.level,
        `${c.id}.holds`,
        fixed(c.level)
      )
    ),
    fixed('BLS')
  ]);
  g.ret('return');
  g.wire(level, 'return.level');
  g.wire(
    joinLists(
      g,
      'reasons',
      'Reasons for the Level',
      'string',
      LEVEL_CRITERIA.map((c) => `${c.id}.reasons` as const)
    ),
    'return.reasons'
  );
  return g.def;
};

const emergencyStatus = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
      reasonsOut('the trip is or is not an emergency')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  const noUrgency = isMissing(g, 'noUrgency', 'No Response Urgency', 'payment.responseUrgency');
  const noMode = isMissing(g, 'noMode', 'No Response Mode', 'trip.responseMode');
  const criteria: Criterion[] = [
    {
      id: 'urgency',
      label: 'Immediate Response Urgency Reported',
      reason: 'The crew reported an immediate response urgency',
      holds: isCode(
        g,
        'urgency',
        'Immediate Response Urgency',
        KIND.responseUrgency,
        'payment.responseUrgency',
        '2640001'
      )
    },
    {
      id: 'immediate',
      label: 'No Response Urgency, and an Immediate Response Mode',
      reason: 'No response urgency, and the unit responded immediately',
      holds: allOf(g, 'immediate', 'No Response Urgency and an Immediate Response Mode', [
        noUrgency,
        isIn(
          g,
          'immediateMode',
          'Immediate Response Mode',
          KIND.responseMode,
          'trip.responseMode',
          codes(g, 'immediateCodes', 'Immediate Response Modes', KIND.responseMode, [
            '2223001',
            '2223003',
            '2223007'
          ])
        )
      ])
    },
    {
      id: 'crewEmergency',
      label: 'No Response Urgency or Mode, and the Crew Reported an Emergency Level',
      reason: 'No response urgency or mode, and the crew reported an emergency level',
      holds: allOf(g, 'crewEmergency', 'No Urgency or Mode, and an Emergency Level', [
        noUrgency,
        noMode,
        isIn(
          g,
          'emergencyLevel',
          'Crew Reported an Emergency Level',
          KIND.cmsServiceLevel,
          'payment.serviceLevel',
          codes(g, 'emergencyLevels', 'Emergency Service Levels', KIND.cmsServiceLevel, [
            '2650003',
            '2650009'
          ])
        )
      ])
    },
    {
      id: 'emergencyCall',
      label: 'No Response Urgency or Mode, and an Emergency Call',
      reason: 'No response urgency or mode, and an emergency call',
      holds: allOf(g, 'emergencyCall', 'No Urgency or Mode, and an Emergency Call', [
        noUrgency,
        noMode,
        isIn(
          g,
          'emergencyService',
          'Emergency Call',
          KIND.service,
          'trip.serviceType',
          codes(g, 'emergencyServices', 'Emergency Services', KIND.service, SERVICE_TYPES.emergency)
        )
      ])
    }
  ];
  g.ret('return');
  g.wire(
    anyOf(
      g,
      'emergency',
      'An Emergency Criterion Holds',
      criteria.map((c) => c.holds)
    ),
    'return.emergency'
  );
  g.wire(reasonsOf(g, 'reasons', 'Emergency Reasons', criteria), 'return.reasons');
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
        'Miles with the patient on board, from the scene and destination odometer readings, rounded up as CMS asks: to the tenth under 100 miles, to the whole mile from 100; nothing when a reading is missing.',
        true
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'odometer', 'Odometer', ODOMETER, 'trip.odometer');
  node(g, 'distance', 'std.math.subtract', 'Destination Minus Scene', {
    a: 'odometer.destination',
    b: 'odometer.scene'
  });
  node(g, 'positive', 'std.math.max', 'Never Below Zero', { a: 'distance.result', b: fixed(0) });
  const roundUp = (id: string, label: string, digits: number) =>
    node(
      g,
      id,
      'std.math.round',
      label,
      { value: 'positive.result', digits: fixed(digits) },
      { direction: 'up' }
    );
  roundUp('tenth', 'Up to the Tenth', 1);
  roundUp('whole', 'Up to the Whole Mile', 0);
  const long = atLeast(
    g,
    'long',
    '100 Miles or More',
    'number',
    orZero(g, 'milesOrZero', 'Miles or Zero', 'positive.result'),
    100
  );
  g.ret('return');
  g.wire(
    select(
      g,
      'rounded',
      'Whole Miles From 100, Else Tenths',
      'number',
      long,
      'whole.result',
      'tenth.result'
    ),
    'return.loadedMiles'
  );
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
  node(g, 'day', 'std.time.parts', 'Day of Service', { time: first });
  g.ret('return');
  g.wire('day.date', 'return.serviceDate');
  return g.def;
};

const serviceDetails = (): GraphDef => {
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
      d('level', CODE.level, 'Level of Service', 'The level of service: BLS, ALS1, ALS2 or SCT.'),
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
      d(
        'loadedMiles',
        'number',
        'Loaded Miles',
        'Miles with the patient on board, when the odometer was read.',
        true
      ),
      reasonsOut('the service was decided this way')
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

const POUNDS_PER_KILOGRAM = 2.20462;

const CONDITION_LIMIT = 5;

const ambulanceDetails = (): GraphDef => {
  const condition = code('ambulanceCondition');
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'transportReason',
        code('transportReason'),
        'Transport Reason',
        'Why the patient went to this destination, A to E, for the ambulance transport information (CR1).',
        true
      ),
      d(
        'conditionCodes',
        listOf(condition),
        'Condition Codes',
        'The ambulance conditions the crew reported, each once and at most five, for the ambulance certification (CRC).'
      ),
      d(
        'weightPounds',
        'integer',
        'Weight in Pounds',
        'The patient weight rounded up to the whole pound, for the ambulance transport information (CR1).',
        true
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  breakRecord(g, 'patient', 'Patient', PERSON, 'trip.patient');
  const config = { type: condition };
  node(g, 'once', 'std.list.unique', 'Each Once', { list: 'payment.ambulanceConditions' }, config);
  node(
    g,
    'five',
    'std.list.slice',
    'At Most Five',
    { list: 'once.list', start: fixed(0), end: fixed(CONDITION_LIMIT) },
    config
  );
  node(g, 'pounds', 'std.math.multiply', 'Kilograms to Pounds', {
    a: 'patient.weightKg',
    b: fixed(POUNDS_PER_KILOGRAM)
  });
  node(
    g,
    'wholePounds',
    'std.math.round',
    'Up to the Whole Pound',
    { value: 'pounds.result', digits: fixed(0) },
    { direction: 'up' }
  );
  g.ret('return');
  g.wire('payment.transportReason', 'return.transportReason');
  g.wire('five.list', 'return.conditionCodes');
  g.wire('wholePounds.result', 'return.weightPounds');
  return g.def;
};

const diagnoses = (): GraphDef => {
  const icd10 = code('icd10');
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'diagnoses',
        listOf(icd10),
        'Diagnoses',
        'The primary impression, then the secondary impressions, the primary symptom and the other symptoms, each once and at most twelve.'
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  const all = joinLists(g, 'all', 'Impressions, Then Symptoms', icd10, [
    makeList(g, 'primary', 'Primary Impression', icd10, ['trip.primaryImpression']),
    'trip.secondaryImpressions',
    makeList(g, 'symptom', 'Primary Symptom', icd10, ['trip.primarySymptom']),
    'trip.otherSymptoms'
  ]);
  const config = { type: icd10 };
  node(g, 'once', 'std.list.unique', 'Each Once', { list: all }, config);
  node(
    g,
    'twelve',
    'std.list.slice',
    'At Most Twelve',
    { list: 'once.list', start: fixed(0), end: fixed(12) },
    config
  );
  g.ret('return');
  g.wire('twelve.list', 'return.diagnoses');
  return g.def;
};

export const serviceGraphs: SeedGraph[] = [
  asRule(
    'billing.by-this-unit',
    'By This Unit',
    'Whether this unit gave the care, not another unit and not before this unit arrived. Only care this unit gave counts toward the level of service.',
    byThisUnit()
  ),
  asRule(
    'billing.iv-medication',
    'IV Medication',
    'Whether one medication counts toward the level of service: given by this unit, IV or IO, and not an IV solution such as saline or dextrose.',
    ivMedication()
  ),
  asRule(
    'billing.als2-procedure',
    'ALS2 Procedure',
    'Whether one procedure counts toward ALS2: performed by this unit and one CMS names for ALS2: manual defibrillation or cardioversion, endotracheal intubation, a central venous line, cardiac pacing, chest decompression, a surgical airway or an intraosseous line.',
    als2Procedure()
  ),
  asRule(
    'billing.sct-criteria',
    'SCT Criteria',
    'Whether a trip is SCT: critical care, or specialty care the crew reported, on an interfacility transport.',
    sctCriteria()
  ),
  asRule(
    'billing.als2-criteria',
    'ALS2 Criteria',
    'Whether a trip is ALS2: an ALS2 procedure, three or more IV/IO medications, or ALS2 the crew reported.',
    als2Criteria()
  ),
  asRule(
    'billing.als1-criteria',
    'ALS1 Criteria',
    'Whether a trip is ALS1: an ALS assessment performed and warranted, ALS1 the crew reported, or an IV/IO medication.',
    als1Criteria()
  ),
  asRule(
    'billing.level-of-service',
    'Level of Service',
    'The level of service: the highest of SCT, ALS2 and ALS1 whose criteria hold, else BLS.',
    levelOfService()
  ),
  asRule(
    'billing.emergency-status',
    'Emergency Status',
    'Whether a trip is an emergency: the immediate response urgency the crew reported, else an immediate response mode, else, with neither, an emergency call or an emergency level the crew reported.',
    emergencyStatus()
  ),
  asRule(
    'billing.loaded-miles',
    'Loaded Miles',
    'Miles with the patient on board: the destination odometer less the scene odometer, never below zero, rounded up to the tenth under 100 miles and to the whole mile from 100, as CMS asks.',
    loadedMiles()
  ),
  asRule(
    'billing.service-date',
    'Service Date',
    'The date of service: the day the crew reached the patient, else the scene, else was notified, else got the call.',
    serviceDate()
  ),
  asRule(
    'billing.service-details',
    'Service Details',
    'The date of service, level of service, emergency status and loaded miles of an encounter, with the reasons.',
    serviceDetails()
  ),
  asRule(
    'billing.ambulance-details',
    'Ambulance Details',
    'What the ambulance claim reports about the transport: the transport reason, the ambulance condition codes (at most five) and the patient weight in whole pounds.',
    ambulanceDetails()
  ),
  asRule(
    'billing.diagnoses',
    'Diagnoses',
    'The diagnoses of a claim: the primary impression, then the secondary impressions, the primary symptom and the other symptoms, each once and at most twelve.',
    diagnoses()
  )
];
