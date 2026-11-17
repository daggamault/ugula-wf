import { CLASSIFICATION_FIELD, CLASSIFICATION_LABELS } from '@ugula/billing';
import type { GraphDef, ValueType } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  type Builder,
  codeSet,
  condition,
  d,
  exit,
  firstOf,
  fixed,
  keepListed,
  makeList,
  makeObject,
  orElse,
  P,
  type Port,
  pureSlot,
  reasonsOf,
  rule,
  select,
  shared,
  stage,
  summary,
  T,
  type Test,
  template
} from './shared.ts';

type Held = { id: string; label: string; reason: string; tests: Test[] };

type Inputs = Record<string, [ValueType, Port]>;

const heldRules = (g: Builder, inputs: Inputs, rules: Held[]) =>
  Object.fromEntries(
    rules.map((r) => [
      r.id,
      condition(
        g,
        r.id,
        r.label,
        Object.fromEntries(
          Object.entries(inputs).filter(([name]) => r.tests.some((t) => t.field === name))
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
  condition(
    g,
    id,
    label,
    Object.fromEntries(rules.map((r) => [r.id, ['boolean', held[r.id] as Port]])),
    rules.map((r) => ({ field: r.id, op: 'is', value: true })),
    'any'
  );

const reasonsHeld = (g: Builder, rules: Held[], held: Record<string, Port>) =>
  reasonsOf(
    g,
    'reasons',
    'Rules That Held',
    rules.map((r) => ({
      id: `${r.id}Reason`,
      label: r.label,
      when: held[r.id] as Port,
      reason: r.reason
    }))
  );

const tripInputs = (...pins: string[]): Inputs =>
  Object.fromEntries(pins.map((p) => [p, ['string', `trip.${p}`]]));

const INTERFACILITY = ['2205005', '2205015', '2205017', '2205019'];

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

const CLASSIFICATION_OUT = d(
  'classification',
  'string',
  'Classification',
  'The classification to bill the report as.'
);

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
    label: 'Non-Patient Service Requested and Nobody Transported',
    reason: 'Non-patient service requested and nobody transported',
    tests: [
      { field: 'serviceType', op: 'oneOf', value: [...NON_PATIENT_SERVICES] },
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

const SCHEDULED: Held = {
  id: 'scheduledTransport',
  label: 'Scheduled or Interfacility Transport',
  reason: 'Scheduled or interfacility transport',
  tests: [{ field: 'serviceType', op: 'oneOf', value: [...INTERFACILITY, '2205007'] }]
};

const EMERGENCY: Held[] = [
  {
    id: 'emergencyResponse',
    label: 'Emergency Response',
    reason: 'Emergency response',
    tests: [{ field: 'serviceType', op: 'oneOf', value: ['2205001', '2205003', '2205009'] }]
  },
  {
    id: 'treatedAndTransported',
    label: 'Patient Treated and Transported by This Unit',
    reason: 'Patient treated and transported by this unit',
    tests: [{ field: 'incidentDisposition', op: 'oneOf', value: [...TRANSPORTED_INCIDENTS] }]
  },
  {
    id: 'transported',
    label: 'Patient Transported by This Unit',
    reason: 'Patient transported by this unit',
    tests: [{ field: 'transportDisposition', op: 'oneOf', value: [...TRANSPORTED] }]
  }
];

const classification = (): GraphDef => {
  const g = rule(
    [d('trip', T.trip, 'Trip Facts', 'The dispositions and type of service of the trip.')],
    [CLASSIFICATION_OUT, P.reason(), P.reasons('the classification was chosen')]
  );
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.wire('entry.trip', 'trip.trip');
  const rules = [...NOT_BILLABLE, ...REFUSAL, ...NO_TRANSPORT, SCHEDULED, ...EMERGENCY];
  const held = heldRules(
    g,
    tripInputs(
      'incidentDisposition',
      'unitDisposition',
      'patientEvaluation',
      'transportDisposition',
      'serviceType'
    ),
    rules
  );
  const classified = firstOf(
    g,
    'classification',
    'First Classification That Holds, Else Emergency',
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
        id: 'asTreatNoTransport',
        label: 'Treat, No Transport When a No-Transport Rule Holds',
        when: anyHeld(g, 'noTransport', 'A No-Transport Rule Holds', NO_TRANSPORT, held),
        value: fixed('treatNoTransport')
      },
      {
        id: 'asScheduled',
        label: 'Scheduled When Scheduled or Interfacility',
        when: held[SCHEDULED.id] as Port,
        value: fixed('scheduled')
      }
    ],
    fixed('emergency')
  );
  const reasons = reasonsHeld(g, rules, held);
  g.add('first', 'std.list.first', { label: 'First Rule That Held' });
  g.wire(reasons, 'first.list');
  g.ret('return');
  g.wire(classified, 'return.classification');
  g.wire('first.item', 'return.reason');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const classifyTrip = (): GraphDef => {
  const g = rule(
    [P.facts()],
    [CLASSIFICATION_OUT, P.reason(), P.reasons('the classification was chosen')]
  );
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('base', 'billing.classification', { label: 'Classification' });
  g.add('agency', 'billing.agency-classification', { label: 'Agency Classification' });
  g.add('unchanged', 'std.logic.equal', { label: 'Agency Kept the Classification' });
  const agencyReason = orElse(
    g,
    'agencyReason',
    'Agency Reason, Else Changed by an Agency Rule',
    'agency.reason',
    fixed('Changed by an agency rule')
  );
  const agencyReasons = makeList(g, 'agencyReasons', 'Agency Reason as a List', 'string', [
    agencyReason
  ]);
  const reasons = select(
    g,
    'reasons',
    'Base Reasons When Kept, Else the Agency Reason',
    'unchanged.result',
    'base.reasons',
    agencyReasons
  );
  g.ret('return');
  g.wire('entry.facts', 'facts.facts', 'agency.facts');
  g.wire('facts.trip', 'base.trip');
  g.wire('base.classification', 'agency.classification', 'unchanged.b');
  g.wire('base.reason', 'agency.reason');
  g.wire('agency.classification', 'return.classification', 'unchanged.a');
  g.wire('agency.reason', 'return.reason');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const REVIEW: Held[] = [
  {
    id: 'noDisposition',
    label: 'No Disposition Reported',
    reason: 'No disposition was reported',
    tests: [
      { field: 'incidentDisposition', op: 'empty' },
      { field: 'unitDisposition', op: 'empty' },
      { field: 'transportDisposition', op: 'empty' }
    ]
  },
  {
    id: 'medicationsNotBilled',
    label: 'Not Billable, but Medications Were Given',
    reason: 'Not billable by its disposition, but the report documents medications given',
    tests: [
      { field: 'classification', op: 'is', value: 'notBillable' },
      { field: 'medications', op: 'present' }
    ]
  },
  {
    id: 'proceduresNotBilled',
    label: 'Not Billable, but Procedures Were Done',
    reason: 'Not billable by its disposition, but the report documents procedures done',
    tests: [
      { field: 'classification', op: 'is', value: 'notBillable' },
      { field: 'procedures', op: 'present' }
    ]
  },
  {
    id: 'transportUnconfirmed',
    label: 'Billed as a Transport With No Transport Disposition',
    reason: 'Billed as a transport, but no disposition says this unit transported the patient',
    tests: [
      { field: 'classification', op: 'oneOf', value: ['emergency', 'scheduled'] },
      { field: 'incidentDisposition', op: 'notOneOf', value: TRANSPORTED_INCIDENTS },
      { field: 'transportDisposition', op: 'notOneOf', value: TRANSPORTED }
    ]
  }
];

const classificationReview = (): GraphDef => {
  const g = rule(
    [
      d('classification', 'string', 'Classification', 'The classification the trip was given.'),
      P.facts()
    ],
    [
      d(
        'review',
        'boolean',
        'Needs Review',
        'The report is too incomplete or contradictory to trust the classification.'
      ),
      d('reason', 'string', 'Why', 'The first review rule that held.', true),
      P.reasons('the classification needs a biller')
    ]
  );
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.add('clinical', 'billing.clinical-facts.break', { label: 'Clinical Facts' });
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.trip', 'trip.trip');
  g.wire('facts.clinical', 'clinical.clinical');
  const held = heldRules(
    g,
    {
      ...tripInputs('incidentDisposition', 'unitDisposition', 'transportDisposition'),
      classification: ['string', 'entry.classification'],
      medications: ['any', 'clinical.medications'],
      procedures: ['any', 'clinical.procedures']
    },
    REVIEW
  );
  const reasons = reasonsHeld(g, REVIEW, held);
  g.add('first', 'std.list.first', { label: 'First Rule That Held' });
  g.wire(reasons, 'first.list');
  g.ret('return');
  g.wire(anyHeld(g, 'review', 'A Review Rule Holds', REVIEW, held), 'return.review');
  g.wire('first.item', 'return.reason');
  g.wire(reasons, 'return.reasons');
  return g.def;
};

const classificationLabels = () =>
  shared.lookup(
    'billing.classification-labels',
    'Classification Labels',
    'What each classification is called on the claim history and in tasks.',
    {
      type: 'string',
      rows: Object.entries(CLASSIFICATION_LABELS).map(([key, value]) => ({ key, value }))
    }
  );

const decideClaim = (): GraphDef => {
  const g = stage([P.claimId(), P.pcr(), P.facts()], [CLASSIFICATION_OUT, P.reason()], {
    claim: exit(
      'Claim',
      'The report is billed under the classification it was given or a biller chose.'
    ),
    skip: exit('Skip', 'The trip is not billable, by its disposition or by a biller.')
  });
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('review', 'billing.classification-review', { label: 'Classification Needs Review?' });
  g.add('label', 'std.table.lookup', {
    label: 'Classification Label',
    config: classificationLabels()
  });
  g.add('certain', 'std.flow.branch', { label: 'Needs a Biller?' });
  g.add('billable', 'std.flow.switch', {
    label: 'Classified as Not Billable?',
    config: { cases: ['notBillable'] }
  });
  const classified = template(g, 'classifiedAs', 'Classified As', 'Classified as {label}', {
    label: 'label.value'
  });
  g.add('logClaim', 'billing.record-decision', { label: 'Log the Classification' });
  g.add('logSkip', 'billing.record-decision', {
    label: 'Log Not Billable',
    values: { decision: 'Not billable, so the claim is voided' }
  });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  const context = makeObject(g, 'context', 'Task Details', { trip: [{ object: {} }, 'trip.trip'] });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  const suggested = makeObject(g, 'suggested', 'Suggested Classification', {
    classification: [
      'string',
      select(
        g,
        'suggestion',
        'The Classification Unless Not Billable',
        condition(
          g,
          'transportable',
          'Classified as Billable',
          { classification: ['string', 'classify.classification'] },
          [{ field: 'classification', op: 'isNot', value: 'notBillable' }]
        ),
        'classify.classification'
      )
    ]
  });
  g.add('ask', 'std.human.task', {
    label: 'Review Classification',
    config: {
      title: 'Review classification',
      queue: 'billing-review',
      instructions:
        'Check the Encounter tab for patient contact, care given and transport before you decide. Reports are often incomplete, so a missing value may only mean it was not recorded.',
      fields: [{ ...CLASSIFICATION_FIELD, required: ['claim'] }],
      outcomes: ['claim', 'skipClaim'],
      hints: {
        claim: 'Bill the trip as the classification chosen and continue to the claim.',
        skipClaim: 'The trip is not billable; void the claim with this decision on its history.'
      },
      prefill: 'suggested'
    }
  });
  g.ret('classified', 'claim');
  g.ret('confirmed', 'claim');
  g.ret('notBillable', 'skip');
  g.ret('skipped', 'skip');
  g.wire('entry.exec', 'certain.exec');
  g.wire('entry.facts', 'classify.facts', 'review.facts');
  g.wire('entry.pcr', 'trip.pcr', 'subject.pcr');
  g.wire('entry.claimId', 'logClaim.claimId', 'logSkip.claimId');
  g.wire('classify.classification', 'review.classification', 'label.key', 'billable.value');
  g.wire('classify.classification', 'trip.classification');
  for (const ret of ['classified', 'notBillable', 'skipped']) {
    g.wire('classify.classification', `${ret}.classification`);
  }
  for (const ret of ['classified', 'confirmed', 'notBillable', 'skipped']) {
    g.wire('classify.reason', `${ret}.reason`);
  }
  g.wire('classify.reason', 'trip.reason', 'logClaim.reason', 'logSkip.reason');
  g.wire('review.review', 'certain.condition');
  g.wire('certain.false', 'billable.exec');
  g.wire('billable.default', 'logClaim.exec');
  g.wire(classified, 'logClaim.decision');
  g.wire('logClaim.then', 'classified.exec');
  g.wire('billable.notBillable', 'logSkip.exec');
  g.wire('logSkip.then', 'notBillable.exec');
  g.wire('certain.true', 'ask.exec');
  g.wire(context, 'ask.context');
  g.wire(suggested, 'ask.defaults');
  g.wire('subject.subject', 'ask.subject');
  summary(
    g,
    'ask',
    '{why}; it was classified as {label}[ ({reason})]. Choose how to bill it, or skip the claim if it is not billable',
    { why: 'review.reason', label: 'label.value', reason: 'classify.reason' }
  );
  g.wire('ask.claim', 'confirmed.exec');
  g.wire('ask.classification', 'confirmed.classification');
  g.wire('ask.skipClaim', 'skipped.exec');
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
  g.add('distance', 'std.math.subtract', { label: 'Destination Minus Scene' });
  g.add('positive', 'std.math.max', { label: 'Never Below Zero', values: { b: 0 } });
  g.add('rounded', 'std.math.round', {
    label: 'Loaded Miles to the Hundredth',
    values: { digits: 2 }
  });
  g.ret('return');
  g.wire('entry.destinationOdometer', 'distance.a');
  g.wire('entry.sceneOdometer', 'distance.b');
  g.wire('distance.result', 'positive.a');
  g.wire('positive.result', 'rounded.value');
  g.wire('rounded.result', 'return.loadedMiles');
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

const IV_SOLUTION_SET = codeSet(
  'billing.iv-solutions',
  'IV Solutions',
  'The coded medications (RxNorm) that are IV solutions, such as saline or dextrose, so giving them IV or IO does not count as an IV/IO medication for the level of service.',
  Object.fromEntries(IV_SOLUTIONS.map((code) => [code, 'IV solution']))
);

const ALS2_PROCEDURE_SET = codeSet(
  'billing.als2-procedures',
  'ALS2 Procedures',
  'The coded procedures (SNOMED CT) that make a trip ALS2, the ones CMS names for it: manual defibrillation or cardioversion, endotracheal intubation, a central venous line, cardiac pacing, chest decompression, a surgical airway or an intraosseous line.',
  Object.fromEntries(ALS2_PROCEDURES.map((code) => [code, 'ALS2 procedure']))
);

const SCT: Held[] = [
  {
    id: 'criticalCare',
    label: 'Critical Care Documented on an Interfacility Transport',
    reason: 'Critical care documented on an interfacility transport',
    tests: [
      { field: 'levelOfCare', op: 'is', value: '4232009' },
      { field: 'serviceType', op: 'oneOf', value: [...INTERFACILITY] }
    ]
  },
  {
    id: 'crewSct',
    label: 'Crew Reported Specialty Care on an Interfacility Transport',
    reason: 'Crew reported specialty care on an interfacility transport',
    tests: [
      { field: 'cmsServiceLevel', op: 'is', value: '2650015' },
      { field: 'serviceType', op: 'oneOf', value: [...INTERFACILITY] }
    ]
  }
];

const ALS2: Held[] = [
  {
    id: 'procedureCoded',
    label: 'ALS2 Procedure Coded',
    reason: 'ALS2 procedure coded',
    tests: [{ field: 'proceduresCoded', op: 'gte', value: 1 }]
  },
  {
    id: 'procedureInNarrative',
    label: 'ALS2 Procedures in the Narrative',
    reason: 'ALS2 procedures in the narrative',
    tests: [{ field: 'proceduresInNarrative', op: 'gte', value: 1 }]
  },
  {
    id: 'threeMedicationsCoded',
    label: 'Three or More IV/IO Medications Coded',
    reason: 'Three or more IV/IO medications coded',
    tests: [{ field: 'medicationsCoded', op: 'gte', value: 3 }]
  },
  {
    id: 'threeDosesInNarrative',
    label: 'Three or More IV/IO Doses in the Narrative',
    reason: 'Three or more IV/IO doses in the narrative',
    tests: [{ field: 'dosesInNarrative', op: 'gte', value: 3 }]
  },
  {
    id: 'crewAls2',
    label: 'Crew Reported ALS2',
    reason: 'Crew reported ALS2',
    tests: [{ field: 'cmsServiceLevel', op: 'is', value: '2650005' }]
  }
];

const ALS1: Held[] = [
  {
    id: 'alsAssessed',
    label: 'ALS Assessment Performed and Warranted',
    reason: 'ALS assessment performed and warranted',
    tests: [{ field: 'alsAssessment', op: 'is', value: ALS_ASSESSMENT_YES }]
  },
  {
    id: 'crewAls1',
    label: 'Crew Reported ALS1',
    reason: 'Crew reported ALS1',
    tests: [{ field: 'cmsServiceLevel', op: 'oneOf', value: ['2650001', '2650003'] }]
  },
  {
    id: 'medicationCoded',
    label: 'IV/IO Medications Coded',
    reason: 'IV/IO medications coded',
    tests: [{ field: 'medicationsCoded', op: 'gte', value: 1 }]
  },
  {
    id: 'doseInNarrative',
    label: 'IV/IO Doses in the Narrative',
    reason: 'IV/IO doses in the narrative',
    tests: [{ field: 'dosesInNarrative', op: 'gte', value: 1 }]
  }
];

const BLS: Held = {
  id: 'blsCare',
  label: 'BLS Care Documented',
  reason: 'BLS care documented',
  tests: [{ field: 'levelOfCare', op: 'is', value: '4232001' }]
};

const LEVEL_OUT = d(
  'level',
  'string',
  'Level of Service',
  'The level of service: BLS, ALS1, ALS2 or SCT.'
);

const levelOfService = (): GraphDef => {
  const g = rule([P.facts(), P.findings(true)], [LEVEL_OUT, P.reasons('the level was chosen')]);
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.add('clinical', 'billing.clinical-facts.break', { label: 'Clinical Facts' });
  g.add('findings', 'billing.findings.break', { label: 'Narrative Findings' });
  g.add('ivRoute', 'std.list.where', {
    label: 'Medications Given IV or IO',
    config: { field: 'route', op: 'oneOf', value: IV_ROUTES }
  });
  keepListed(
    g,
    'ivDrugs',
    'IV/IO Medications Other Than Solutions',
    IV_SOLUTION_SET,
    'ivRoute.list',
    'medication',
    'notListed'
  );
  keepListed(
    g,
    'codedProcedures',
    'ALS2 Procedures Coded',
    ALS2_PROCEDURE_SET,
    'clinical.procedures',
    'procedure'
  );
  g.add('procedureCount', 'std.list.length', { label: 'How Many ALS2 Procedures' });
  g.wire('entry.facts', 'facts.facts');
  g.wire('entry.findings', 'findings.findings');
  g.wire('facts.trip', 'trip.trip');
  g.wire('facts.clinical', 'clinical.clinical');
  g.wire('clinical.medications', 'ivRoute.list');
  g.wire('findings.procedures', 'procedureCount.list');
  const rules = [...SCT, ...ALS2, ...ALS1, BLS];
  const held = heldRules(
    g,
    {
      ...tripInputs('levelOfCare', 'cmsServiceLevel', 'serviceType', 'alsAssessment'),
      medicationsCoded: ['integer', 'ivDrugs.count'],
      dosesInNarrative: ['integer', 'findings.ivDoses'],
      proceduresCoded: ['integer', 'codedProcedures.count'],
      proceduresInNarrative: ['integer', 'procedureCount.length']
    },
    rules
  );
  const level = firstOf(
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
      { field: 'cmsServiceLevel', op: 'oneOf', value: ['2650003', '2650009'] }
    ]
  }
];

const emergencyStatus = (): GraphDef => {
  const g = rule(
    [d('trip', T.trip, 'Trip Facts', 'The response mode and CMS service level of the trip.')],
    [
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
      P.reasons('the trip is or is not an emergency')
    ]
  );
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.wire('entry.trip', 'trip.trip');
  const held = heldRules(g, tripInputs('responseMode', 'cmsServiceLevel'), EMERGENT);
  g.ret('return');
  g.wire(anyHeld(g, 'emergency', 'An Emergency Rule Holds', EMERGENT, held), 'return.emergency');
  g.wire(reasonsHeld(g, EMERGENT, held), 'return.reasons');
  return g.def;
};

const SERVICE_OUT = d(
  'service',
  T.service,
  'Service',
  'The suggested level of service, emergency status and loaded miles, with the reasons for the level.'
);

const FARTHER_FACILITY: Held[] = [
  {
    id: 'chosenFarther',
    label: "Patient's, Family's or Physician's Choice of a Farther Facility",
    reason: "The patient's, family's or physician's choice of a farther facility",
    tests: [
      { field: 'destinationReason', op: 'oneOf', value: ['4220015', '4220005', '4220017'] },
      { field: 'excessMiles', op: 'gt', value: 0 }
    ]
  },
  {
    id: 'patientChoseFarther',
    label: 'The Patient Chose a Farther Facility',
    reason: 'The patient chose a farther facility',
    tests: [
      { field: 'transportReason', op: 'oneOf', value: ['B', 'C'] },
      { field: 'excessMiles', op: 'gt', value: 0 }
    ]
  }
];

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
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('reason', 'billing.transport-reason', { label: 'Transport Reason' });
  g.add('locations', 'billing.location-facts.break', { label: 'Location Facts' });
  g.add('beyond', 'std.math.subtract', { label: 'Loaded Miles Less Closest Hospital Miles' });
  g.add('excess', 'std.math.round', {
    label: 'Miles Past the Closest Hospital',
    values: { digits: 2 }
  });
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.documentation', 'documentation.documentation', 'reason.documentation');
  g.wire('facts.locations', 'reason.locations', 'locations.locations');
  g.wire('entry.loadedMiles', 'beyond.a');
  g.wire('documentation.closestFacilityMiles', 'beyond.b');
  g.wire('beyond.result', 'excess.value');
  const held = heldRules(
    g,
    {
      transportReason: ['string', 'reason.transportReason'],
      destinationReason: ['string', 'locations.destinationReason'],
      excessMiles: ['number', 'excess.result']
    },
    FARTHER_FACILITY
  );
  const nonCovered = anyHeld(
    g,
    'nonCovered',
    'A Farther Facility Was Chosen',
    FARTHER_FACILITY,
    held
  );
  g.ret('return');
  g.wire(
    select(g, 'miles', 'Excess Miles When Non-Covered', nonCovered, 'excess.result'),
    'return.nonCoveredMiles'
  );
  g.wire(reasonsHeld(g, FARTHER_FACILITY, held), 'return.reasons');
  return g.def;
};

const DEAD_BEFORE_LOADING: Held[] = [
  {
    id: 'deadAtScene',
    label: 'Pronounced Dead at the Scene',
    reason: 'Pronounced dead at the scene, whether or not the body was then transported',
    tests: [
      {
        field: 'incidentDisposition',
        op: 'oneOf',
        value: ['4212013', '4212015', '4212017', '4212019']
      }
    ]
  },
  {
    id: 'expiredInField',
    label: 'Expired in the Field and Not Transported',
    reason: 'Expired in the field and not transported',
    tests: [
      { field: 'arrestOutcome', op: 'is', value: '3018003' },
      {
        field: 'transportDisposition',
        op: 'oneOf',
        value: ['4230005', '4230007', '4230009', '4230013']
      }
    ]
  }
];

const deceasedHandling = (): GraphDef => {
  const g = rule(
    [
      d('service', T.service, 'Service', 'The service suggested for the classification.'),
      d('trip', T.trip, 'Trip Facts', 'The dispositions and cardiac arrest outcome of the trip.')
    ],
    [SERVICE_OUT]
  );
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.wire('entry.trip', 'trip.trip');
  const held = heldRules(
    g,
    tripInputs('incidentDisposition', 'transportDisposition', 'arrestOutcome'),
    DEAD_BEFORE_LOADING
  );
  const notResuscitated = condition(
    g,
    'notResuscitated',
    'Resuscitation Did Not Go On After Loading',
    tripInputs('arrestOutcome'),
    [{ field: 'arrestOutcome', op: 'notOneOf', value: ['3018001', '3018005', '3018009'] }]
  );
  g.add('deceased', 'std.logic.and', { label: 'Pronounced Dead Before Loading' });
  g.wire(notResuscitated, 'deceased.a');
  g.wire(
    anyHeld(g, 'deadBeforeLoading', 'Dead Before Loading', DEAD_BEFORE_LOADING, held),
    'deceased.b'
  );
  g.add('suggested', 'billing.service.break', { label: 'Suggested Service' });
  g.add('withQl', 'std.list.join', {
    label: 'Reasons with QL',
    config: { count: 3, type: 'string' },
    values: { list3: ['Billed as BLS with QL and no mileage'] }
  });
  g.add('service', 'billing.service.make', { label: 'BLS Without Miles When Pronounced Dead' });
  const dead = 'deceased.result';
  const pick = {
    level: select(g, 'level', 'BLS When Pronounced Dead', dead, fixed('BLS'), 'suggested.level'),
    loadedMiles: select(
      g,
      'loadedMiles',
      'No Loaded Miles When Pronounced Dead',
      dead,
      undefined,
      'suggested.loadedMiles'
    ),
    nonCoveredMiles: select(
      g,
      'nonCoveredMiles',
      'No Non-Covered Miles When Pronounced Dead',
      dead,
      undefined,
      'suggested.nonCoveredMiles'
    ),
    basis: select(
      g,
      'basis',
      'Reasons with QL When Pronounced Dead',
      dead,
      'withQl.list',
      'suggested.basis'
    )
  };
  g.ret('return');
  g.wire('entry.service', 'suggested.service');
  g.wire(dead, 'service.deceased');
  g.wire('suggested.basis', 'withQl.list1');
  g.wire(reasonsHeld(g, DEAD_BEFORE_LOADING, held), 'withQl.list2');
  g.wire('suggested.emergency', 'service.emergency');
  for (const [pin, port] of Object.entries(pick)) g.wire(port, `service.${pin}`);
  g.wire('service.service', 'return.service');
  return g.def;
};

const baseService = (): GraphDef => {
  const g = rule([P.facts(), P.findings(true)], [SERVICE_OUT]);
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.add('level', 'billing.level-of-service', { label: 'Level of Service' });
  g.add('emergency', 'billing.emergency-status', { label: 'Emergency Status' });
  g.add('miles', 'billing.loaded-miles', { label: 'Loaded Miles' });
  g.add('nonCovered', 'billing.non-covered-miles', { label: 'Non-Covered Miles' });
  g.add('service', 'billing.service.make', { label: 'Service' });
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

const serviceWithoutMiles = (): GraphDef => {
  const g = rule(
    [d('service', T.service, 'Service', 'The service suggested for the trip.')],
    [d('service', T.service, 'Service', 'The same service with no loaded or non-covered miles.')]
  );
  g.add('parts', 'billing.service.break', { label: 'Suggested Service' });
  g.add('service', 'billing.service.make', {
    label: 'Service Without Miles',
    values: { loadedMiles: null, nonCoveredMiles: null }
  });
  g.ret('return');
  g.wire('entry.service', 'parts.service');
  for (const pin of ['level', 'emergency', 'basis', 'deceased'])
    g.wire(`parts.${pin}`, `service.${pin}`);
  g.wire('service.service', 'return.service');
  return g.def;
};

const tripService = (withoutMiles: boolean): GraphDef => {
  const g = rule([P.facts(), P.findings(true)], [SERVICE_OUT]);
  g.add('suggested', 'billing.base-service', { label: 'Base Service' });
  g.ret('return');
  g.wire('entry.facts', 'suggested.facts');
  g.wire('entry.findings', 'suggested.findings');
  if (!withoutMiles) {
    g.wire('suggested.service', 'return.service');
    return g.def;
  }
  g.add('service', 'billing.service-without-miles', { label: 'Service Without Miles' });
  g.wire('suggested.service', 'service.service');
  g.wire('service.service', 'return.service');
  return g.def;
};

const TRIP_SERVICES = [
  ['emergency', 'billing.trip-emergency', 'Emergency Trip'],
  ['scheduled', 'billing.trip-scheduled', 'Scheduled Trip'],
  ['treatNoTransport', 'billing.trip-treat-no-transport', 'Treat, No Transport'],
  ['refusal', 'billing.trip-refusal', 'Refusal']
] as const;

const determineService = (): GraphDef => {
  const g = rule([P.classification(), P.facts(), P.findings(true)], [SERVICE_OUT]);
  for (const [id, type, label] of TRIP_SERVICES) {
    g.add(id, type, { label });
    g.wire('entry.facts', `${id}.facts`);
    g.wire('entry.findings', `${id}.findings`);
  }
  g.add('byTrip', 'std.logic.choose', {
    label: 'Service for the Classification',
    config: {
      mode: 'byCase',
      type: T.service,
      cases: [{ when: 'scheduled' }, { when: 'treatNoTransport' }, { when: 'refusal' }]
    }
  });
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('deceased', 'billing.deceased-handling', { label: 'Deceased Handling (QL)' });
  g.add('agency', 'billing.agency-service', { label: 'Agency Service' });
  g.ret('return');
  g.wire('entry.classification', 'byTrip.key', 'agency.classification');
  g.wire('scheduled.service', 'byTrip.case1');
  g.wire('treatNoTransport.service', 'byTrip.case2');
  g.wire('refusal.service', 'byTrip.case3');
  g.wire('emergency.service', 'byTrip.otherwise');
  g.wire('entry.facts', 'facts.facts', 'agency.facts');
  g.wire('facts.trip', 'deceased.trip');
  g.wire('byTrip.value', 'deceased.service');
  g.wire('deceased.service', 'agency.service');
  g.wire('agency.service', 'return.service');
  return g.def;
};

const DIAGNOSES: ValueType = { list: { code: 'icd10' } };

const DIAGNOSES_OUT = d('diagnoses', DIAGNOSES, 'Diagnoses', 'ICD-10 diagnoses, primary first.');

const diagnosesFromImpressions = (): GraphDef => {
  const g = rule(
    [d('clinical', T.clinical, 'Clinical Facts', 'The primary and secondary impressions.')],
    [DIAGNOSES_OUT]
  );
  g.add('clinical', 'billing.clinical-facts.break', { label: 'Clinical Facts' });
  const primary = makeList(g, 'primary', 'Primary Impression', { code: 'icd10' }, [
    'clinical.primaryImpression'
  ]);
  g.add('diagnoses', 'std.list.concat', { label: 'With Secondary Impressions' });
  g.ret('return');
  g.wire('entry.clinical', 'clinical.clinical');
  g.wire(primary, 'diagnoses.list');
  g.wire('clinical.secondaryImpressions', 'diagnoses.other');
  g.wire('diagnoses.list', 'return.diagnoses');
  return g.def;
};

const assignDiagnoses = (): GraphDef => {
  const g = rule([P.facts()], [DIAGNOSES_OUT]);
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('impressions', 'billing.diagnoses-from-impressions', {
    label: 'Diagnoses from Coded Impressions'
  });
  g.add('agency', 'billing.agency-diagnoses', { label: 'Agency Diagnoses' });
  g.ret('return');
  g.wire('entry.facts', 'facts.facts', 'agency.facts');
  g.wire('facts.clinical', 'impressions.clinical');
  g.wire('impressions.diagnoses', 'agency.diagnoses');
  g.wire('agency.diagnoses', 'return.diagnoses');
  return g.def;
};

const FACTS_CONTEXT = P.facts(true);

export const serviceGraphs: SeedGraph[] = [
  slot(
    'billing.agency-classification',
    'Agency Classification',
    'An agency rule after the classification is decided: bill a kind of trip differently (a contract that bills standbys, say). Passes the classification through unchanged until an agency overrides it.',
    pureSlot(
      [
        d('classification', 'string', 'Classification', 'The classification the base rules chose.'),
        d('reason', 'string', 'Classified By', 'The rule that chose it.', true),
        FACTS_CONTEXT
      ],
      [
        d('classification', 'string', 'Classification', 'The classification to bill.'),
        d('reason', 'string', 'Classified By', 'Why, for the biller.', true)
      ]
    )
  ),
  slot(
    'billing.agency-service',
    'Agency Service',
    'An agency rule after the service is suggested for the classification: change the level, emergency status or miles a biller is asked to confirm. Passes the service through unchanged until an agency overrides it.',
    pureSlot(
      [
        d('service', T.service, 'Service', 'The service the base rules suggested.'),
        d('classification', 'string', 'Classification', 'The classification being billed.', true),
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
        d('diagnoses', DIAGNOSES, 'Diagnoses', 'The diagnoses the base rules assigned.'),
        FACTS_CONTEXT
      ],
      [d('diagnoses', DIAGNOSES, 'Diagnoses', 'The diagnoses to bill, primary first.')]
    )
  ),
  asRule(
    'billing.classification',
    'Classification',
    'Decides how the report is billed from its dispositions and type of service, with the rules that held: not billable when it was cancelled, an assist or standby, or a non-patient trip; else a refusal; else treated without transport; else scheduled for a scheduled or interfacility transport; else an emergency.',
    classification()
  ),
  asRule(
    'billing.classify-trip',
    'Classify Trip',
    'Classifies the trip from the encounter facts: the Classification rule, then the Agency Classification rule.',
    classifyTrip()
  ),
  asRule(
    'billing.loaded-miles',
    'Loaded Miles',
    'The destination odometer minus the scene odometer, never below zero, or nothing when either is missing. Pricing rounds the miles up to the next tenth of a mile.',
    loadedMiles()
  ),
  asRule(
    'billing.level-of-service',
    'Level of Service',
    'Decides SCT, else ALS2, else ALS1, else BLS from the level of care, the CMS service level, the ALS assessment, the coded medications given IV or IO that are not IV solutions (IV Solutions table), the coded ALS2 procedures (ALS2 Procedures table) and the narrative findings, with every rule that held. ALS crew staffing alone is not ALS1: CMS needs an ALS assessment or an ALS intervention (42 CFR 414.605).',
    levelOfService()
  ),
  asRule(
    'billing.emergency-status',
    'Emergency Status',
    "Decides whether the trip is billed as an emergency: the unit responded immediately, or no response mode was reported and the crew's CMS service level is an emergency one.",
    emergencyStatus()
  ),
  asRule(
    'billing.non-covered-miles',
    'Non-Covered Miles',
    'The miles past the closest hospital (ePayment.48) billed as non-covered on A0888 with GY, when the patient, the family or the physician chose a farther facility, by the transport reason or the reason for choosing the destination (eDisposition.20).',
    nonCoveredMiles()
  ),
  asRule(
    'billing.deceased-handling',
    'Deceased Handling (QL)',
    'Bills a patient pronounced dead after the call and before loading, before or after the unit reached them, as BLS with no loaded or non-covered miles, so the base rate carries QL (Benefit Policy Manual ch. 10 §10.2.6); a death after loading, when resuscitation went on, is billed as the service furnished.',
    deceasedHandling()
  ),
  asRule(
    'billing.base-service',
    'Base Service',
    'The service every classification starts from: Level of Service, Emergency Status, Loaded Miles and Non-Covered Miles.',
    baseService()
  ),
  asRule(
    'billing.service-without-miles',
    'Service Without Miles',
    'The same service with no loaded or non-covered miles, for trips that bill no mileage.',
    serviceWithoutMiles()
  ),
  asRule(
    'billing.trip-emergency',
    'Emergency Trip',
    'The service an emergency transport is billed for: the Base Service.',
    tripService(false)
  ),
  asRule(
    'billing.trip-scheduled',
    'Scheduled Trip',
    'The service a scheduled or interfacility transport is billed for: the Base Service, the same as an emergency transport.',
    tripService(false)
  ),
  asRule(
    'billing.trip-treat-no-transport',
    'Treat, No Transport',
    'The service a trip where the crew treated but did not transport is billed for: the Base Service without miles.',
    tripService(true)
  ),
  asRule(
    'billing.trip-refusal',
    'Refusal',
    'The service a trip where the patient refused care or transport is billed for: the Base Service without miles.',
    tripService(true)
  ),
  asRule(
    'billing.determine-service',
    'Determine Service',
    'Suggests the service for the classification (Emergency Trip, Scheduled Trip, Treat, No Transport or Refusal), bills a patient pronounced dead before loading as BLS without miles (Deceased Handling), then the Agency Service rule.',
    determineService()
  ),
  asRule(
    'billing.diagnoses-from-impressions',
    'Diagnoses from Coded Impressions',
    'The primary impression, then the secondary impressions, as ICD-10 diagnoses.',
    diagnosesFromImpressions()
  ),
  asRule(
    'billing.assign-diagnoses',
    'Assign Diagnoses',
    'Assigns the claim diagnoses: Diagnoses from Coded Impressions, then the Agency Diagnoses rule.',
    assignDiagnoses()
  ),
  asRule(
    'billing.classification-review',
    'Classification Needs Review',
    'Decides whether the report is too incomplete or contradictory to trust its classification: no disposition at all, a not-billable trip whose report documents medications or procedures, or a transport no disposition says this unit made. Reports are often fragmented, so only these cases go to a biller.',
    classificationReview()
  ),
  asStage(
    'billing.decide-claim',
    'Decide Whether to Claim',
    'Classifies the trip and logs the classification on the claim. A clear not-billable trip skips the claim with its reason logged; a report the Classification Needs Review rule doubts goes to a biller, whose decision is logged.',
    decideClaim()
  )
];
