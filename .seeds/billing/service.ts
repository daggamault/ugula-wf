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
  PAYMENT,
  type Port,
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
  service: 'serviceType',
  levelOfCare: 'levelOfCare',
  cmsServiceLevel: 'cmsServiceLevel',
  yesNo: 'yesNo',
  responseMode: 'responseMode',
  route: 'medicationRoute',
  rxnorm: 'rxnorm',
  snomed: 'snomed'
} as const;

const codeIn = (name: string, kind: string, label: string, description: string) =>
  d(name, code(kind), label, description, true);

const INCIDENT_IN = codeIn(
  'incidentDisposition',
  KIND.incident,
  'Incident Disposition',
  'What happened with the incident and patient, NEMSIS eDisposition.12.'
);

const UNIT_IN = codeIn(
  'unitDisposition',
  KIND.unit,
  'Unit Disposition',
  'What the unit did, NEMSIS eDisposition.27.'
);

const TRANSPORT_IN = codeIn(
  'transportDisposition',
  KIND.transport,
  'Transport Disposition',
  'Whether and how the unit transported the patient, NEMSIS eDisposition.30.'
);

const EVALUATION_IN = codeIn(
  'patientEvaluation',
  KIND.evaluation,
  'Patient Evaluation',
  'Whether the patient was evaluated and cared for, NEMSIS eDisposition.28.'
);

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

const TRANSPORTED = ['4230001', '4230003'];

const TRANSPORTED_INCIDENTS = ['4212013', '4212017', '4212023', '4212033'];

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

const wireFields = (g: Builder, from: string, to: string, names: readonly string[]) => {
  for (const name of names) g.wire(`${from}.${name}`, `${to}.${name}`);
};

const notBillableCriteria = (): GraphDef => {
  const g = rule([INCIDENT_IN, UNIT_IN, TRANSPORT_IN, SERVICE_IN], CRITERIA_OUT);
  const transportedIncidents = codes(
    g,
    'transportedIncidents',
    'Transported Incident Dispositions',
    KIND.incident,
    TRANSPORTED_INCIDENTS
  );
  const transported = codes(
    g,
    'transportedCodes',
    'Transported Dispositions',
    KIND.transport,
    TRANSPORTED
  );
  const criteria: Criterion[] = [
    {
      id: 'cancelled',
      label: 'Cancelled, or No Patient Contact',
      reason: 'Cancelled, or no patient contact',
      holds: isIn(
        g,
        'cancelled',
        'Cancelled, or No Patient Contact',
        KIND.incident,
        'entry.incidentDisposition',
        codes(g, 'cancelledCodes', 'Cancelled Dispositions', KIND.incident, [
          '4212007',
          '4212009',
          '4212011'
        ])
      )
    },
    {
      id: 'assist',
      label: 'Assist, Standby or Non-Patient Transport',
      reason: 'Assist, standby or non-patient transport',
      holds: isIn(
        g,
        'assist',
        'Assist, Standby or Non-Patient Transport',
        KIND.incident,
        'entry.incidentDisposition',
        codes(g, 'assistCodes', 'Assist and Standby Dispositions', KIND.incident, [
          '4212001',
          '4212003',
          '4212005',
          '4212039',
          '4212041',
          '4212043'
        ])
      )
    },
    {
      id: 'unitCancelled',
      label: 'Unit Cancelled, Made No Patient Contact, or Had No Patient',
      reason: 'Unit cancelled, made no patient contact, or had no patient',
      holds: isIn(
        g,
        'unitCancelled',
        'Unit Cancelled or Without a Patient',
        KIND.unit,
        'entry.unitDisposition',
        codes(g, 'unitCancelledCodes', 'Unit Cancelled Dispositions', KIND.unit, [
          '4227003',
          '4227005',
          '4227007',
          '4227009',
          '4227011'
        ])
      )
    },
    {
      id: 'nonPatientTransport',
      label: 'Non-Patient Transport',
      reason: 'Non-patient transport',
      holds: isCode(
        g,
        'nonPatientTransport',
        'Non-Patient Transport',
        KIND.transport,
        'entry.transportDisposition',
        '4230011'
      )
    },
    {
      id: 'nonPatientService',
      label: 'Non-Patient Service and Nobody Transported',
      reason: 'Non-patient service requested and nobody transported',
      holds: allOf(g, 'nonPatientService', 'Non-Patient Service and Nobody Transported', [
        isIn(
          g,
          'nonPatientRequest',
          'Non-Patient Service Requested',
          KIND.service,
          'entry.serviceType',
          codes(g, 'nonPatientCodes', 'Non-Patient Services', KIND.service, NON_PATIENT_SERVICES)
        ),
        not(
          g,
          'noTransportedIncident',
          'Incident Not Transported',
          isIn(
            g,
            'transportedIncident',
            'Incident Transported',
            KIND.incident,
            'entry.incidentDisposition',
            transportedIncidents
          )
        ),
        not(
          g,
          'noTransport',
          'Unit Did Not Transport',
          isIn(
            g,
            'unitTransported',
            'Unit Transported',
            KIND.transport,
            'entry.transportDisposition',
            transported
          )
        )
      ])
    }
  ];
  return criteriaResult(g, 'Not Billable', criteria);
};

const refusalCriteria = (): GraphDef => {
  const g = rule([INCIDENT_IN, EVALUATION_IN, TRANSPORT_IN], CRITERIA_OUT);
  return criteriaResult(g, 'Refusal', [
    {
      id: 'refusedCare',
      label: 'Patient Refused Care',
      reason: 'Patient refused care',
      holds: isCode(
        g,
        'refusedCare',
        'Patient Refused Care',
        KIND.incident,
        'entry.incidentDisposition',
        '4212025'
      )
    },
    {
      id: 'refusedTransport',
      label: 'Patient Refused Care and Transport',
      reason: 'Patient refused care and transport',
      holds: allOf(g, 'refusedTransport', 'Patient Refused Care and Transport', [
        isIn(
          g,
          'refusedEvaluation',
          'Patient Refused Evaluation or Care',
          KIND.evaluation,
          'entry.patientEvaluation',
          codes(g, 'refusedEvaluationCodes', 'Refused Evaluations', KIND.evaluation, [
            '4228003',
            '4228007'
          ])
        ),
        isIn(
          g,
          'refusedTransportCode',
          'Patient Refused Transport',
          KIND.transport,
          'entry.transportDisposition',
          codes(g, 'refusedTransportCodes', 'Refused Transports', KIND.transport, [
            '4230009',
            '4230013'
          ])
        )
      ])
    }
  ]);
};

const noTransportCriteria = (): GraphDef => {
  const g = rule([INCIDENT_IN, TRANSPORT_IN], CRITERIA_OUT);
  return criteriaResult(g, 'No Transport', [
    {
      id: 'treated',
      label: 'Patient Treated and Not Transported',
      reason: 'Patient treated and not transported',
      holds: isIn(
        g,
        'treated',
        'Patient Treated and Not Transported',
        KIND.incident,
        'entry.incidentDisposition',
        codes(g, 'treatedCodes', 'Treated, Not Transported Dispositions', KIND.incident, [
          '4212015',
          '4212019',
          '4212021',
          '4212027',
          '4212029',
          '4212031',
          '4212035',
          '4212037'
        ])
      )
    },
    {
      id: 'notTransportedByUnit',
      label: 'Patient Not Transported by This Unit',
      reason: 'Patient not transported by this unit',
      holds: isIn(
        g,
        'notTransportedByUnit',
        'Patient Not Transported by This Unit',
        KIND.transport,
        'entry.transportDisposition',
        codes(g, 'notTransportedCodes', 'Not Transported Dispositions', KIND.transport, [
          '4230005',
          '4230007',
          '4230009',
          '4230013'
        ])
      )
    }
  ]);
};

const transportCriteria = (): GraphDef => {
  const g = rule([INCIDENT_IN, TRANSPORT_IN], CRITERIA_OUT);
  return criteriaResult(g, 'Transport', [
    {
      id: 'treatedAndTransported',
      label: 'Patient Treated and Transported by This Unit',
      reason: 'Patient treated and transported by this unit',
      holds: isIn(
        g,
        'treatedAndTransported',
        'Patient Treated and Transported',
        KIND.incident,
        'entry.incidentDisposition',
        codes(
          g,
          'transportedIncidents',
          'Transported Incident Dispositions',
          KIND.incident,
          TRANSPORTED_INCIDENTS
        )
      )
    },
    {
      id: 'transported',
      label: 'Patient Transported by This Unit',
      reason: 'Patient transported by this unit',
      holds: isIn(
        g,
        'transported',
        'Patient Transported by This Unit',
        KIND.transport,
        'entry.transportDisposition',
        codes(g, 'transportedCodes', 'Transported Dispositions', KIND.transport, TRANSPORTED)
      )
    }
  ]);
};

const scheduledCriteria = (): GraphDef => {
  const g = rule([SERVICE_IN], CRITERIA_OUT);
  return criteriaResult(g, 'Scheduled', [
    {
      id: 'scheduled',
      label: 'Scheduled or Interfacility Transport',
      reason: 'Scheduled or interfacility transport',
      holds: isIn(
        g,
        'scheduled',
        'Scheduled or Interfacility Service',
        KIND.service,
        'entry.serviceType',
        codes(g, 'scheduledCodes', 'Scheduled and Interfacility Services', KIND.service, [
          ...INTERFACILITY,
          ...SERVICE_TYPES.scheduled
        ])
      )
    }
  ]);
};

type CriteriaNode = { id: string; key: string; label: string; fields: readonly string[] };

const TRIP_CRITERIA: CriteriaNode[] = [
  {
    id: 'notBillable',
    key: 'billing.not-billable-criteria',
    label: 'Not Billable Criteria',
    fields: ['incidentDisposition', 'unitDisposition', 'transportDisposition', 'serviceType']
  },
  {
    id: 'refusal',
    key: 'billing.refusal-criteria',
    label: 'Refusal Criteria',
    fields: ['incidentDisposition', 'patientEvaluation', 'transportDisposition']
  },
  {
    id: 'noTransport',
    key: 'billing.no-transport-criteria',
    label: 'No Transport Criteria',
    fields: ['incidentDisposition', 'transportDisposition']
  },
  {
    id: 'transport',
    key: 'billing.transport-criteria',
    label: 'Transport Criteria',
    fields: ['incidentDisposition', 'transportDisposition']
  },
  {
    id: 'scheduled',
    key: 'billing.scheduled-criteria',
    label: 'Scheduled Criteria',
    fields: ['serviceType']
  }
];

const BILLABLE = ['emergency', 'scheduled', 'treatNoTransport'];

const tripClassification = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'classification',
        CODE.classification,
        'Classification',
        'What kind of trip it was: emergency, scheduled, treatNoTransport, refusal or notBillable.'
      ),
      d('billable', 'boolean', 'Billable', 'Whether the trip is billed.'),
      reasonsOut('the trip was classified this way')
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  for (const c of TRIP_CRITERIA) {
    g.add(c.id, c.key, { label: c.label });
    wireFields(g, 'trip', c.id, c.fields);
  }
  const kind = (id: string, label: string, when: Port, value: string) =>
    select(g, id, label, CODE.classification, when, fixed(value));
  const classification = firstSet(
    g,
    'classification',
    'First Kind of Trip That Holds',
    CODE.classification,
    [
      kind(
        'asNotBillable',
        'Not Billable When Its Criteria Hold',
        'notBillable.holds',
        'notBillable'
      ),
      kind('asRefusal', 'Refusal When Its Criteria Hold', 'refusal.holds', 'refusal'),
      kind(
        'asNoTransport',
        'Treated, No Transport When Its Criteria Hold',
        'noTransport.holds',
        'treatNoTransport'
      ),
      kind(
        'asScheduled',
        'Scheduled When Transported on a Schedule',
        allOf(g, 'scheduledTransport', 'Transported on a Schedule', [
          'transport.holds',
          'scheduled.holds'
        ]),
        'scheduled'
      ),
      kind('asEmergency', 'Emergency When Transported', 'transport.holds', 'emergency'),
      fixed('notBillable')
    ]
  );
  const billable = isIn(
    g,
    'billable',
    'Billable Kind of Trip',
    'tripClassification',
    classification,
    codes(g, 'billableKinds', 'Billable Kinds of Trip', 'tripClassification', BILLABLE)
  );
  const none = not(
    g,
    'noneHeld',
    'No Criteria Hold',
    anyOf(
      g,
      'anyHeld',
      'Any Criteria Hold',
      TRIP_CRITERIA.map((c) => `${c.id}.holds` as const)
    )
  );
  const missing = reasonsOf(g, 'missing', 'No Disposition Reported', [
    {
      id: 'missing',
      label: 'No Criteria Hold',
      reason: 'No disposition says what happened on the trip',
      holds: none
    }
  ]);
  g.ret('return');
  g.wire(classification, 'return.classification');
  g.wire(billable, 'return.billable');
  g.wire(
    joinLists(g, 'allReasons', 'Every Reason', 'string', [
      ...TRIP_CRITERIA.map((c) => `${c.id}.reasons` as const),
      missing
    ]),
    'return.reasons'
  );
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

const resultOut = (description: string) => [d('result', 'boolean', 'Result', description)];

const ivMedication = (): GraphDef => {
  const g = rule(
    [d('medication', T.medication, 'Medication', 'One medication the crew gave.')],
    resultOut('Whether it was given IV or IO and is not an IV solution.')
  );
  breakRecord(g, 'medication', 'Medication', MEDICATION, 'entry.medication');
  g.ret('return');
  g.wire(
    allOf(g, 'ivMedication', 'Given IV or IO, Not a Solution', [
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
    resultOut('Whether the procedure is one CMS names for ALS2.')
  );
  breakRecord(g, 'procedure', 'Procedure', PROCEDURE, 'entry.procedure');
  g.ret('return');
  g.wire(
    isIn(
      g,
      'als2',
      'ALS2 Procedure',
      KIND.snomed,
      'procedure.code',
      codes(g, 'als2Codes', 'ALS2 Procedures', KIND.snomed, ALS2_PROCEDURES)
    ),
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
  const noMode = isMissing(g, 'noMode', 'No Response Mode', 'trip.responseMode');
  const criteria: Criterion[] = [
    {
      id: 'immediate',
      label: 'Immediate Response to the Call',
      reason: 'Immediate response to the call',
      holds: isIn(
        g,
        'immediate',
        'Immediate Response',
        KIND.responseMode,
        'trip.responseMode',
        codes(g, 'immediateCodes', 'Immediate Response Modes', KIND.responseMode, [
          '2223001',
          '2223003',
          '2223007'
        ])
      )
    },
    {
      id: 'crewEmergency',
      label: 'No Response Mode, and the Crew Reported an Emergency Level',
      reason: 'No response mode, and the crew reported an emergency level',
      holds: allOf(g, 'crewEmergency', 'No Response Mode and an Emergency Level', [
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
      label: 'No Response Mode, and an Emergency Call',
      reason: 'No response mode, and an emergency call',
      holds: allOf(g, 'emergencyCall', 'No Response Mode and an Emergency Call', [
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
        'Miles with the patient on board, from the scene and destination odometer readings, rounded up to the tenth; nothing when a reading is missing.',
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
  node(
    g,
    'rounded',
    'std.math.round',
    'Up to the Tenth',
    { value: 'positive.result', digits: fixed(1) },
    { direction: 'up' }
  );
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

const diagnoses = (): GraphDef => {
  const icd10 = code('icd10');
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'diagnoses',
        listOf(icd10),
        'Diagnoses',
        'The primary impression, then the secondary ones, each once and at most twelve.'
      )
    ]
  );
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  const primary = makeList(g, 'primary', 'Primary Impression', icd10, ['trip.primaryImpression']);
  const all = joinLists(g, 'all', 'Primary, Then Secondary', icd10, [
    primary,
    'trip.secondaryImpressions'
  ]);
  const config = { type: icd10 };
  node(g, 'present', 'std.list.compact', 'Impressions Given', { list: all }, config);
  node(g, 'once', 'std.list.unique', 'Each Once', { list: 'present.list' }, config);
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
    'billing.not-billable-criteria',
    'Not Billable Criteria',
    'Whether a trip is not billable: cancelled or no patient contact, an assist or standby, a unit cancelled or without a patient, a non-patient transport, or a non-patient service with nobody transported.',
    notBillableCriteria()
  ),
  asRule(
    'billing.refusal-criteria',
    'Refusal Criteria',
    'Whether the patient refused: refused care, or refused both care and transport.',
    refusalCriteria()
  ),
  asRule(
    'billing.no-transport-criteria',
    'No Transport Criteria',
    'Whether the patient was treated and not transported, or not transported by this unit.',
    noTransportCriteria()
  ),
  asRule(
    'billing.transport-criteria',
    'Transport Criteria',
    'Whether this unit transported the patient, by the incident or the transport disposition.',
    transportCriteria()
  ),
  asRule(
    'billing.scheduled-criteria',
    'Scheduled Criteria',
    'Whether the service requested was scheduled or between facilities.',
    scheduledCriteria()
  ),
  asRule(
    'billing.trip-classification',
    'Trip Classification',
    'What kind of trip an encounter was: not billable, refusal, treated without transport, scheduled or emergency, the first whose criteria hold, and whether it is billed.',
    tripClassification()
  ),
  asRule(
    'billing.iv-medication',
    'IV Medication',
    'Whether one medication counts toward the level of service: given IV or IO, and not an IV solution such as saline or dextrose.',
    ivMedication()
  ),
  asRule(
    'billing.als2-procedure',
    'ALS2 Procedure',
    'Whether one procedure is one CMS names for ALS2: manual defibrillation or cardioversion, endotracheal intubation, a central venous line, cardiac pacing, chest decompression, a surgical airway or an intraosseous line.',
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
    'billing.service-details',
    'Service Details',
    'The date of service, level of service, emergency status and loaded miles of an encounter, with the reasons.',
    serviceDetails()
  ),
  asRule(
    'billing.diagnoses',
    'Diagnoses',
    'The diagnoses of a claim: the primary impression, then the secondary impressions, each once and at most twelve.',
    diagnoses()
  )
];
