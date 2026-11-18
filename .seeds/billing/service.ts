import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
  anyOf,
  asRule,
  atLeast,
  type Builder,
  breakEncounter,
  breakRecord,
  CODE,
  CRITERIA_OUT,
  type Criterion,
  code,
  codes,
  codeTable,
  containsAny,
  criteriaResult,
  DESTINATION,
  d,
  firstSet,
  fixed,
  INTERFACILITY,
  isCode,
  isIn,
  isMissing,
  joinLists,
  keepWhere,
  listOf,
  lookup,
  MEDICATION,
  makeList,
  n,
  node,
  not,
  ODOMETER,
  orZero,
  PAYMENT,
  PERSON,
  type Port,
  PROCEDURE,
  phraseList,
  pinOf,
  reasonsOf,
  reasonsOut,
  rule,
  SERVICE_TYPES,
  select,
  T,
  TIMES,
  template,
  VITAL
} from './shared.ts';

const ENCOUNTER_IN = d('encounter', T.encounter, 'Encounter', 'The encounter to decide from.');

const KIND = {
  service: 'serviceType',
  levelOfCare: 'levelOfCare',
  cmsServiceLevel: 'cmsServiceLevel',
  yesNo: 'yesNo',
  responseUrgency: 'responseUrgency',
  responseMode: 'responseMode',
  responseModifier: 'responseModifier',
  route: 'medicationRoute',
  rxnorm: 'rxnorm',
  snomed: 'snomed',
  crewLevel: 'crewLevel',
  unitLevel: 'unitLevel',
  sctProvider: 'sctProvider',
  ecgType: 'ecgType',
  destinationReason: 'destinationReason',
  destinationType: 'destinationType'
} as const;

const YES = '9923003';

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
  '847627',
  '1008377'
];

const BLS_MEDICATIONS = ['7806', '1191', '4850', '435', '214199', '7242', '328316', '4917', '161'];

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
  '440009003',
  '450601000124103',
  '241689008'
];

const ALS_PROCEDURES = [
  '392230005',
  '405427009',
  '386358000',
  '431393006',
  '103744005',
  '425074000',
  '392247006',
  '429705000',
  '427753009',
  '424979004',
  '87750000',
  '235425002',
  '45851008',
  '385857005',
  '128968000',
  '116859006'
];

const ECG_PROCEDURES = ['268400002', '428803005', '23852006', '46825001', '29303009'];

const ALS_UNITS = ['2215009', '2215011', '2215013', '2215015', '2215017', '2215019', '2215021'];

const ALS_CREW = [
  '9925001',
  '9925002',
  '9925007',
  '9925017',
  '9925019',
  '9925027',
  '9925033',
  '9925037',
  '9925039',
  '9925043'
];

const ALS_CARE = ['4232003', '4232005', '4232009'];

const SPECIALTY_UNITS = ['2215017', '2215019', '2215021'];

const SPECIALTY_CREW = ['9925027', '9925033', '9925037', '9925039', '9925043'];

const SPECIALTY_PROVIDERS = ['2642003', '2642005', '2642007', '2642009', '2642035', '2642039'];

const ALS2_PHRASES = [
  'intubated',
  'intubation',
  'endotracheal tube',
  'RSI',
  'rapid sequence',
  'cricothyrotomy',
  'surgical airway',
  'needle decompression',
  'needle decompressed',
  'chest decompression',
  'transcutaneous pacing',
  'TCP',
  'cardioverted',
  'cardioversion',
  'intraosseous',
  'IO access',
  'IO placed',
  'IO established',
  'EZ-IO',
  'central line'
];

const ALS_PHRASES = [
  'IV established',
  'IV access',
  'IV placed',
  'IV started',
  'IV initiated',
  'saline lock',
  '18g',
  '20g',
  '22g',
  '18 gauge',
  '20 gauge',
  '12 lead',
  '12-lead',
  'cardiac monitor',
  'King airway',
  'i-gel',
  'supraglottic',
  'LMA',
  'ondansetron',
  'zofran',
  'fentanyl',
  'morphine',
  'midazolam',
  'versed',
  'ketamine',
  'adenosine',
  'amiodarone',
  'diltiazem',
  'dextrose'
];

const EMERGENT_MODES = ['2223001', '2223003', '2223007'];

const LIGHTS = ['2224015', '2224017', '2224021', '2224023'];

const QUIET = ['2224007', '2224019'];

const breakPayment = (g: Builder) =>
  breakRecord(
    g,
    'payment',
    n('Payment', 'What the report records for billing.'),
    PAYMENT,
    'trip.payment'
  );

const resultOut = (description: string) => [d('result', 'boolean', 'Result', description)];

const codeIn = (name: string, kind: string, label: string, description: string) =>
  d(name, code(kind), label, description, true);

const countIn = (name: string, label: string, description: string) =>
  d(name, 'integer', label, description);

const flagIn = (name: string, label: string, description: string) =>
  d(name, 'boolean', label, description);

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
      n('Given by This Unit', 'Care is this unit’s unless the report says otherwise.'),
      anyOf(g, 'elsewhere', n('Given Elsewhere', 'Before arrival or by another unit.'), [
        isCode(
          g,
          'before',
          n('Before This Unit Arrived', 'Care given before arrival is not this unit’s.'),
          KIND.yesNo,
          'entry.priorToCare',
          YES
        ),
        isCode(
          g,
          'other',
          n('By Another Unit', 'Care another unit gave is not this unit’s.'),
          KIND.yesNo,
          'entry.byAnotherUnit',
          YES
        )
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
  g.add('thisUnit', 'billing.by-this-unit', {
    label: 'Given by This Unit',
    note: 'Only this unit’s care counts toward its level.'
  });
  wireFields(g, record, 'thisUnit', ['priorToCare', 'byAnotherUnit']);
  return 'thisUnit.result' as const;
};

const breakMedication = (g: Builder) =>
  breakRecord(
    g,
    'medication',
    n('Medication', 'The medication’s code, route and who gave it.'),
    MEDICATION,
    'entry.medication'
  );

const breakProcedure = (g: Builder) =>
  breakRecord(
    g,
    'procedure',
    n('Procedure', 'The procedure’s code and who performed it.'),
    PROCEDURE,
    'entry.procedure'
  );

const ivRoute = (g: Builder) =>
  isIn(
    g,
    'ivRoute',
    n('Given IV or IO', 'The route, NEMSIS eMedications.04.'),
    KIND.route,
    'medication.route',
    codes(
      g,
      'ivRoutes',
      n('IV and IO Routes', 'Intraosseous, intravenous and IV pump.'),
      KIND.route,
      IV_ROUTES
    )
  );

const ivMedication = (): GraphDef => {
  const g = rule(
    [d('medication', T.medication, 'Medication', 'One medication the crew gave.')],
    resultOut('Whether this unit gave it IV or IO and it is not an IV solution.')
  );
  breakMedication(g);
  g.ret('return');
  g.wire(
    allOf(
      g,
      'ivMedication',
      n(
        'Given IV or IO by This Unit, Not a Solution',
        'CMS counts these toward the three ALS2 medication administrations.'
      ),
      [
        careByThisUnit(g, 'medication'),
        ivRoute(g),
        not(
          g,
          'notSolution',
          n(
            'Not an IV Solution',
            'CMS leaves crystalloid and dextrose solutions out of the count.'
          ),
          isIn(
            g,
            'solution',
            n('Is an IV Solution', 'The medication code, NEMSIS eMedications.03.'),
            KIND.rxnorm,
            'medication.code',
            codes(
              g,
              'solutions',
              n('IV Solutions', 'Saline, lactated Ringer’s and dextrose solutions.'),
              KIND.rxnorm,
              IV_SOLUTIONS
            )
          )
        )
      ]
    ),
    'return.result'
  );
  return g.def;
};

const alsMedication = (): GraphDef => {
  const g = rule(
    [d('medication', T.medication, 'Medication', 'One medication the crew gave.')],
    resultOut('Whether this unit gave it and only an ALS crew may: IV or IO, or beyond EMT scope.')
  );
  breakMedication(g);
  g.ret('return');
  g.wire(
    allOf(
      g,
      'alsMedication',
      n('ALS Medication by This Unit', 'An ALS intervention CMS counts toward ALS1.'),
      [
        careByThisUnit(g, 'medication'),
        anyOf(
          g,
          'alsGiven',
          n('Needs an ALS Crew', 'IV or IO, or a medication an EMT may not give.'),
          [
            ivRoute(g),
            allOf(
              g,
              'beyondEmt',
              n('Beyond EMT Scope', 'A known medication that is not on the EMT list.'),
              [
                not(
                  g,
                  'codeKnown',
                  n('Medication Known', 'The report names the medication.'),
                  isMissing(
                    g,
                    'codeMissing',
                    n('No Medication Code', 'The code is empty.'),
                    'medication.code'
                  )
                ),
                not(
                  g,
                  'notEmt',
                  n(
                    'Not an EMT Medication',
                    'EMTs may give these, so they do not make the trip ALS.'
                  ),
                  isIn(
                    g,
                    'emtMedication',
                    n('Is an EMT Medication', 'The medication code.'),
                    KIND.rxnorm,
                    'medication.code',
                    codes(
                      g,
                      'emtMedications',
                      n(
                        'EMT Medications',
                        'Oxygen, aspirin, oral glucose, albuterol, naloxone, epinephrine auto-injector, nitroglycerin, acetaminophen.'
                      ),
                      KIND.rxnorm,
                      BLS_MEDICATIONS
                    )
                  )
                )
              ]
            )
          ]
        )
      ]
    ),
    'return.result'
  );
  return g.def;
};

const procedureRule = (list: string, listNote: string, values: string[], what: string) => {
  const g = rule(
    [d('procedure', T.procedure, 'Procedure', 'One procedure the crew performed.')],
    resultOut(`Whether this unit performed it and it is ${what}.`)
  );
  breakProcedure(g);
  g.ret('return');
  g.wire(
    allOf(
      g,
      'matches',
      n(`${list} by This Unit`, `Only this unit’s ${list.toLowerCase()} count.`),
      [
        careByThisUnit(g, 'procedure'),
        isIn(
          g,
          'listed',
          n(`Is One of the ${list}`, 'The procedure code, NEMSIS eProcedures.03.'),
          KIND.snomed,
          'procedure.code',
          codes(g, 'listedCodes', n(list, listNote), KIND.snomed, values)
        )
      ]
    ),
    'return.result'
  );
  return g.def;
};

const ecgReading = (): GraphDef => {
  const g = rule(
    [d('vital', T.vital, 'Vital Signs', 'One set of vital signs.')],
    resultOut('Whether this unit read a cardiac rhythm or an ECG in it.')
  );
  breakRecord(g, 'vital', n('Vital Signs', 'The rhythm and ECG of the set.'), VITAL, 'entry.vital');
  g.ret('return');
  g.wire(
    allOf(g, 'read', n('ECG Read by This Unit', 'A rhythm or ECG taken after arrival.'), [
      not(
        g,
        'afterArrival',
        n('Taken After Arrival', 'Vitals from before arrival are not this unit’s.'),
        isCode(
          g,
          'beforeArrival',
          n('Taken Before Arrival', 'NEMSIS eVitals.02.'),
          KIND.yesNo,
          'vital.priorToCare',
          YES
        )
      ),
      anyOf(g, 'ecg', n('Rhythm or ECG Given', 'A cardiac rhythm or an ECG type.'), [
        not(
          g,
          'ecgTypeKnown',
          n('ECG Type Given', 'NEMSIS eVitals.04.'),
          isMissing(g, 'ecgTypeMissing', n('No ECG Type', 'The type is empty.'), 'vital.ecgType')
        ),
        atLeast(
          g,
          'rhythmGiven',
          n('Rhythm Given', 'NEMSIS eVitals.03.'),
          'integer',
          pinOf(
            node(g, 'rhythms', 'std.list.length', n('Rhythms', 'Counts the rhythms read.'), {
              list: 'vital.cardiacRhythm'
            }),
            'length'
          ),
          1
        )
      ])
    ]),
    'return.result'
  );
  return g.def;
};

const crewLevels = (g: Builder) =>
  pinOf(
    node(
      g,
      'crewLevels',
      'std.list.pluck',
      n('Crew Levels', 'The certification level of each crew member, NEMSIS eCrew.02.'),
      { list: 'trip.crew', field: fixed('level') }
    ),
    'list'
  );

const alsCrewCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakEncounter(g);
  return criteriaResult(g, 'ALS Crew', [
    {
      id: 'alsUnit',
      label: 'ALS Unit',
      reason: 'The unit is staffed at an ALS level',
      holds: isIn(
        g,
        'alsUnit',
        n('ALS Unit', 'NEMSIS requires the unit level, so this is always known.'),
        KIND.unitLevel,
        'trip.unitLevel',
        codes(
          g,
          'alsUnits',
          n(
            'ALS Unit Levels',
            'AEMT, intermediate, paramedic, community paramedic, nurse, physician, critical care.'
          ),
          KIND.unitLevel,
          ALS_UNITS
        )
      )
    },
    {
      id: 'alsCrew',
      label: 'ALS Crew Member',
      reason: 'An ALS-certified crew member was on the trip',
      holds: containsAny(
        g,
        'alsCrew',
        n('ALS Crew Member', 'Any crew member certified above EMT.'),
        KIND.crewLevel,
        crewLevels(g),
        ALS_CREW,
        n(
          'ALS Crew Levels',
          'AEMT, intermediate, paramedic, critical care paramedic, nurse, NP, PA, physician.'
        )
      )
    },
    {
      id: 'alsCare',
      label: 'ALS Care Given',
      reason: 'The report says the highest level of care given was ALS',
      holds: isIn(
        g,
        'alsCare',
        n('ALS Care Given', 'The level of care, NEMSIS eDisposition.32.'),
        KIND.levelOfCare,
        'trip.levelOfCare',
        codes(
          g,
          'alsCareLevels',
          n('ALS Levels of Care', 'ALS AEMT, ALS paramedic, critical care.'),
          KIND.levelOfCare,
          ALS_CARE
        )
      )
    }
  ]);
};

const specialtyCrewCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakEncounter(g);
  breakPayment(g);
  return criteriaResult(g, 'Specialty Crew', [
    {
      id: 'specialtyUnit',
      label: 'Specialty Unit',
      reason: 'The unit is staffed for specialty or critical care',
      holds: isIn(
        g,
        'specialtyUnit',
        n('Specialty Unit', 'The unit level, NEMSIS eResponse.15.'),
        KIND.unitLevel,
        'trip.unitLevel',
        codes(
          g,
          'specialtyUnits',
          n('Specialty Unit Levels', 'ALS nurse, ALS physician, specialty critical care.'),
          KIND.unitLevel,
          SPECIALTY_UNITS
        )
      )
    },
    {
      id: 'specialtyCrew',
      label: 'Specialty Crew Member',
      reason: 'A crew member certified beyond a paramedic was on the trip',
      holds: containsAny(
        g,
        'specialtyCrew',
        n('Specialty Crew Member', 'A critical care paramedic, nurse, NP, PA or physician.'),
        KIND.crewLevel,
        crewLevels(g),
        SPECIALTY_CREW,
        n(
          'Specialty Crew Levels',
          'Critical care paramedic, registered nurse, nurse practitioner, physician assistant, physician.'
        )
      )
    },
    {
      id: 'specialtyProvider',
      label: 'Specialty Care Provider Named',
      reason: 'The report names the specialty care provider',
      holds: isIn(
        g,
        'specialtyProvider',
        n('Specialty Care Provider Named', 'The SCT provider, NEMSIS ePayment.42.'),
        KIND.sctProvider,
        'payment.sctProvider',
        codes(
          g,
          'specialtyProviders',
          n('Specialty Providers', 'Nurse, NP, physician, PA, critical care paramedic, RN.'),
          KIND.sctProvider,
          SPECIALTY_PROVIDERS
        )
      )
    }
  ]);
};

const interfacility = (g: Builder) =>
  isIn(
    g,
    'interfacility',
    n('Between Facilities', 'CMS pays SCT only between facilities.'),
    KIND.service,
    'trip.serviceType',
    codes(
      g,
      'interfacilityCodes',
      n('Interfacility Services', 'Hospital and facility transfers.'),
      KIND.service,
      INTERFACILITY
    )
  );

const sctCriteria = (): GraphDef => {
  const g = rule(
    [
      ENCOUNTER_IN,
      flagIn('specialtyCrew', 'Specialty Crew', 'Whether a specialty crew was on the trip.')
    ],
    CRITERIA_OUT
  );
  breakEncounter(g);
  breakPayment(g);
  const between = interfacility(g);
  return criteriaResult(g, 'SCT', [
    {
      id: 'criticalCare',
      label: 'Critical Care Between Facilities',
      reason: 'Critical care by a specialty crew on an interfacility transport',
      holds: allOf(
        g,
        'criticalCare',
        n('Critical Care Between Facilities', 'All three together.'),
        [
          between,
          'entry.specialtyCrew',
          isCode(
            g,
            'critical',
            n('Critical Care Given', 'The level of care, NEMSIS eDisposition.32.'),
            KIND.levelOfCare,
            'trip.levelOfCare',
            '4232009'
          )
        ]
      )
    },
    {
      id: 'reportedSct',
      label: 'Specialty Care Reported Between Facilities',
      reason: 'Specialty care reported by a specialty crew on an interfacility transport',
      holds: allOf(
        g,
        'reportedSct',
        n(
          'Specialty Care Reported',
          'The crew’s SCT counts only with a specialty crew between facilities.'
        ),
        [
          between,
          'entry.specialtyCrew',
          isCode(
            g,
            'crewSct',
            n('Crew Reported SCT', 'The service level, NEMSIS ePayment.50.'),
            KIND.cmsServiceLevel,
            'payment.serviceLevel',
            '2650015'
          )
        ]
      )
    }
  ]);
};

const ALS_CREW_IN = flagIn('alsCrew', 'ALS Crew', 'Whether the unit or a crew member was ALS.');

const als2Criteria = (): GraphDef => {
  const g = rule(
    [
      ALS_CREW_IN,
      countIn('als2Procedures', 'ALS2 Procedures', 'How many ALS2 procedures this unit performed.'),
      countIn(
        'ivMedications',
        'IV Medications',
        'How many IV or IO medications, not solutions, this unit gave.'
      )
    ],
    CRITERIA_OUT
  );
  return criteriaResult(g, 'ALS2', [
    {
      id: 'procedureCoded',
      label: 'ALS2 Procedure Coded',
      reason: 'An ALS2 procedure by an ALS crew is coded',
      holds: allOf(
        g,
        'procedureCoded',
        n('ALS2 Procedure by an ALS Crew', 'One procedure is enough.'),
        [
          'entry.alsCrew',
          atLeast(
            g,
            'procedure',
            n('At Least One ALS2 Procedure', 'Counted per procedure.'),
            'integer',
            'entry.als2Procedures',
            1
          )
        ]
      )
    },
    {
      id: 'threeMedications',
      label: 'Three IV Medications',
      reason: 'Three or more IV or IO medication administrations by an ALS crew are coded',
      holds: allOf(
        g,
        'threeMedications',
        n('Three IV Medications by an ALS Crew', 'CMS counts each administration.'),
        [
          'entry.alsCrew',
          atLeast(
            g,
            'three',
            n('At Least Three', 'Three separate administrations.'),
            'integer',
            'entry.ivMedications',
            3
          )
        ]
      )
    }
  ]);
};

const als1Criteria = (): GraphDef => {
  const g = rule(
    [
      ENCOUNTER_IN,
      ALS_CREW_IN,
      flagIn('emergency', 'Emergency', 'Whether the response was an emergency.'),
      countIn('alsMedications', 'ALS Medications', 'How many ALS medications this unit gave.'),
      countIn('alsProcedures', 'ALS Procedures', 'How many ALS interventions this unit performed.'),
      countIn('ecgReadings', 'ECG Readings', 'How many rhythms or ECGs this unit read.')
    ],
    CRITERIA_OUT
  );
  breakEncounter(g);
  breakPayment(g);
  const any = (id: string, label: string, port: Port) =>
    atLeast(g, id, n(label, 'Counted per item.'), 'integer', port, 1);
  return criteriaResult(g, 'ALS1', [
    {
      id: 'intervention',
      label: 'ALS Intervention',
      reason: 'An ALS medication or procedure by an ALS crew is coded',
      holds: allOf(
        g,
        'intervention',
        n('ALS Intervention by an ALS Crew', 'Counts on any trip, emergency or not.'),
        [
          'entry.alsCrew',
          anyOf(
            g,
            'anyIntervention',
            n('Any ALS Medication or Procedure', 'Either one is enough.'),
            [
              any('medication', 'An ALS Medication', 'entry.alsMedications'),
              any('procedure', 'An ALS Procedure', 'entry.alsProcedures')
            ]
          )
        ]
      )
    },
    {
      id: 'assessment',
      label: 'ALS Assessment on an Emergency',
      reason: 'An ALS assessment by an ALS crew on an emergency response',
      holds: allOf(
        g,
        'assessment',
        n(
          'ALS Assessment on an Emergency',
          'CMS counts an ALS assessment only on an emergency response.'
        ),
        [
          'entry.alsCrew',
          'entry.emergency',
          anyOf(
            g,
            'assessed',
            n('ALS Assessment Documented', 'Reported, an ALS level of care, or an ECG read.'),
            [
              isCode(
                g,
                'alsAssessment',
                n('ALS Assessment Reported', 'NEMSIS ePayment.49.'),
                KIND.yesNo,
                'payment.alsAssessment',
                YES
              ),
              isIn(
                g,
                'alsCareLevel',
                n('ALS Level of Care', 'NEMSIS eDisposition.32.'),
                KIND.levelOfCare,
                'trip.levelOfCare',
                codes(
                  g,
                  'alsCareLevels',
                  n('ALS Levels of Care', 'ALS AEMT, ALS paramedic, critical care.'),
                  KIND.levelOfCare,
                  ALS_CARE
                )
              ),
              any('ecg', 'An ECG Read', 'entry.ecgReadings')
            ]
          )
        ]
      )
    }
  ]);
};

const reportedLevel = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'level',
        CODE.level,
        'Reported Level',
        'The ground level of service the crew reported, NEMSIS ePayment.50, or nothing.',
        true
      )
    ]
  );
  breakEncounter(g);
  breakPayment(g);
  const as = (id: string, label: string, values: string[], level: string) =>
    select(
      g,
      id,
      n(label, `Reported as ${level}.`),
      CODE.level,
      isIn(
        g,
        `${id}Codes`,
        n(`${label}: Codes`, 'The service level, NEMSIS ePayment.50.'),
        KIND.cmsServiceLevel,
        'payment.serviceLevel',
        codes(
          g,
          `${id}List`,
          n(`${label} Codes`, `Service levels meaning ${level}.`),
          KIND.cmsServiceLevel,
          values
        )
      ),
      fixed(level)
    );
  g.ret('return');
  g.wire(
    firstSet(g, 'level', n('Reported Level', 'Nothing for air or intercept levels.'), CODE.level, [
      as('sct', 'SCT Reported', ['2650015'], 'SCT'),
      as('als2', 'ALS2 Reported', ['2650005'], 'ALS2'),
      as('als1', 'ALS1 Reported', ['2650001', '2650003'], 'ALS1'),
      as('bls', 'BLS Reported', ['2650007', '2650009'], 'BLS')
    ]),
    'return.level'
  );
  return g.def;
};

const narrativeCare = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d('als2', 'boolean', 'ALS2 Mentioned', 'Whether the narrative mentions an ALS2 procedure.'),
      d('als2Phrases', listOf('string'), 'ALS2 Phrases', 'What it mentions.'),
      d('als', 'boolean', 'ALS Mentioned', 'Whether the narrative mentions ALS care.'),
      d('alsPhrases', listOf('string'), 'ALS Phrases', 'What it mentions.')
    ]
  );
  breakEncounter(g);
  const find = (id: string, label: string, list: Port) =>
    node(
      g,
      id,
      'std.text.find-phrases',
      n(label, 'Skips negated mentions, such as "no IV access".'),
      { text: 'trip.narrative', phrases: list }
    );
  find(
    'als2',
    'ALS2 Care in the Narrative',
    phraseList(
      g,
      'als2Words',
      n(
        'Words for ALS2 Procedures',
        'Intubation, cricothyrotomy, decompression, pacing, cardioversion, IO, central line.'
      ),
      ALS2_PHRASES
    )
  );
  find(
    'als',
    'ALS Care in the Narrative',
    phraseList(
      g,
      'alsWords',
      n('Words for ALS Care', 'IV access, ECG, advanced airways and ALS medications.'),
      ALS_PHRASES
    )
  );
  g.ret('return');
  g.wire('als2.found', 'return.als2');
  g.wire('als2.matches', 'return.als2Phrases');
  g.wire('als.found', 'return.als');
  g.wire('als.matches', 'return.alsPhrases');
  return g.def;
};

const levelOfService = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d('level', CODE.level, 'Level of Service', 'BLS, ALS1, ALS2 or SCT.'),
      reasonsOut('the level was chosen')
    ]
  );
  breakEncounter(g);
  const keep = (id: string, label: string, note: string, key: string, item: string, list: Port) =>
    keepWhere(g, id, n(label, note), key, item, list);
  keep(
    'ivDrugs',
    'IV Medications',
    'Each IV or IO medication, not a solution, this unit gave.',
    'billing.iv-medication',
    'medication',
    'trip.medications'
  );
  keep(
    'alsDrugs',
    'ALS Medications',
    'Each medication only an ALS crew may give.',
    'billing.als-medication',
    'medication',
    'trip.medications'
  );
  keep(
    'als2Done',
    'ALS2 Procedures',
    'Each ALS2 procedure this unit performed.',
    'billing.als2-procedure',
    'procedure',
    'trip.procedures'
  );
  keep(
    'alsDone',
    'ALS Procedures',
    'Each ALS intervention this unit performed.',
    'billing.als-procedure',
    'procedure',
    'trip.procedures'
  );
  keep(
    'ecgVitals',
    'ECG Readings',
    'Each set of vitals with a rhythm or ECG.',
    'billing.ecg-reading',
    'vital',
    'trip.vitals'
  );
  keep(
    'ecgDone',
    'ECG Procedures',
    'Each ECG or monitoring procedure this unit performed.',
    'billing.ecg-procedure',
    'procedure',
    'trip.procedures'
  );
  const sub = (id: string, key: string, label: string, note: string) => {
    g.add(id, key, { label, note });
    return id;
  };
  sub(
    'emergency',
    'billing.emergency-status',
    'Emergency Status',
    'An ALS assessment counts only on an emergency.'
  );
  sub(
    'alsCrew',
    'billing.als-crew-criteria',
    'ALS Crew Criteria',
    'Only an ALS crew can bill an ALS level.'
  );
  sub(
    'specialty',
    'billing.specialty-crew-criteria',
    'Specialty Crew Criteria',
    'Only a specialty crew can bill SCT.'
  );
  sub('sct', 'billing.sct-criteria', 'SCT Criteria', 'Specialty care between facilities.');
  sub(
    'als2',
    'billing.als2-criteria',
    'ALS2 Criteria',
    'An ALS2 procedure or three IV medications.'
  );
  sub(
    'als1',
    'billing.als1-criteria',
    'ALS1 Criteria',
    'An ALS intervention, or an ALS assessment on an emergency.'
  );
  sub(
    'reported',
    'billing.reported-level',
    'Reported Level',
    'What the crew reported, to compare.'
  );
  sub(
    'narrative',
    'billing.narrative-care',
    'Narrative Care',
    'ALS care the narrative mentions but nothing codes.'
  );
  g.wire(
    'entry.encounter',
    'emergency.encounter',
    'alsCrew.encounter',
    'specialty.encounter',
    'sct.encounter',
    'als1.encounter',
    'reported.encounter',
    'narrative.encounter'
  );
  g.wire('specialty.holds', 'sct.specialtyCrew');
  g.wire('alsCrew.holds', 'als2.alsCrew', 'als1.alsCrew');
  g.wire('als2Done.count', 'als2.als2Procedures');
  g.wire('ivDrugs.count', 'als2.ivMedications');
  g.wire('emergency.emergency', 'als1.emergency');
  g.wire('alsDrugs.count', 'als1.alsMedications');
  g.wire('alsDone.count', 'als1.alsProcedures');
  node(g, 'ecgCount', 'std.math.add', n('ECGs Read', 'Readings in vitals and ECG procedures.'), {
    a: 'ecgVitals.count',
    b: 'ecgDone.count'
  });
  g.wire('ecgCount.result', 'als1.ecgReadings');
  const as = (id: string, level: string, when: Port) =>
    select(
      g,
      id,
      n(`${level} When It Holds`, `The level is ${level} when its criteria hold.`),
      CODE.level,
      when,
      fixed(level)
    );
  const level = firstSet(
    g,
    'level',
    n('Highest Level That Holds, Else BLS', 'Checked from SCT down.'),
    CODE.level,
    [
      as('asSCT', 'SCT', 'sct.holds'),
      as('asALS2', 'ALS2', 'als2.holds'),
      as('asALS1', 'ALS1', 'als1.holds'),
      fixed('BLS')
    ]
  );
  const isLevel = (id: string, label: string, values: string[]) =>
    isIn(
      g,
      id,
      n(label, 'The level chosen.'),
      'levelOfService',
      level,
      codes(
        g,
        `${id}Levels`,
        n(`${label}: Levels`, 'Levels this test matches.'),
        'levelOfService',
        values
      )
    );
  const isBls = isLevel('isBls', 'Billed BLS', ['BLS']);
  const belowAls2 = isLevel('belowAls2', 'Billed Below ALS2', ['BLS', 'ALS1']);
  const alsCare = anyOf(
    g,
    'alsCareCoded',
    n('ALS Care Coded', 'Any ALS medication or procedure.'),
    [
      atLeast(
        g,
        'alsDrugGiven',
        n('An ALS Medication', 'Counted per medication.'),
        'integer',
        'alsDrugs.count',
        1
      ),
      atLeast(
        g,
        'alsProcedureDone',
        n('An ALS Procedure', 'Counted per procedure.'),
        'integer',
        'alsDone.count',
        1
      ),
      atLeast(
        g,
        'als2ProcedureDone',
        n('An ALS2 Procedure', 'Counted per procedure.'),
        'integer',
        'als2Done.count',
        1
      )
    ]
  );
  const reportedKnown = not(
    g,
    'reportedKnown',
    n('Crew Reported a Level', 'The crew’s level is only compared when given.'),
    isMissing(g, 'reportedMissing', n('No Reported Level', 'The crew gave none.'), 'reported.level')
  );
  const differs = node(
    g,
    'differs',
    'std.logic.not-equal',
    n('Reported Level Differs', 'The crew’s level is not the one billed.'),
    { a: 'reported.level', b: level },
    { type: CODE.level }
  );
  const flags: Criterion[] = [
    {
      id: 'noAlsCrew',
      label: 'ALS Care Without an ALS Crew',
      reason:
        'ALS care is coded, but neither the unit nor any crew member is ALS: billed BLS, confirm the crew',
      holds: allOf(
        g,
        'noAlsCrew',
        n('ALS Care Without an ALS Crew', 'A BLS crew cannot bill ALS.'),
        [
          alsCare,
          not(g, 'notAlsCrew', n('No ALS Crew', 'Neither the unit nor the crew.'), 'alsCrew.holds')
        ]
      )
    },
    {
      id: 'narrativeAls2',
      label: 'Narrative Mentions ALS2 Care',
      reason: 'The narrative mentions an ALS2 procedure that is not coded: confirm the level',
      holds: allOf(
        g,
        'narrativeAls2',
        n('Narrative Mentions ALS2 Care', 'Mentioned but billed below ALS2.'),
        ['narrative.als2', belowAls2]
      )
    },
    {
      id: 'narrativeAls',
      label: 'Narrative Mentions ALS Care',
      reason: 'The narrative mentions ALS care that is not coded: confirm the level',
      holds: allOf(
        g,
        'narrativeAls',
        n('Narrative Mentions ALS Care', 'Mentioned but billed BLS.'),
        ['narrative.als', isBls]
      )
    },
    {
      id: 'blsOnly',
      label: 'No ALS Care Documented',
      reason: 'No ALS care or assessment by an ALS crew is documented: billed BLS',
      holds: isBls
    }
  ];
  const mismatch = select(
    g,
    'mismatch',
    n('Reported Level Mismatch', 'Billed on what is documented; the biller confirms.'),
    'string',
    allOf(g, 'mismatched', n('Crew Reported Another Level', 'Given and different.'), [
      reportedKnown,
      pinOf(differs, 'result')
    ]),
    template(
      g,
      'mismatchText',
      n('Mismatch Reason', 'Names both levels.'),
      'The crew reported {reported}, but the documented care supports {level}: billed {level}, confirm the level',
      { reported: 'reported.level', level }
    )
  );
  g.ret('return');
  g.wire(level, 'return.level');
  g.wire(
    joinLists(g, 'reasons', n('Level Reasons', 'Why this level, and what to confirm.'), 'string', [
      'sct.reasons',
      'als2.reasons',
      'als1.reasons',
      reasonsOf(
        g,
        'flags',
        n('Level Flags', 'What a biller should confirm about the level.'),
        flags
      ),
      makeList(
        g,
        'mismatchReason',
        n('Mismatch Reason', 'Left out when the levels agree.'),
        'string',
        [mismatch]
      )
    ]),
    'return.reasons'
  );
  return g.def;
};

const emergencyStatus = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d('emergency', 'boolean', 'Emergency', 'Whether the response was an emergency.'),
      reasonsOut('the response is or is not an emergency')
    ]
  );
  breakEncounter(g);
  breakPayment(g);
  const decide = (
    id: string,
    label: string,
    note: string,
    when: Port,
    value: boolean,
    reason: string
  ) => ({
    value: select(g, `${id}Value`, n(label, note), 'boolean', when, fixed(value)),
    reason: select(
      g,
      `${id}Reason`,
      n(`${label}: Reason`, 'Says what decided.'),
      'string',
      when,
      fixed(reason)
    )
  });
  const steps = [
    decide(
      'immediate',
      'Immediate Urgency',
      'The response urgency decides first, NEMSIS ePayment.40.',
      isCode(
        g,
        'urgent',
        n('Urgency Immediate', 'Immediate response urgency.'),
        KIND.responseUrgency,
        'payment.responseUrgency',
        '2640001'
      ),
      true,
      'Emergency: the crew reported an immediate response urgency'
    ),
    decide(
      'nonImmediate',
      'Non-Immediate Urgency',
      'A non-immediate urgency means no emergency.',
      isCode(
        g,
        'notUrgent',
        n('Urgency Non-Immediate', 'Non-immediate response urgency.'),
        KIND.responseUrgency,
        'payment.responseUrgency',
        '2640003'
      ),
      false,
      'Not an emergency: the crew reported a non-immediate response urgency'
    ),
    decide(
      'emergentMode',
      'Emergent Response',
      'Then the response mode, NEMSIS eResponse.23: CMS goes by how the unit was dispatched.',
      isIn(
        g,
        'emergent',
        n('Responded Emergent', 'Emergent, or emergent at dispatch.'),
        KIND.responseMode,
        'trip.responseMode',
        codes(
          g,
          'emergentModes',
          n('Emergent Response Modes', 'Emergent, downgraded after dispatch, upgraded.'),
          KIND.responseMode,
          EMERGENT_MODES
        )
      ),
      true,
      'Emergency: the unit responded emergent'
    ),
    decide(
      'routineMode',
      'Non-Emergent Response',
      'A non-emergent response mode means no emergency.',
      isCode(
        g,
        'routine',
        n('Responded Non-Emergent', 'Non-emergent response mode.'),
        KIND.responseMode,
        'trip.responseMode',
        '2223005'
      ),
      false,
      'Not an emergency: the unit responded non-emergent'
    ),
    decide(
      'lights',
      'Lights Used',
      'Then the response modifiers, NEMSIS eResponse.24.',
      containsAny(
        g,
        'withLights',
        n('Responded with Lights', 'Lights, with or without sirens, at dispatch.'),
        KIND.responseModifier,
        'trip.responseModifiers',
        LIGHTS,
        n('Lights Modifiers', 'Lights and sirens, lights only, upgraded or downgraded.')
      ),
      true,
      'Emergency: the unit responded with lights'
    ),
    decide(
      'quiet',
      'No Lights Used',
      'No lights or a scheduled response means no emergency.',
      containsAny(
        g,
        'withoutLights',
        n('Responded Without Lights', 'No lights or sirens, or scheduled.'),
        KIND.responseModifier,
        'trip.responseModifiers',
        QUIET,
        n('Quiet Modifiers', 'Scheduled, or no lights or sirens.')
      ),
      false,
      'Not an emergency: the unit responded without lights'
    ),
    decide(
      'call',
      'Emergency Call',
      'Last the type of service, which NEMSIS requires, so this always decides.',
      isIn(
        g,
        'emergencyCall',
        n('Emergency Call', 'A 911 response, intercept or mutual aid.'),
        KIND.service,
        'trip.serviceType',
        codes(
          g,
          'emergencyServices',
          n('Emergency Services', '911 response, intercept, mutual aid.'),
          KIND.service,
          SERVICE_TYPES.emergency
        )
      ),
      true,
      'Emergency: an emergency call, and nothing else in the report says how the unit responded'
    )
  ];
  const emergency = firstSet(
    g,
    'emergency',
    n('First That Decides', 'In order; else not an emergency.'),
    'boolean',
    [...steps.map((s) => s.value), fixed(false)]
  );
  const reason = firstSet(
    g,
    'reason',
    n('What Decided', 'The reason of the first that decided.'),
    'string',
    [
      ...steps.map((s) => s.reason),
      fixed(
        'Not an emergency: a scheduled or interfacility call, and nothing else in the report says how the unit responded'
      )
    ]
  );
  const crewSays = (id: string, label: string, values: string[]) =>
    isIn(
      g,
      id,
      n(label, 'The service level the crew reported, NEMSIS ePayment.50.'),
      KIND.cmsServiceLevel,
      'payment.serviceLevel',
      codes(
        g,
        `${id}Levels`,
        n(`${label}: Levels`, 'Service levels meaning this.'),
        KIND.cmsServiceLevel,
        values
      )
    );
  const mismatch = select(
    g,
    'mismatch',
    n('Crew Disagrees', 'The crew’s level says the opposite; a biller confirms.'),
    'string',
    anyOf(g, 'disagrees', n('Crew Level Disagrees', 'Either way round.'), [
      allOf(g, 'saysEmergency', n('Crew Says Emergency', 'But billed as not.'), [
        crewSays('crewEmergency', 'Crew Reported Emergency', ['2650003', '2650009']),
        not(g, 'notEmergency', n('Not an Emergency', 'As decided.'), emergency)
      ]),
      allOf(g, 'saysRoutine', n('Crew Says Not an Emergency', 'But billed as one.'), [
        crewSays('crewRoutine', 'Crew Reported Non-Emergency', ['2650001', '2650007']),
        emergency
      ])
    ]),
    fixed(
      'The crew reported a service level that disagrees with how the unit responded: confirm whether it was an emergency'
    )
  );
  g.ret('return');
  g.wire(emergency, 'return.emergency');
  g.wire(
    makeList(
      g,
      'reasons',
      n('Emergency Reasons', 'What decided, and any disagreement.'),
      'string',
      [reason, mismatch]
    ),
    'return.reasons'
  );
  return g.def;
};

const MILES_PATTERNS = [
  '(\\d{1,3}(?:\\.\\d+)?)\\s*loaded\\s*(?:mi|miles)\\b',
  'loaded\\s*(?:mi|miles)\\D{0,10}(\\d{1,3}(?:\\.\\d+)?)',
  'transport(?:ed)?\\s*(?:mileage|miles)\\D{0,10}(\\d{1,3}(?:\\.\\d+)?)'
];

const LONG_TRIP = 250;

const loadedMiles = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'loadedMiles',
        'number',
        'Loaded Miles',
        'Miles with the patient on board, from the odometer, else the narrative, rounded up as CMS asks: to the tenth under 100 miles, to the whole mile from 100; nothing when neither gives them.',
        true
      ),
      reasonsOut('the miles came from where they did')
    ]
  );
  breakEncounter(g);
  breakRecord(
    g,
    'odometer',
    n('Odometer', 'The readings at the scene and destination.'),
    ODOMETER,
    'trip.odometer'
  );
  node(
    g,
    'distance',
    'std.math.subtract',
    n('Destination Minus Scene', 'Nothing when a reading is missing.'),
    {
      a: 'odometer.destination',
      b: 'odometer.scene'
    }
  );
  const odometerOk = node(
    g,
    'odometerOk',
    'std.logic.greater',
    n('Odometer Shows Miles', 'More than zero; zero or less means a bad reading.'),
    {
      a: orZero(
        g,
        'distanceOrZero',
        n('Distance or 0', 'Treats a missing distance as 0.'),
        'distance.result'
      ),
      b: fixed(0)
    },
    { type: 'number' }
  );
  const fromOdometer = select(
    g,
    'fromOdometer',
    n('Odometer Miles', 'When the odometer shows miles.'),
    'number',
    pinOf(odometerOk, 'result'),
    'distance.result'
  );
  const fromNarrative = MILES_PATTERNS.map((pattern, i) => {
    const id = `pattern${i + 1}`;
    node(
      g,
      id,
      'std.text.find-pattern',
      n(
        `Miles in the Narrative ${i + 1}`,
        'Finds miles the crew wrote, such as "12.4 loaded miles".'
      ),
      {
        text: 'trip.narrative',
        pattern: fixed(pattern)
      }
    );
    node(
      g,
      `${id}First`,
      'std.list.first',
      n(`Miles Text ${i + 1}`, 'The number the pattern found.'),
      { list: `${id}.parts` },
      { type: 'string' }
    );
    node(
      g,
      `${id}Number`,
      'std.convert.to-number',
      n(`Miles ${i + 1}`, 'Reads the text as a number.'),
      { value: `${id}First.item` }
    );
    return `${id}Number.number` as Port;
  });
  const narrativeMiles = firstSet(
    g,
    'narrativeMiles',
    n('Narrative Miles', 'The first pattern that finds miles.'),
    'number',
    fromNarrative
  );
  const miles = firstSet(
    g,
    'miles',
    n('Odometer, Else Narrative', 'The odometer is trusted first.'),
    'number',
    [fromOdometer, narrativeMiles]
  );
  const roundUp = (id: string, label: string, digits: number) =>
    node(
      g,
      id,
      'std.math.round',
      n(label, 'Rounds up, as CMS asks.'),
      { value: miles, digits: fixed(digits) },
      { direction: 'up' }
    );
  roundUp('tenth', 'Up to the Tenth', 1);
  roundUp('whole', 'Up to the Whole Mile', 0);
  const milesOrZero = orZero(
    g,
    'milesOrZero',
    n('Miles or 0', 'Treats missing miles as 0 for the tests.'),
    miles
  );
  const long = atLeast(
    g,
    'long',
    n('100 Miles or More', 'CMS rounds whole miles from 100.'),
    'number',
    milesOrZero,
    100
  );
  const odometerUsed = not(
    g,
    'odometerUsed',
    n('From the Odometer', 'The odometer gave the miles.'),
    isMissing(g, 'noOdometer', n('No Odometer Miles', 'The odometer gave none.'), fromOdometer)
  );
  const narrativeUsed = allOf(
    g,
    'narrativeUsed',
    n('From the Narrative', 'Only when the odometer gave none.'),
    [
      not(g, 'odometerNotUsed', n('Odometer Not Used', 'The odometer gave none.'), odometerUsed),
      not(
        g,
        'narrativeKnown',
        n('Narrative Gave Miles', 'A pattern found miles.'),
        isMissing(
          g,
          'noNarrative',
          n('No Narrative Miles', 'No pattern found miles.'),
          narrativeMiles
        )
      )
    ]
  );
  g.ret('return');
  g.wire(
    select(
      g,
      'rounded',
      n('Whole Miles from 100, Else Tenths', 'CMS rounding.'),
      'number',
      long,
      'whole.result',
      'tenth.result'
    ),
    'return.loadedMiles'
  );
  g.wire(
    reasonsOf(
      g,
      'reasons',
      n('Mileage Reasons', 'Where the miles came from, and what to confirm.'),
      [
        {
          id: 'narrative',
          label: 'Miles from the Narrative',
          reason:
            'Loaded miles come from the narrative because the odometer readings are missing: confirm them',
          holds: narrativeUsed
        },
        {
          id: 'long',
          label: 'Long Trip',
          reason: `More than ${LONG_TRIP} loaded miles: confirm the odometer readings`,
          holds: pinOf(
            node(
              g,
              'veryLong',
              'std.logic.greater',
              n('Very Long Trip', `More than ${LONG_TRIP} miles is unusual by ground.`),
              { a: milesOrZero, b: fixed(LONG_TRIP) },
              { type: 'number' }
            ),
            'result'
          )
        }
      ]
    ),
    'return.reasons'
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
        'The date of service as the crew’s clock read it: the day the crew reached the patient, else reached the scene, was notified or got the call.',
        true
      )
    ]
  );
  breakEncounter(g);
  breakRecord(g, 'times', n('Times', 'The times of the trip.'), TIMES, 'trip.times');
  const first = firstSet(
    g,
    'first',
    n('First Time Recorded', 'At patient, at scene, notified, call.'),
    'datetime',
    ['times.atPatient', 'times.atScene', 'times.unitNotified', 'times.call']
  );
  node(
    g,
    'day',
    'std.text.substring',
    n(
      'Day as Recorded',
      'The date part of the time, in the agency’s own time zone, so a late call keeps its day.'
    ),
    { text: first, start: fixed(0), end: fixed(10) }
  );
  g.ret('return');
  g.wire('day.result', 'return.serviceDate');
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
        'Miles with the patient on board, when known.',
        true
      ),
      reasonsOut('the service was decided this way')
    ]
  );
  const sub = (id: string, key: string, label: string, note: string) =>
    g.add(id, key, { label, note });
  sub('date', 'billing.service-date', 'Service Date', 'The day of service.');
  sub(
    'level',
    'billing.level-of-service',
    'Level of Service',
    'BLS, ALS1, ALS2 or SCT from the care documented.'
  );
  sub(
    'emergency',
    'billing.emergency-status',
    'Emergency Status',
    'Whether the response was an emergency.'
  );
  sub('miles', 'billing.loaded-miles', 'Loaded Miles', 'Miles with the patient on board.');
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
    joinLists(
      g,
      'reasons',
      n('Service Reasons', 'Level, emergency and mileage reasons.'),
      'string',
      ['level.reasons', 'emergency.reasons', 'miles.reasons']
    ),
    'return.reasons'
  );
  return g.def;
};

const POUNDS_PER_KILOGRAM = 2.20462;

const CONDITION_LIMIT = 5;

const TRANSPORT_REASONS = codeTable(
  'billing.transport-reasons',
  'Transport Reasons',
  'The CR1 transport reason (A to E) each destination reason (NEMSIS eDisposition.20) means, used when the crew gave no transport reason. Closest facility is A, the patient’s physician B, the patient’s or family’s choice C, a specialty center D.',
  code('transportReason'),
  {
    '4220001': 'A',
    '4220017': 'B',
    '4220005': 'C',
    '4220015': 'C',
    '4220021': 'D'
  }
);

const HOSPITALS = ['4221003', '4221005', '4221023'];

const ambulanceDetails = (): GraphDef => {
  const condition = code('ambulanceCondition');
  const reasonCode = code('transportReason');
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'transportReason',
        reasonCode,
        'Transport Reason',
        'Why the patient went to this destination, A to E, for the ambulance transport information (CR1): as the crew gave it, else from the destination reason, else A for a hospital.',
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
      ),
      reasonsOut('the ambulance details are what they are')
    ]
  );
  breakEncounter(g);
  breakPayment(g);
  breakRecord(g, 'patient', n('Patient', 'The patient’s weight.'), PERSON, 'trip.patient');
  breakRecord(
    g,
    'destination',
    n('Destination', 'The kind of place the patient went.'),
    DESTINATION,
    'trip.destination'
  );
  node(
    g,
    'destinationReason',
    'std.list.first',
    n('Main Destination Reason', 'The first reason the crew gave, NEMSIS eDisposition.20.'),
    { list: 'trip.destinationReasons' },
    { type: code(KIND.destinationReason) }
  );
  lookup(
    g,
    'byDestination',
    n('Transport Reason by Destination Reason', 'From the Transport Reasons table.'),
    TRANSPORT_REASONS,
    'destinationReason.item'
  );
  const toHospital = isIn(
    g,
    'toHospital',
    n('Taken to a Hospital', 'The destination type, NEMSIS eDisposition.21.'),
    KIND.destinationType,
    'destination.type',
    codes(
      g,
      'hospitals',
      n('Hospital Destinations', 'Emergency department, hospital bed, freestanding ED.'),
      KIND.destinationType,
      HOSPITALS
    )
  );
  const reported = 'payment.transportReason' as const;
  const reason = firstSet(
    g,
    'transportReason',
    n(
      'Reported, Else Derived',
      'The crew’s reason, the destination reason, then A for a hospital.'
    ),
    reasonCode,
    [
      reported,
      'byDestination.value',
      select(
        g,
        'nearest',
        n('Nearest Hospital', 'A hospital without another reason is A, the nearest facility.'),
        reasonCode,
        toHospital,
        fixed('A')
      )
    ]
  );
  const reportedMissing = isMissing(
    g,
    'reportedMissing',
    n('Crew Gave No Reason', 'NEMSIS ePayment.44 is empty.'),
    reported
  );
  const config = { type: condition };
  node(
    g,
    'once',
    'std.list.unique',
    n('Each Once', 'Leaves out repeated conditions.'),
    { list: 'payment.ambulanceConditions' },
    config
  );
  node(
    g,
    'five',
    'std.list.slice',
    n('At Most Five', 'The claim takes five condition codes.'),
    { list: 'once.list', start: fixed(0), end: fixed(CONDITION_LIMIT) },
    config
  );
  node(g, 'pounds', 'std.math.multiply', n('Kilograms to Pounds', 'The claim takes pounds.'), {
    a: 'patient.weightKg',
    b: fixed(POUNDS_PER_KILOGRAM)
  });
  node(
    g,
    'wholePounds',
    'std.math.round',
    n('Up to the Whole Pound', 'Rounds up.'),
    { value: 'pounds.result', digits: fixed(0) },
    { direction: 'up' }
  );
  g.ret('return');
  g.wire(reason, 'return.transportReason');
  g.wire('five.list', 'return.conditionCodes');
  g.wire('wholePounds.result', 'return.weightPounds');
  g.wire(
    reasonsOf(g, 'reasons', n('Ambulance Reasons', 'What a biller should confirm.'), [
      {
        id: 'derived',
        label: 'Transport Reason Derived',
        reason:
          'The crew gave no transport reason; it comes from the destination reason or a hospital destination: confirm it',
        holds: allOf(g, 'derived', n('Transport Reason Derived', 'Not reported, but derived.'), [
          reportedMissing,
          not(
            g,
            'derivedKnown',
            n('Derived a Reason', 'A reason was found.'),
            isMissing(g, 'noReason', n('No Reason at All', 'Nothing found.'), reason)
          )
        ])
      }
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
        'The primary impression, then the secondary impressions, the primary symptom and the other symptoms, each once and at most twelve.'
      )
    ]
  );
  breakEncounter(g);
  const all = joinLists(
    g,
    'all',
    n('Impressions, Then Symptoms', 'In the order a claim lists them.'),
    icd10,
    [
      makeList(g, 'primary', n('Primary Impression', 'NEMSIS eSituation.11.'), icd10, [
        'trip.primaryImpression'
      ]),
      'trip.secondaryImpressions',
      makeList(g, 'symptom', n('Primary Symptom', 'NEMSIS eSituation.09.'), icd10, [
        'trip.primarySymptom'
      ]),
      'trip.otherSymptoms'
    ]
  );
  const config = { type: icd10 };
  node(
    g,
    'once',
    'std.list.unique',
    n('Each Once', 'Leaves out repeated codes.'),
    { list: all },
    config
  );
  node(
    g,
    'twelve',
    'std.list.slice',
    n('At Most Twelve', 'A claim takes twelve diagnoses.'),
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
    'Whether this unit gave a medication IV or IO that is not an IV solution, as CMS counts for ALS2.',
    ivMedication()
  ),
  asRule(
    'billing.als-medication',
    'ALS Medication',
    'Whether this unit gave a medication only an ALS crew may: by IV or IO, or one beyond the EMT list. An ALS intervention for ALS1.',
    alsMedication()
  ),
  asRule(
    'billing.als2-procedure',
    'ALS2 Procedure',
    'Whether this unit performed a procedure CMS names for ALS2: manual defibrillation or cardioversion, intubation, a central line, pacing, chest decompression, a surgical airway or an IO line.',
    procedureRule(
      'ALS2 Procedures',
      'Defibrillation, cardioversion, intubation, central line, pacing, decompression, surgical airway, IO.',
      ALS2_PROCEDURES,
      'one CMS names for ALS2'
    )
  ),
  asRule(
    'billing.als-procedure',
    'ALS Procedure',
    'Whether this unit performed an ALS intervention: IV access or fluids, an advanced airway, a gastric tube, ventilator care, a vagal maneuver or a transfusion.',
    procedureRule(
      'ALS Procedures',
      'IV access and fluids, supraglottic and laryngeal airways, gastric tubes, ventilators, vagal maneuvers, transfusion.',
      ALS_PROCEDURES,
      'an ALS intervention'
    )
  ),
  asRule(
    'billing.ecg-procedure',
    'ECG Procedure',
    'Whether this unit performed cardiac monitoring or an ECG, part of an ALS assessment.',
    procedureRule(
      'ECG Procedures',
      '12 lead, 3 lead, cardiac and ECG monitoring.',
      ECG_PROCEDURES,
      'cardiac monitoring or an ECG'
    )
  ),
  asRule(
    'billing.ecg-reading',
    'ECG Reading',
    'Whether this unit read a cardiac rhythm or an ECG in a set of vital signs, part of an ALS assessment.',
    ecgReading()
  ),
  asRule(
    'billing.als-crew-criteria',
    'ALS Crew Criteria',
    'Holds when the trip had an ALS crew: an ALS unit level (required in NEMSIS), an ALS crew member, or ALS care reported.',
    alsCrewCriteria()
  ),
  asRule(
    'billing.specialty-crew-criteria',
    'Specialty Crew Criteria',
    'Holds when the trip had a crew beyond a paramedic, as SCT needs: a specialty unit, a crew member such as a critical care paramedic or nurse, or a named specialty provider.',
    specialtyCrewCriteria()
  ),
  asRule(
    'billing.sct-criteria',
    'SCT Criteria',
    'Holds when a specialty crew gave or reported critical care on an interfacility transport.',
    sctCriteria()
  ),
  asRule(
    'billing.als2-criteria',
    'ALS2 Criteria',
    'Holds when an ALS crew performed an ALS2 procedure, or gave three or more IV or IO medications that are not solutions.',
    als2Criteria()
  ),
  asRule(
    'billing.als1-criteria',
    'ALS1 Criteria',
    'Holds when an ALS crew gave an ALS medication or performed an ALS procedure, or on an emergency response made an ALS assessment (reported, an ALS level of care, or an ECG read).',
    als1Criteria()
  ),
  asRule(
    'billing.reported-level',
    'Reported Level',
    'The ground level of service the crew reported (NEMSIS ePayment.50), to compare with the level the care supports; agencies do not always report it.',
    reportedLevel()
  ),
  asRule(
    'billing.narrative-care',
    'Narrative Care',
    'Finds ALS2 procedures and ALS care the narrative mentions, skipping negated mentions, so a biller can confirm care the report did not code.',
    narrativeCare()
  ),
  asRule(
    'billing.level-of-service',
    'Level of Service',
    'The highest level the documented care supports: SCT, ALS2, ALS1, else BLS. Only coded care this unit gave counts, and only with an ALS crew; the crew’s reported level and the narrative never raise the level, they only flag it for a biller.',
    levelOfService()
  ),
  asRule(
    'billing.emergency-status',
    'Emergency Status',
    'Whether the response was an emergency, from the first that decides: the response urgency, the response mode, the lights used, else the type of service. Flags a reported service level that disagrees.',
    emergencyStatus()
  ),
  asRule(
    'billing.loaded-miles',
    'Loaded Miles',
    'Miles with the patient on board from the scene and destination odometer readings, else what the narrative says, rounded up as CMS asks. Flags miles from the narrative and very long trips.',
    loadedMiles()
  ),
  asRule(
    'billing.service-date',
    'Service Date',
    'The date of service as the crew recorded it, from the first time recorded: at patient, at scene, notified, then the call.',
    serviceDate()
  ),
  asRule(
    'billing.service-details',
    'Service Details',
    'The service date, level of service, emergency status and loaded miles of a trip, with their reasons.',
    serviceDetails()
  ),
  asRule(
    'billing.ambulance-details',
    'Ambulance Details',
    'The transport reason (as reported, else from the destination reason, else A for a hospital), condition codes and weight in pounds for the CR1 and CRC segments of the claim.',
    ambulanceDetails()
  ),
  asRule(
    'billing.diagnoses',
    'Diagnoses',
    'The diagnoses the report gives: the impressions, then the symptoms, each once, at most twelve.',
    diagnoses()
  )
];
