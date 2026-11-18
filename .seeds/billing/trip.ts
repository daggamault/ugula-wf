import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  ADDRESS,
  allOf,
  anyOf,
  asRule,
  atLeast,
  type Builder,
  breakRecord,
  CODE,
  CRITERIA_OUT,
  codes,
  criteriaResult,
  DESTINATION,
  d,
  ENCOUNTER,
  firstSet,
  fixed,
  INTERFACILITY,
  isCode,
  isIn,
  isMissing,
  joinLists,
  listOf,
  n,
  node,
  not,
  ODOMETER,
  orZero,
  type Port,
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
  crew: 'crewDisposition',
  arrestOutcome: 'arrestOutcome',
  resuscitation: 'resuscitation',
  stopped: 'resuscitationStopped',
  service: 'serviceType'
} as const;

const TRANSPORTED = ['4230001', '4230003'];

const NOT_TRANSPORTED = ['4230005', '4230007', '4230009', '4230013'];

const TRANSPORTED_INCIDENTS = ['4212013', '4212017', '4212023', '4212033'];

const NOT_TRANSPORTED_INCIDENTS = [
  '4212015',
  '4212019',
  '4212021',
  '4212025',
  '4212027',
  '4212029',
  '4212031',
  '4212035',
  '4212037'
];

const NO_PATIENT_UNIT = ['4227003', '4227005', '4227007', '4227009', '4227011'];

const NO_PATIENT_INCIDENTS = [
  '4212001',
  '4212003',
  '4212005',
  '4212007',
  '4212009',
  '4212011',
  '4212039',
  '4212041',
  '4212043'
];

const NO_CARE_CREW = ['4229009', '4229011'];

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

const DEATH_PHRASES = [
  'pronounced',
  'pronouncement',
  'obvious death',
  'obvious signs of death',
  'incompatible with life',
  'rigor mortis',
  'rigor',
  'dependent lividity',
  'lividity',
  'decomposition',
  'dead on arrival',
  'DOA',
  'time of death',
  'resuscitation not attempted',
  'efforts terminated',
  'resuscitation terminated'
];

const BILLABLE = ['emergency', 'scheduled', 'pronouncedDead', 'treatNoTransport', 'refusal'];

const pinOf = (id: string, pin: string): Port => `${id}.${pin}`;

const breakTrip = (g: Builder) =>
  breakRecord(
    g,
    'trip',
    n('Encounter', 'Splits the encounter into the fields these tests read.'),
    ENCOUNTER,
    'entry.encounter'
  );

const isKnown = (g: Builder, id: string, label: string, value: Port) =>
  not(
    g,
    id,
    n(label, 'Holds when the report gives a value, not a not value or nothing.'),
    isMissing(g, `${id}Missing`, n(`${label}: Missing`, 'Holds when the value is empty.'), value)
  );

const noPatientCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  return criteriaResult(g, 'No Patient', [
    {
      id: 'unitNoPatient',
      label: 'Unit Had No Patient',
      reason: 'The unit was cancelled or had no patient (unit disposition)',
      holds: isIn(
        g,
        'unitNoPatient',
        n(
          'Unit Had No Patient',
          'NEMSIS 3.5 requires the unit disposition, so this is the surest sign of no patient.'
        ),
        KIND.unit,
        'trip.unitDisposition',
        codes(
          g,
          'noPatientUnit',
          n(
            'No Patient Unit Dispositions',
            'Cancelled on scene or before arrival, no patient contact, no patient found, or a non-patient incident.'
          ),
          KIND.unit,
          NO_PATIENT_UNIT
        )
      )
    },
    {
      id: 'incidentNoPatient',
      label: 'Incident Had No Patient',
      reason: 'The incident was cancelled, an assist, a standby or a non-patient transport',
      holds: isIn(
        g,
        'incidentNoPatient',
        n('Incident Had No Patient', 'The NEMSIS 3.4 incident disposition says so.'),
        KIND.incident,
        'trip.incidentDisposition',
        codes(
          g,
          'noPatientIncidents',
          n(
            'No Patient Incident Dispositions',
            'Assists, cancellations, standbys and non-patient transports in NEMSIS 3.4.'
          ),
          KIND.incident,
          NO_PATIENT_INCIDENTS
        )
      )
    },
    {
      id: 'nonPatientTransport',
      label: 'Non-Patient Transport',
      reason: 'The unit transported something other than a patient',
      holds: isCode(
        g,
        'nonPatientTransport',
        n('Non-Patient Transport', 'The transport disposition is a non-patient transport.'),
        KIND.transport,
        'trip.transportDisposition',
        '4230011'
      )
    },
    {
      id: 'noCare',
      label: 'Crew Gave No Care',
      reason: 'The crew gave no patient care (standby or back in service without care)',
      holds: isIn(
        g,
        'noCare',
        n('Crew Gave No Care', 'The crew disposition says it stood by or needed to give no care.'),
        KIND.crew,
        'trip.crewDisposition',
        codes(
          g,
          'noCareCrew',
          n(
            'No Care Crew Dispositions',
            'Standby or support only, or back in service without care.'
          ),
          KIND.crew,
          NO_CARE_CREW
        )
      )
    }
  ]);
};

const transportedCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  return criteriaResult(g, 'Transported', [
    {
      id: 'transportDisposition',
      label: 'Transport Disposition Says Transported',
      reason: 'The report says this unit transported the patient (transport disposition)',
      holds: isIn(
        g,
        'transportDisposition',
        n('Transported by This Unit', 'The NEMSIS 3.5 transport disposition says this unit did.'),
        KIND.transport,
        'trip.transportDisposition',
        codes(
          g,
          'transportedCodes',
          n('Transported Dispositions', 'Transported by this unit, alone or with another crew.'),
          KIND.transport,
          TRANSPORTED
        )
      )
    },
    {
      id: 'incidentDisposition',
      label: 'Incident Disposition Says Transported',
      reason: 'The report says this unit transported the patient (incident disposition)',
      holds: isIn(
        g,
        'incidentDisposition',
        n('Incident Transported', 'The NEMSIS 3.4 incident disposition says this unit did.'),
        KIND.incident,
        'trip.incidentDisposition',
        codes(
          g,
          'transportedIncidents',
          n(
            'Transported Incident Dispositions',
            'Treated and transported, refused care but transported, or dead at the scene and transported.'
          ),
          KIND.incident,
          TRANSPORTED_INCIDENTS
        )
      )
    }
  ]);
};

const notTransportedCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  return criteriaResult(g, 'Not Transported', [
    {
      id: 'transportDisposition',
      label: 'Transport Disposition Says Not Transported',
      reason: 'The report says this unit did not transport the patient (transport disposition)',
      holds: isIn(
        g,
        'transportDisposition',
        n(
          'Not Transported by This Unit',
          'Transported by another unit, refused transport or no transport.'
        ),
        KIND.transport,
        'trip.transportDisposition',
        codes(
          g,
          'notTransportedCodes',
          n(
            'Not Transported Dispositions',
            'Every transport disposition but this unit transporting.'
          ),
          KIND.transport,
          NOT_TRANSPORTED
        )
      )
    },
    {
      id: 'incidentDisposition',
      label: 'Incident Disposition Says Not Transported',
      reason: 'The report says this unit did not transport the patient (incident disposition)',
      holds: isIn(
        g,
        'incidentDisposition',
        n('Incident Not Transported', 'The NEMSIS 3.4 incident disposition says no transport.'),
        KIND.incident,
        'trip.incidentDisposition',
        codes(
          g,
          'notTransportedIncidents',
          n(
            'Not Transported Incident Dispositions',
            'Dead at the scene, refused, released, or taken by another unit, police or private vehicle.'
          ),
          KIND.incident,
          NOT_TRANSPORTED_INCIDENTS
        )
      )
    },
    {
      id: 'handedOff',
      label: 'Crew Handed Off Care',
      reason: 'The crew started care and transferred the patient to another crew',
      holds: isCode(
        g,
        'handedOff',
        n('Crew Handed Off Care', 'The crew disposition says another crew took over.'),
        KIND.crew,
        'trip.crewDisposition',
        '4229003'
      )
    }
  ]);
};

const arrivalCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  breakRecord(g, 'times', n('Times', 'The times of the trip.'), TIMES, 'trip.times');
  breakRecord(
    g,
    'destination',
    n('Destination', 'Where the patient was taken, if anywhere.'),
    DESTINATION,
    'trip.destination'
  );
  breakRecord(
    g,
    'address',
    n('Destination Address', 'The street address of the destination.'),
    ADDRESS,
    'destination.address'
  );
  breakRecord(
    g,
    'odometer',
    n('Odometer', 'The odometer readings of the trip.'),
    ODOMETER,
    'trip.odometer'
  );
  const named = anyOf(
    g,
    'destinationNamed',
    n('Destination Named', 'Any one of its name, type or street.'),
    [
      isKnown(g, 'hasName', 'Destination Name Given', 'destination.name'),
      isKnown(g, 'hasType', 'Destination Type Given', 'destination.type'),
      isKnown(g, 'hasStreet', 'Destination Street Given', 'address.line')
    ]
  );
  return criteriaResult(g, 'Arrival', [
    {
      id: 'arrived',
      label: 'Arrived at a Named Destination',
      reason: 'The report has an arrival time at a named destination',
      holds: allOf(
        g,
        'arrived',
        n(
          'Arrived at a Named Destination',
          'An arrival time and a destination together mean the unit took the patient there.'
        ),
        [isKnown(g, 'hasArrival', 'Arrival Time Given', 'times.atDestination'), named]
      )
    },
    {
      id: 'drove',
      label: 'Odometer Shows Loaded Miles',
      reason: 'The odometer shows miles driven from the scene to a named destination',
      holds: allOf(
        g,
        'drove',
        n(
          'Odometer Shows Loaded Miles',
          'A destination reading past the scene reading to a named destination.'
        ),
        [
          pinOf(
            node(
              g,
              'pastScene',
              'std.logic.greater',
              n(
                'Destination Past Scene',
                'The destination reading is higher than the scene reading.'
              ),
              {
                a: orZero(
                  g,
                  'destinationReading',
                  n('Destination Reading or 0', 'Treats a missing reading as 0.'),
                  'odometer.destination'
                ),
                b: orZero(
                  g,
                  'sceneReading',
                  n('Scene Reading or 0', 'Treats a missing reading as 0.'),
                  'odometer.scene'
                )
              },
              { type: 'number' }
            ),
            'result'
          ),
          named
        ]
      )
    }
  ]);
};

const pronouncedDeadCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  return criteriaResult(g, 'Pronounced Dead', [
    {
      id: 'deadAtScene',
      label: 'Dead at the Scene',
      reason: 'The incident disposition says the patient was dead at the scene',
      holds: isIn(
        g,
        'deadAtScene',
        n('Dead at the Scene', 'The NEMSIS 3.4 incident disposition says so, without transport.'),
        KIND.incident,
        'trip.incidentDisposition',
        codes(
          g,
          'deadCodes',
          n(
            'Dead at Scene Dispositions',
            'Dead at the scene without transport, with or without resuscitation.'
          ),
          KIND.incident,
          ['4212015', '4212019']
        )
      )
    },
    {
      id: 'expired',
      label: 'Expired in the Field',
      reason: 'The cardiac arrest ended with the patient expiring in the field',
      holds: isCode(
        g,
        'expired',
        n('Expired in the Field', 'How the cardiac arrest ended, NEMSIS eArrest.18.'),
        KIND.arrestOutcome,
        'trip.arrestOutcome',
        '3018003'
      )
    },
    {
      id: 'resuscitationEnded',
      label: 'Resuscitation Ended for Death',
      reason:
        'Resuscitation was stopped for obvious death, a DNR, medical control or completed protocol',
      holds: pinOf(
        node(
          g,
          'resuscitationEnded',
          'std.list.contains-any',
          n('Resuscitation Ended for Death', 'Why resuscitation stopped, NEMSIS eArrest.16.'),
          {
            list: 'trip.resuscitationStopped',
            other: codes(
              g,
              'deathEndings',
              n(
                'Reasons Meaning Death',
                'DNR, medical control order, obvious signs of death, protocol completed.'
              ),
              KIND.stopped,
              ['3016001', '3016003', '3016005', '3016009']
            )
          },
          { type: { code: KIND.stopped } }
        ),
        'result'
      )
    },
    {
      id: 'notAttempted',
      label: 'Resuscitation Not Attempted',
      reason: 'Resuscitation was not attempted because it was futile or the patient had a DNR',
      holds: pinOf(
        node(
          g,
          'notAttempted',
          'std.list.contains-any',
          n('Resuscitation Not Attempted', 'What resuscitation was tried, NEMSIS eArrest.03.'),
          {
            list: 'trip.resuscitation',
            other: codes(
              g,
              'futileCodes',
              n('Futile or DNR', 'Not attempted as futile, or for DNR orders.'),
              KIND.resuscitation,
              ['3003007', '3003009']
            )
          },
          { type: { code: KIND.resuscitation } }
        ),
        'result'
      )
    },
    {
      id: 'narrative',
      label: 'Narrative Says Dead',
      reason: 'The narrative describes the patient as dead or pronounced',
      holds: pinOf(
        node(
          g,
          'narrative',
          'std.text.find-phrases',
          n(
            'Narrative Says Dead',
            'Looks for words of death in the narrative, skipping negated ones such as "not pronounced".'
          ),
          {
            text: 'trip.narrative',
            phrases: pinOf(
              node(
                g,
                'deathPhrases',
                'std.value',
                n('Words of Death', 'What crews write when a patient is dead or pronounced.'),
                {},
                { type: listOf('string'), value: DEATH_PHRASES }
              ),
              'value'
            )
          }
        ),
        'found'
      )
    }
  ]);
};

const refusalCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  return criteriaResult(g, 'Refusal', [
    {
      id: 'refusedCare',
      label: 'Incident Says Refused',
      reason: 'The incident disposition says the patient refused care without transport',
      holds: isCode(
        g,
        'refusedCare',
        n('Incident Says Refused', 'The NEMSIS 3.4 incident disposition is a refusal.'),
        KIND.incident,
        'trip.incidentDisposition',
        '4212025'
      )
    },
    {
      id: 'refusedEvaluation',
      label: 'Patient Refused Care',
      reason: 'The patient evaluation says the patient refused evaluation or care',
      holds: isIn(
        g,
        'refusedEvaluation',
        n('Patient Refused Care', 'The NEMSIS 3.5 patient evaluation is a refusal.'),
        KIND.evaluation,
        'trip.patientEvaluation',
        codes(
          g,
          'refusedEvaluations',
          n('Refused Evaluations', 'Evaluated and refused care, or refused evaluation and care.'),
          KIND.evaluation,
          ['4228003', '4228007']
        )
      )
    },
    {
      id: 'refusedTransport',
      label: 'Patient Refused Transport',
      reason: 'The transport disposition says the patient refused transport',
      holds: isCode(
        g,
        'refusedTransport',
        n('Patient Refused Transport', 'The NEMSIS 3.5 transport disposition is a refusal.'),
        KIND.transport,
        'trip.transportDisposition',
        '4230009'
      )
    },
    {
      id: 'crewRefused',
      label: 'Crew Says Refused',
      reason: 'The crew disposition says the patient refused care',
      holds: isCode(
        g,
        'crewRefused',
        n('Crew Says Refused', 'Back in service, care or support refused.'),
        KIND.crew,
        'trip.crewDisposition',
        '4229013'
      )
    }
  ]);
};

const treatedCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  const count = (id: string, label: string, note: string, list: Port) =>
    atLeast(
      g,
      id,
      n(label, note),
      'integer',
      pinOf(
        node(g, `${id}Count`, 'std.list.length', n(`${label}: Count`, 'Counts the items.'), {
          list
        }),
        'length'
      ),
      1
    );
  return criteriaResult(g, 'Treated', [
    {
      id: 'treatedIncident',
      label: 'Incident Says Treated',
      reason:
        'The incident disposition says the patient was evaluated or treated without transport',
      holds: isIn(
        g,
        'treatedIncident',
        n('Incident Says Treated', 'The NEMSIS 3.4 incident disposition.'),
        KIND.incident,
        'trip.incidentDisposition',
        codes(
          g,
          'treatedIncidents',
          n(
            'Treated Incident Dispositions',
            'Evaluated, released, transferred to another unit, or taken by police or private vehicle.'
          ),
          KIND.incident,
          ['4212021', '4212027', '4212029', '4212031', '4212035', '4212037']
        )
      )
    },
    {
      id: 'evaluated',
      label: 'Patient Evaluated',
      reason: 'The patient evaluation says the crew evaluated or cared for the patient',
      holds: isIn(
        g,
        'evaluated',
        n('Patient Evaluated', 'The NEMSIS 3.5 patient evaluation.'),
        KIND.evaluation,
        'trip.patientEvaluation',
        codes(
          g,
          'evaluatedCodes',
          n('Evaluated Patients', 'Care provided, no care required, or support services provided.'),
          KIND.evaluation,
          ['4228001', '4228005', '4228009']
        )
      )
    },
    {
      id: 'crewCared',
      label: 'Crew Gave Care',
      reason: 'The crew disposition says the crew cared for the patient',
      holds: isIn(
        g,
        'crewCared',
        n('Crew Gave Care', 'The NEMSIS 3.5 crew disposition.'),
        KIND.crew,
        'trip.crewDisposition',
        codes(
          g,
          'caredCodes',
          n('Care Crew Dispositions', 'Primary care given, handed off, or taken over.'),
          KIND.crew,
          ['4229001', '4229003', '4229007']
        )
      )
    },
    {
      id: 'medicationsGiven',
      label: 'Medications Given',
      reason: 'The crew gave medications',
      holds: count(
        'medicationsGiven',
        'Medications Given',
        'Any medication on the report.',
        'trip.medications'
      )
    },
    {
      id: 'proceduresDone',
      label: 'Procedures Done',
      reason: 'The crew performed procedures',
      holds: count(
        'proceduresDone',
        'Procedures Done',
        'Any procedure on the report.',
        'trip.procedures'
      )
    }
  ]);
};

const scheduledCriteria = (): GraphDef => {
  const g = rule([ENCOUNTER_IN], CRITERIA_OUT);
  breakTrip(g);
  return criteriaResult(g, 'Scheduled', [
    {
      id: 'scheduled',
      label: 'Scheduled or Interfacility Service',
      reason: 'Scheduled or interfacility transport',
      holds: isIn(
        g,
        'scheduled',
        n(
          'Scheduled or Interfacility Service',
          'NEMSIS requires the type of service, so this is always known.'
        ),
        KIND.service,
        'trip.serviceType',
        codes(
          g,
          'scheduledCodes',
          n(
            'Scheduled and Interfacility Services',
            'Facility transfers and other routine medical transports.'
          ),
          KIND.service,
          [...INTERFACILITY, ...SERVICE_TYPES.scheduled]
        )
      )
    }
  ]);
};

type Fact = { id: string; key: string; label: string; note: string };

const FACTS: Fact[] = [
  {
    id: 'noPatient',
    key: 'billing.no-patient-criteria',
    label: 'No Patient Criteria',
    note: 'Whether the trip had no patient to bill for.'
  },
  {
    id: 'transported',
    key: 'billing.transported-criteria',
    label: 'Transported Criteria',
    note: 'Whether a disposition says this unit transported the patient.'
  },
  {
    id: 'notTransported',
    key: 'billing.not-transported-criteria',
    label: 'Not Transported Criteria',
    note: 'Whether a disposition says this unit did not transport the patient.'
  },
  {
    id: 'arrival',
    key: 'billing.arrival-criteria',
    label: 'Arrival Criteria',
    note: 'Whether times and odometer show the patient was taken to a destination.'
  },
  {
    id: 'dead',
    key: 'billing.pronounced-dead-criteria',
    label: 'Pronounced Dead Criteria',
    note: 'Whether the patient was dead or pronounced on scene.'
  },
  {
    id: 'refusal',
    key: 'billing.refusal-criteria',
    label: 'Refusal Criteria',
    note: 'Whether the patient refused care or transport.'
  },
  {
    id: 'treated',
    key: 'billing.treated-criteria',
    label: 'Treated Criteria',
    note: 'Whether the crew evaluated or cared for the patient.'
  },
  {
    id: 'scheduled',
    key: 'billing.scheduled-criteria',
    label: 'Scheduled Criteria',
    note: 'Whether the service was a scheduled or interfacility one.'
  }
];

const holds = (id: string) => `${id}.holds` as const;

const tripClassification = (): GraphDef => {
  const g = rule(
    [ENCOUNTER_IN],
    [
      d(
        'classification',
        CODE.classification,
        'Classification',
        'What kind of trip it was: emergency, scheduled, pronouncedDead, treatNoTransport, refusal, notBillable, or unknown when the report does not say clearly enough and a biller must decide.'
      ),
      d('billable', 'boolean', 'Billable', 'Whether the trip is billed.'),
      reasonsOut('the trip was classified this way')
    ]
  );
  for (const f of FACTS) {
    g.add(f.id, f.key, { label: f.label, note: f.note });
    g.wire('entry.encounter', `${f.id}.encounter`);
  }
  breakTrip(g);
  const transported = anyOf(
    g,
    'carried',
    n(
      'Transported by This Unit',
      'A disposition says so, or the arrival shows it and no disposition says otherwise.'
    ),
    [
      holds('transported'),
      allOf(
        g,
        'inferred',
        n('Shown by the Arrival', 'Arrival evidence and no disposition against it.'),
        [
          holds('arrival'),
          not(
            g,
            'notDenied',
            n('No Disposition Against It', 'No disposition says no transport.'),
            holds('notTransported')
          )
        ]
      )
    ]
  );
  const conflict = anyOf(
    g,
    'conflict',
    n(
      'Report Contradicts Itself',
      'Dispositions disagree, so a biller decides rather than the rule guessing.'
    ),
    [
      allOf(
        g,
        'transportConflict',
        n('Transported and Not Transported', 'Both kinds of disposition hold.'),
        [holds('transported'), holds('notTransported')]
      ),
      allOf(
        g,
        'patientConflict',
        n('Transported Without a Patient', 'A transport with a no-patient disposition.'),
        [holds('transported'), holds('noPatient')]
      )
    ]
  );
  const nonPatientService = allOf(
    g,
    'nonPatientService',
    n('Non-Patient Service Without Transport', 'A non-patient service and nobody transported.'),
    [
      isIn(
        g,
        'nonPatientRequest',
        n('Non-Patient Service Requested', 'The type of service, NEMSIS eResponse.05.'),
        KIND.service,
        'trip.serviceType',
        codes(
          g,
          'nonPatientCodes',
          n(
            'Non-Patient Services',
            'Assists, standbys, rescue, crew or organ transport, mortuary, community health and administration.'
          ),
          KIND.service,
          NON_PATIENT_SERVICES
        )
      ),
      not(g, 'notCarried', n('Not Transported', 'No transport by this unit.'), transported)
    ]
  );
  const supporting = allOf(
    g,
    'supporting',
    n(
      'Only Supported Another Crew',
      'The crew supported the primary crew and did not transport; the primary agency bills.'
    ),
    [
      isCode(
        g,
        'supportCrew',
        n('Crew Supported Another', 'The crew disposition says it supported the primary crew.'),
        KIND.crew,
        'trip.crewDisposition',
        '4229005'
      ),
      not(g, 'supportNotCarried', n('Not Transported', 'No transport by this unit.'), transported)
    ]
  );
  const notBillable = anyOf(
    g,
    'notBillable',
    n('Nothing to Bill', 'No patient, a non-patient service, or only support to another crew.'),
    [holds('noPatient'), nonPatientService, supporting]
  );
  const kind = (id: string, label: string, note: string, when: Port, value: string) =>
    select(g, id, n(label, note), CODE.classification, when, fixed(value));
  const classification = firstSet(
    g,
    'classification',
    n(
      'First Kind of Trip That Holds',
      'The first one, in this order, decides; else a biller does.'
    ),
    CODE.classification,
    [
      kind(
        'asUnknownConflict',
        'Unknown When Contradicted',
        'Contradictions go to a biller.',
        conflict,
        'unknown'
      ),
      kind('asNotBillable', 'Not Billable', 'Nothing to bill.', notBillable, 'notBillable'),
      kind(
        'asScheduled',
        'Scheduled When Transported on a Schedule',
        'A transport on a scheduled or interfacility service.',
        allOf(
          g,
          'scheduledTransport',
          n('Transported on a Schedule', 'Transported, on a scheduled service.'),
          [transported, holds('scheduled')]
        ),
        'scheduled'
      ),
      kind(
        'asEmergency',
        'Emergency When Transported',
        'Any other transport.',
        transported,
        'emergency'
      ),
      kind(
        'asPronouncedDead',
        'Pronounced Dead',
        'Dead without transport: billed at the BLS rate with QL.',
        holds('dead'),
        'pronouncedDead'
      ),
      kind(
        'asRefusal',
        'Refusal',
        'A refusal without transport: billed as A0998.',
        holds('refusal'),
        'refusal'
      ),
      kind(
        'asTreated',
        'Treated, Not Transported',
        'Care without transport by this unit: billed as A0998.',
        anyOf(
          g,
          'treatedOrHandedOff',
          n('Treated or Handed Off', 'Care given, or a disposition says no transport.'),
          [holds('treated'), holds('notTransported')]
        ),
        'treatNoTransport'
      ),
      fixed('unknown')
    ]
  );
  const billable = isIn(
    g,
    'billable',
    n('Billable Kind of Trip', 'Whether this kind of trip is billed.'),
    'tripClassification',
    classification,
    codes(
      g,
      'billableKinds',
      n(
        'Billable Kinds of Trip',
        'Transports, pronounced dead, treatment and refusal without transport.'
      ),
      'tripClassification',
      BILLABLE
    )
  );
  const unknown = reasonsOf(
    g,
    'unknownReasons',
    n('Why a Biller Decides', 'Says why the rule could not decide.'),
    [
      {
        id: 'contradicted',
        label: 'Report Contradicts Itself',
        reason:
          'The dispositions contradict each other: a biller must decide what kind of trip it was',
        holds: conflict
      },
      {
        id: 'undecided',
        label: 'Nothing Decided',
        reason:
          'No disposition, arrival or care says what happened on the trip: a biller must decide',
        holds: isCode(
          g,
          'undecided',
          n('Nothing Decided', 'No kind of trip held.'),
          'tripClassification',
          classification,
          'unknown'
        )
      }
    ]
  );
  g.ret('return');
  g.wire(classification, 'return.classification');
  g.wire(billable, 'return.billable');
  g.wire(
    joinLists(
      g,
      'allReasons',
      n('Every Reason', 'The reasons of every test that held.'),
      'string',
      [...FACTS.map((f) => `${f.id}.reasons` as const), unknown]
    ),
    'return.reasons'
  );
  return g.def;
};

export const tripGraphs: SeedGraph[] = [
  asRule(
    'billing.no-patient-criteria',
    'No Patient Criteria',
    'Holds when the trip had no patient to bill for: the unit was cancelled or found no patient, the incident was an assist or standby, the transport was not of a patient, or the crew gave no care.',
    noPatientCriteria()
  ),
  asRule(
    'billing.transported-criteria',
    'Transported Criteria',
    'Holds when a disposition says this unit transported the patient.',
    transportedCriteria()
  ),
  asRule(
    'billing.not-transported-criteria',
    'Not Transported Criteria',
    'Holds when a disposition says this unit did not transport the patient: another unit did, the patient refused, or nobody was transported.',
    notTransportedCriteria()
  ),
  asRule(
    'billing.arrival-criteria',
    'Arrival Criteria',
    'Holds when the report shows the patient was taken somewhere even without a transport disposition: an arrival time at a named destination, or odometer miles from the scene to one.',
    arrivalCriteria()
  ),
  asRule(
    'billing.pronounced-dead-criteria',
    'Pronounced Dead Criteria',
    'Holds when the patient was dead: a dead-at-scene disposition, an arrest that ended in the field, resuscitation stopped or not attempted for death, or a narrative that says so. CMS pays the BLS base rate with QL, without mileage, when the patient was pronounced after the call and before loading.',
    pronouncedDeadCriteria()
  ),
  asRule(
    'billing.refusal-criteria',
    'Refusal Criteria',
    'Holds when the patient refused care or transport.',
    refusalCriteria()
  ),
  asRule(
    'billing.treated-criteria',
    'Treated Criteria',
    'Holds when the crew evaluated or cared for the patient: a disposition says so, or medications or procedures are on the report.',
    treatedCriteria()
  ),
  asRule(
    'billing.scheduled-criteria',
    'Scheduled Criteria',
    'Holds when the service was scheduled or between facilities.',
    scheduledCriteria()
  ),
  asRule(
    'billing.trip-classification',
    'Trip Classification',
    'Decides what kind of trip it was from every sign in the report, since agencies fill in different fields: no patient, a transport (by disposition, or by arrival when no disposition says otherwise), scheduled or emergency, pronounced dead, refusal or treatment without transport. A report that contradicts itself or says too little is unknown, for a biller to decide.',
    tripClassification()
  )
];
