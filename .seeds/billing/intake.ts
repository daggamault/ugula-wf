import {
  CLASSIFICATION_FIELD,
  LEVEL_FIELD,
  LOADED_MILES_FIELD,
  UNREAD_FINDINGS
} from '@ugula/billing';
import type { GraphDef, Json, ValueType } from '@ugula/graph';
import { PCR_TYPE } from '@ugula/nemsis';
import type { SeedGraph } from '../graphs.ts';
import { action, graph, p } from './glossary.ts';
import {
  ADDRESS_PINS,
  asRule,
  asStage,
  asWorkflow,
  type Builder,
  condition,
  d,
  type Fixed,
  firstOf,
  fixed,
  getField,
  isListed,
  joinText,
  keepListed,
  MEDICARE_CLAIM_FILINGS,
  makeList,
  makeObject,
  orElse,
  P,
  type Port,
  rule,
  select,
  shared,
  summary,
  T,
  template
} from './shared.ts';

const {
  blob: BLOB,
  demographics: DEMOGRAPHICS,
  patient: PATIENT,
  coverages: COVERAGES,
  service: SERVICE,
  findings: FINDINGS,
  facts: FACTS
} = T;

const PCR_PARTS = (PCR_TYPE as { object: Record<string, ValueType> }).object;

const VITAL = (PCR_PARTS.vitals as { list: ValueType }).list;

const COVERAGE = (COVERAGES as { list: ValueType }).list;

const CHOICE: ValueType = { object: { value: 'string', label: 'string' } };

const UNMATCHED_PAYER: ValueType = { object: { payer: 'string' } };

const MEDICATION: ValueType = {
  object: { medication: 'string', route: 'string', doses: 'integer' }
};

const CHANGE: ValueType = { object: { field: 'string', was: 'any', now: 'any' } };

const DETAILS: ValueType = {
  object: { name: 'string', birthDate: 'string', sex: 'string', address: 'string' }
};

const rows = (labels: Record<string, string>) =>
  Object.entries(labels).map(([key, value]) => ({ key, value }));

const sexLabels = () =>
  shared.lookup(
    'billing.sex-labels',
    'Sex Labels',
    'The meaning of each sex code a patient or report gives (F, M or U).',
    { type: 'string', rows: rows({ F: 'Female', M: 'Male', U: 'Unknown' }) }
  );

const responseModes = () =>
  shared.lookup(
    'billing.response-mode-labels',
    'Response Mode Labels',
    'The meaning of each NEMSIS response mode to the scene (eResponse.23).',
    {
      type: 'string',
      rows: rows({
        '2223001': 'Emergent',
        '2223003': 'Emergent, downgraded to non-emergent',
        '2223005': 'Non-emergent',
        '2223007': 'Non-emergent, upgraded to emergent'
      })
    }
  );

const levelsOfCare = () =>
  shared.lookup(
    'billing.level-of-care-labels',
    'Level of Care Labels',
    'The meaning of each NEMSIS level of care provided (eDisposition.32).',
    {
      type: 'string',
      rows: rows({
        '4232001': 'BLS',
        '4232003': 'ALS',
        '4232005': 'ALS',
        '4232009': 'Critical care'
      })
    }
  );

const PRIORITY_RANKS = [
  '2611003',
  '2611005',
  '2611007',
  '2611009',
  '2611011',
  '2611013',
  '2611015',
  '2611017',
  '2611019',
  '2611021',
  '2611023'
].map((key, value) => ({ key, value }));

const coveragePriority = () =>
  shared.lookup(
    'billing.coverage-priority',
    'Coverage Priority',
    'The billing order of each reported coverage priority (ePayment.10): primary first, then secondary and on. Coverages with other priorities come last, in the order reported.',
    { type: 'integer', rows: PRIORITY_RANKS, fallback: PRIORITY_RANKS.length }
  );

const use = (g: Builder, id: string, type: string, label: string, from: Record<string, Port>) => {
  g.add(id, type, { label });
  for (const [pin, port] of Object.entries(from)) g.wire(port, `${id}.${pin}`);
};

const nameOf = (g: Builder, id: string, label: string, person: Port) => {
  use(g, id, 'billing.person-name', label, { person });
  return `${id}.name` as const;
};

const subjectOf = (g: Builder, id: string, parts: Port[]) =>
  joinText(
    g,
    id,
    'Task Subject',
    ' · ',
    makeList(g, `${id}Parts`, 'PCR Number and Name', 'string', parts)
  );

const reportSubjectOf = (g: Builder, id: string, pcrNumber: Port, person: Port) => {
  use(g, id, 'billing.report-subject', 'Task Subject', { pcrNumber, person });
  return `${id}.subject` as const;
};

const PERSON = d(
  'person',
  { object: {} },
  'Person',
  'A patient, or the patient a report gives.',
  true
);

const personName = (): GraphDef => {
  const g = rule(
    [PERSON],
    [d('name', 'string', 'Name', 'The first and last name, such as Jane Doe.')]
  );
  const name = template(g, 'name', 'First and Last Name', '{person.firstName} {person.lastName}', {
    person: 'entry.person'
  });
  g.ret('return');
  g.wire(name, 'return.name');
  return g.def;
};

const reportSubject = (): GraphDef => {
  const g = rule(
    [
      p('pcrNumber', 'string', true),
      { ...PERSON, label: 'Patient', description: 'The patient the report gives.' }
    ],
    [
      d(
        'subject',
        'string',
        'Task Subject',
        'The PCR number and patient name, such as PCR-1001 · Jane Doe.'
      )
    ]
  );
  const name = nameOf(g, 'name', 'Patient Name', 'entry.person');
  g.ret('return');
  g.wire(subjectOf(g, 'subject', ['entry.pcrNumber', name]), 'return.subject');
  return g.def;
};

const patientDetails = (): GraphDef => {
  const g = rule(
    [d('person', DEMOGRAPHICS, 'Person', 'A patient, or the demographics a report gives.', true)],
    [
      d(
        'details',
        DETAILS,
        'Patient Details',
        'The name, birth date, sex and address, as a biller reads them.'
      )
    ]
  );
  g.add('parts', 'billing.demographics.break', { label: 'Demographics' });
  const name = nameOf(g, 'name', 'Name', 'entry.person');
  g.add('sex', 'std.table.lookup', { label: 'Sex in Words', config: sexLabels() });
  g.add('address', 'billing.place-text', { label: 'Address' });
  g.ret('return');
  g.wire('entry.person', 'parts.demographics', 'address.place');
  g.wire('parts.gender', 'sex.key');
  const details = makeObject(g, 'details', 'Patient Details', {
    name: ['string', name],
    birthDate: ['string', 'parts.birthDate'],
    sex: ['string', 'sex.value'],
    address: ['string', 'address.text']
  });
  g.wire(details, 'return.details');
  return g.def;
};

const patientMatchContext = (): GraphDef => {
  const g = rule(
    [
      d('reason', 'string', 'Match Reason', 'Why the report may be one of the candidates.', true),
      d('demographics', DEMOGRAPHICS, 'Reported Demographics', 'The patient on the report.', true),
      d('candidates', { list: PATIENT }, 'Candidates', 'The patients who may be them.', true),
      d('pcrNumber', 'string', 'PCR Number', 'The number of the patient care report.', true)
    ],
    [P.context()]
  );
  g.add('reported', 'billing.patient-details', { label: 'Reported Patient' });
  g.add('report', 'std.object.merge', { label: 'Reported Patient and PCR Number' });
  g.add('candidates', 'std.list.map-rule', {
    label: 'Candidate Details',
    config: { rule: 'billing.patient-details', version: 1, item: 'person' }
  });
  g.ret('return');
  g.wire('entry.demographics', 'reported.person');
  g.wire('reported.details', 'report.a');
  g.wire(
    makeObject(g, 'number', 'PCR Number', { pcrNumber: ['string', 'entry.pcrNumber'] }),
    'report.b'
  );
  g.wire('entry.candidates', 'candidates.list');
  const context = makeObject(g, 'context', 'Task Details', {
    reason: ['string', 'entry.reason'],
    report: [{ object: {} }, 'report.object'],
    candidates: [{ list: DETAILS }, 'candidates.details']
  });
  g.wire(context, 'return.context');
  return g.def;
};

const patientChoice = (): GraphDef => {
  const g = rule(
    [d('candidate', PATIENT, 'Candidate', 'A patient who may be the one on the report.', true)],
    [
      d(
        'choice',
        CHOICE,
        'Patient Choice',
        'The patient offered as a choice, named by name, birth date and ZIP code.'
      )
    ]
  );
  const id = getField(g, 'id', 'Patient ID', PATIENT, 'id', 'entry.candidate');
  const label = template(
    g,
    'label',
    'Name, Birth Date and ZIP',
    '{candidate.lastName}, {candidate.firstName} · born {candidate.birthDate}[ · {candidate.postalCode}]',
    { candidate: 'entry.candidate' }
  );
  g.ret('return');
  g.wire(
    makeObject(g, 'choice', 'Patient Choice', { value: ['string', id], label: ['string', label] }),
    'return.choice'
  );
  return g.def;
};

const payerNameKey = (): GraphDef => {
  const g = rule(
    [d('payer', UNMATCHED_PAYER, 'Unlinked Payer', 'A payer name the report gives.', true)],
    [
      d(
        'key',
        'string',
        'Name Key',
        'The payer name in lowercase, so the same name in any case groups together.'
      )
    ]
  );
  const name = getField(g, 'name', 'Payer Name', UNMATCHED_PAYER, 'payer', 'entry.payer');
  g.add('key', 'std.text.lower', { label: 'Name in Lowercase' });
  g.ret('return');
  g.wire(name, 'key.text');
  g.wire('key.result', 'return.key');
  return g.def;
};

const payerHasName = (): GraphDef => {
  const g = rule(
    [
      d('payer', UNMATCHED_PAYER, 'Unlinked Payer', 'A payer name the report gives.', true),
      d('name', 'string', 'Name Key', 'A payer name in lowercase.', true)
    ],
    [d('matches', 'boolean', 'Has the Name', 'Whether the payer has this name, ignoring case.')]
  );
  g.add('key', 'billing.payer-name-key', { label: 'Payer Name Key' });
  g.add('matches', 'std.logic.equal', { label: 'Same Name' });
  g.ret('return');
  g.wire('entry.payer', 'key.payer');
  g.wire('key.key', 'matches.a');
  g.wire('entry.name', 'matches.b');
  g.wire('matches.result', 'return.matches');
  return g.def;
};

const payerNameTask = (): GraphDef => {
  const g = rule(
    [
      d('name', 'string', 'Name Key', 'A payer name in lowercase.', true),
      d(
        'unmatched',
        { list: UNMATCHED_PAYER },
        'Unlinked Payers',
        'The payers on the report the payer directory does not know, each with the key of its coverage.',
        true
      )
    ],
    [
      d(
        'task',
        { object: {} },
        'Payer Name Task',
        'The first payer with the name, with the coverage keys of every payer that has it.'
      )
    ]
  );
  const byName = { rule: 'billing.payer-has-name', version: 1, item: 'payer', test: 'matches' };
  g.add('same', 'std.list.filter-rule', { label: 'All with the Name', config: byName });
  g.add('first', 'std.list.first', { label: 'First with the Name' });
  g.add('keys', 'std.list.pluck', { label: 'Their Coverage Keys', values: { field: 'key' } });
  g.add('task', 'std.object.merge', { label: 'First with Every Key' });
  g.ret('return');
  g.wire('entry.unmatched', 'same.list');
  g.wire('entry.name', 'same.name');
  g.wire('same.list', 'keys.list', 'first.list');
  g.wire('first.item', 'task.a');
  g.wire(
    makeObject(g, 'keyed', 'Coverage Keys', { keys: [{ list: 'string' }, 'keys.list'] }),
    'task.b'
  );
  g.wire('task.object', 'return.task');
  return g.def;
};

const isSuggestedPayer = (): GraphDef => {
  const g = rule(
    [
      d('choice', CHOICE, 'Directory Choice', 'A directory payer offered for a name.', true),
      d('suggested', 'string', 'Suggested Payer', 'The directory payer suggested, if any.', true)
    ],
    [d('isSuggested', 'boolean', 'Is Suggested', 'Whether this choice is the suggested payer.')]
  );
  const value = getField(g, 'value', 'Directory Payer', CHOICE, 'value', 'entry.choice');
  g.add('same', 'std.logic.equal', { label: 'Same Payer' });
  g.ret('return');
  g.wire(value, 'same.a');
  g.wire('entry.suggested', 'same.b');
  g.wire('same.result', 'return.isSuggested');
  return g.def;
};

const coverageDetails = (): GraphDef => {
  const g = rule(
    [d('coverage', COVERAGE, 'Coverage', 'A payer of the patient.', true)],
    [
      d(
        'details',
        { object: { payer: 'string', directory: 'string', memberId: 'string', groupId: 'string' } },
        'Coverage Details',
        'The payer as reported, its directory payer, member ID and group ID, as a biller reads them.'
      )
    ]
  );
  g.add('parts', 'billing.coverage.break', { label: 'Coverage' });
  const directory = orElse(
    g,
    'directory',
    'Directory Payer, Else Not Linked',
    'parts.directoryName',
    fixed('Not linked to the payer directory')
  );
  g.ret('return');
  g.wire('entry.coverage', 'parts.coverage');
  const details = makeObject(g, 'details', 'Coverage Details', {
    payer: ['string', 'parts.payer'],
    directory: ['string', directory],
    memberId: ['string', 'parts.memberId'],
    groupId: ['string', 'parts.groupId']
  });
  g.wire(details, 'return.details');
  return g.def;
};

const medicationText = (): GraphDef => {
  const g = rule(
    [d('medication', MEDICATION, 'Medication', 'A medication the narrative documents.', true)],
    [
      d(
        'text',
        'string',
        'Medication Text',
        'The medication and route, with the doses when more than one.'
      )
    ]
  );
  g.add('parts', 'std.object.break', {
    label: 'Medication',
    config: {
      fields: [
        { name: 'medication', type: 'string' },
        { name: 'route', type: 'string' },
        { name: 'doses', type: 'integer' }
      ]
    }
  });
  g.wire('entry.medication', 'parts.object');
  const several = condition(
    g,
    'several',
    'More Than One Dose',
    { doses: ['integer', 'parts.doses'] },
    [{ field: 'doses', op: 'gt', value: 1 }]
  );
  const doses = select(g, 'doses', 'Doses When Several', several, 'parts.doses');
  const text = template(g, 'text', 'Medication Text', '{medication} {route}[ x{doses}]', {
    medication: 'parts.medication',
    route: 'parts.route',
    doses
  });
  g.ret('return');
  g.wire(text, 'return.text');
  return g.def;
};

const VITAL_PARTS: [id: string, label: string, text: string][] = [
  ['heartRate', 'Heart Rate', '[HR {vital.heartRate}]'],
  ['respiratoryRate', 'Respiratory Rate', '[RR {vital.respiratoryRate}]'],
  ['pulseOximetry', 'Pulse Oximetry', '[SpO2 {vital.pulseOximetry}%]'],
  ['bloodGlucose', 'Blood Glucose', '[BGL {vital.bloodGlucose}]'],
  ['glasgowComaScore', 'Glasgow Coma Score', '[GCS {vital.glasgowComaScore}]']
];

const vitalSignsText = (): GraphDef => {
  const g = rule(
    [d('vital', VITAL, 'Vital Signs', 'One set of vital signs the report records.', true)],
    [
      d(
        'text',
        'string',
        'Vital Signs Text',
        'When they were taken and each reading, such as 10:42 · BP 120/80 · HR 88.'
      )
    ]
  );
  const takenAt = getField(g, 'takenAt', 'Time Taken', VITAL, 'takenAt', 'entry.vital');
  const diastolic = getField(g, 'diastolic', 'Diastolic', VITAL, 'diastolic', 'entry.vital');
  const bp = template(g, 'bloodPressure', 'Blood Pressure', '[BP {vital.systolic}/{diastolic}]', {
    vital: 'entry.vital',
    diastolic: orElse(
      g,
      'diastolicOrUnknown',
      'Diastolic, Else Unknown',
      diastolic,
      fixed('?'),
      'any'
    )
  });
  const readings = VITAL_PARTS.map(([id, label, text]) =>
    template(g, id, label, text, { vital: 'entry.vital' })
  );
  const list = makeList(g, 'readings', 'Time and Readings', 'string', [takenAt, bp, ...readings]);
  g.ret('return');
  g.wire(joinText(g, 'text', 'Vital Signs Text', ' · ', list), 'return.text');
  return g.def;
};

const reviewWarnings = (): GraphDef => {
  const g = rule(
    [
      P.reason(),
      P.classification(true),
      d(
        'documentation',
        T.documentation,
        'Documentation',
        'The signature, certification and trip documentation of the report, with the transport reason.',
        true
      ),
      P.service(true),
      d('vitals', { list: VITAL }, 'Vital Signs', 'The vital signs the report records.', true),
      P.findings(true),
      d('payerNotes', { list: 'string' }, 'Payer Notes', 'What limited matching the payers.', true)
    ],
    [
      d(
        'warnings',
        { list: 'string' },
        'Warnings',
        'What could not be read or decided, or needs care, for the reviewer.'
      )
    ]
  );
  g.add('docs', 'billing.documentation.break', { label: 'Documentation' });
  g.add('service', 'billing.service.break', { label: 'Suggested Service' });
  g.add('findings', 'billing.findings.break', { label: 'Narrative Findings' });
  g.wire('entry.documentation', 'docs.documentation');
  g.wire('entry.service', 'service.service');
  g.wire('entry.findings', 'findings.findings');
  const unclassified = select(
    g,
    'unclassifiedWarning',
    'Classified as Emergency Warning',
    condition(g, 'unclassified', 'Nothing Classified It', { reason: ['string', 'entry.reason'] }, [
      { field: 'reason', op: 'empty' }
    ]),
    fixed(
      'No disposition or type of service is recorded, so the trip was classified as an emergency transport'
    )
  );
  const unsigned = select(
    g,
    'unsignedWarning',
    'Signature Warning',
    condition(g, 'unsigned', 'Not Signed', { signature: ['string', 'docs.signature'] }, [
      { field: 'signature', op: 'isNot', value: 'signed' }
    ]),
    orElse(
      g,
      'signatureNote',
      'Signature Note, Else No Signature',
      'docs.signatureNote',
      fixed('No billing signature')
    )
  );
  const noPcs = select(
    g,
    'noPcsWarning',
    'Certification Warning',
    condition(
      g,
      'noPcs',
      'Scheduled Without Certification',
      {
        classification: ['string', 'entry.classification'],
        pcsOnFile: ['boolean', 'docs.pcsOnFile']
      },
      [
        { field: 'classification', op: 'is', value: 'scheduled' },
        { field: 'pcsOnFile', op: 'isNot', value: true }
      ]
    ),
    fixed('This scheduled trip has no physician certification statement')
  );
  const noVitals = select(
    g,
    'noVitalsWarning',
    'Vital Signs Warning',
    condition(g, 'noVitals', 'No Vital Signs', { vitals: [{ list: VITAL }, 'entry.vitals'] }, [
      { field: 'vitals', op: 'empty' }
    ]),
    fixed('No vital signs are recorded to support medical necessity')
  );
  const dead = select(
    g,
    'deceasedWarning',
    'Pronounced Dead Warning',
    condition(g, 'deceased', 'Pronounced Dead', { deceased: ['boolean', 'service.deceased'] }, [
      { field: 'deceased', op: 'is', value: true }
    ]),
    fixed(
      'The patient was pronounced dead before loading, so the trip is billed as BLS with QL and no mileage'
    )
  );
  const nonCovered = select(
    g,
    'nonCoveredWarning',
    'Non-Covered Miles Warning',
    condition(
      g,
      'nonCovered',
      'Has Non-Covered Miles',
      { miles: ['number', 'service.nonCoveredMiles'] },
      [{ field: 'miles', op: 'gt', value: 0 }]
    ),
    template(
      g,
      'nonCoveredText',
      'Non-Covered Miles Text',
      '{miles} miles past the closest hospital are billed as non-covered (A0888)',
      { miles: 'service.nonCoveredMiles' }
    )
  );
  const several = select(
    g,
    'severalWarning',
    'Several Patients Warning',
    condition(g, 'several', 'Several Patients', { count: ['integer', 'docs.patientCount'] }, [
      { field: 'count', op: 'gt', value: 1 }
    ]),
    template(
      g,
      'severalText',
      'Several Patients Text',
      '{count} patients rode on this trip, so its lines carry GM',
      { count: 'docs.patientCount' }
    )
  );
  const flagged = makeList(g, 'flagged', 'Warnings Found', 'string', [
    unclassified,
    unsigned,
    noPcs,
    noVitals,
    dead,
    nonCovered,
    several
  ]);
  g.add('warnings', 'std.list.join', {
    label: 'Every Warning',
    config: { count: 3, type: 'string' }
  });
  g.ret('return');
  g.wire(flagged, 'warnings.list1');
  g.wire('findings.notes', 'warnings.list2');
  g.wire('entry.payerNotes', 'warnings.list3');
  g.wire('warnings.list', 'return.warnings');
  return g.def;
};

const REVISION_FACTS: [name: string, type: ValueType, label: string, field: string][] = [
  ['patientName', 'string', 'Patient Name', 'Patient name'],
  ['birthDate', 'string', 'Birth Date', 'Birth date'],
  ['patientAddress', 'string', 'Patient Address', 'Patient address'],
  ['callTime', 'string', 'Call Time', 'Call time'],
  ['pickup', 'string', 'Pickup', 'Pickup'],
  ['destination', 'string', 'Destination', 'Destination'],
  ['primaryImpression', { code: 'icd10' }, 'Primary Impression', 'Primary impression'],
  ['otherImpressions', 'string', 'Other Impressions', 'Other impressions'],
  ['levelOfCare', 'string', 'Level of Care', 'Level of care'],
  ['responseMode', 'string', 'Response Mode', 'Response mode'],
  ['sceneOdometer', 'number', 'Scene Odometer', 'Scene odometer'],
  ['destinationOdometer', 'number', 'Destination Odometer', 'Destination odometer'],
  ['payers', 'string', 'Payers', 'Payers'],
  ['narrativeLength', 'integer', 'Narrative Length', 'Narrative']
];

const reportRevisionFacts = (): GraphDef => {
  const g = rule(
    [d('pcr', PCR_TYPE, 'PCR', 'A version of the patient care report.', true)],
    REVISION_FACTS.map(([name, type, label]) =>
      d(name, type, label, `The ${label.toLowerCase()} on this version of the report.`, true)
    )
  );
  const pcr: Port = 'entry.pcr';
  const at = (id: string, label: string, path: string) =>
    getField(g, id, label, PCR_TYPE, path, pcr);
  const place = (id: string, label: string, path: string) => {
    g.add(`${id}OrNone`, 'std.logic.coalesce', {
      label: `${label} Place, Else None`,
      values: { fallback: {} }
    });
    g.add(id, 'billing.place-text', { label });
    g.wire(at(`${id}Place`, `${label} Place`, path), `${id}OrNone.value`);
    g.wire(`${id}OrNone.result`, `${id}.place`);
    return `${id}.text` as const;
  };
  g.add('impressions', 'std.text.join', {
    label: 'Other Impressions',
    values: { separator: ', ' }
  });
  g.add('companies', 'std.list.pluck', { label: 'Payer Names', values: { field: 'companyName' } });
  g.add('payers', 'std.text.join', { label: 'Payers', values: { separator: ', ' } });
  g.add('narrative', 'std.logic.coalesce', {
    label: 'Narrative, Else Empty',
    values: { fallback: '' }
  });
  g.add('narrativeLength', 'std.text.length', { label: 'Narrative Length' });
  g.wire(
    at('secondary', 'Secondary Impressions', 'situation.secondaryImpressions'),
    'impressions.items'
  );
  g.wire(at('insurances', 'Insurances', 'insurances'), 'companies.list');
  g.wire('companies.list', 'payers.items');
  g.wire(at('narrativeText', 'Narrative Text', 'narrative'), 'narrative.value');
  g.wire('narrative.result', 'narrativeLength.text');
  const facts: Record<string, Port> = {
    patientName: nameOf(g, 'patientName', 'Patient Name', at('patient', 'Patient', 'patient')),
    birthDate: at('birthDate', 'Birth Date', 'patient.birthDate'),
    patientAddress: place('patientAddress', 'Patient Address', 'patient'),
    callTime: at('callTime', 'Call Time', 'times.psapCall'),
    pickup: place('pickup', 'Pickup', 'scene'),
    destination: place('destination', 'Destination', 'disposition'),
    primaryImpression: at('primaryImpression', 'Primary Impression', 'situation.primaryImpression'),
    otherImpressions: 'impressions.text',
    levelOfCare: at('levelOfCare', 'Level of Care', 'disposition.levelOfCare'),
    responseMode: at('responseMode', 'Response Mode', 'response.responseMode'),
    sceneOdometer: at('sceneOdometer', 'Scene Odometer', 'response.sceneOdometer'),
    destinationOdometer: at(
      'destinationOdometer',
      'Destination Odometer',
      'response.destinationOdometer'
    ),
    payers: 'payers.text',
    narrativeLength: 'narrativeLength.length'
  };
  g.ret('return');
  for (const [name, port] of Object.entries(facts)) g.wire(port, `return.${name}`);
  return g.def;
};

const revisionChange = (): GraphDef => {
  const g = rule(
    [
      d('field', 'string', 'Field', 'The billing detail that changed, such as Birth date.'),
      d('was', 'any', 'Was', 'The value on the earlier report.', true),
      d('now', 'any', 'Now', 'The value on the new report.', true)
    ],
    [
      d(
        'change',
        CHANGE,
        'Change',
        'The field with both values, or nothing when they are the same.',
        true
      )
    ]
  );
  g.add('differs', 'std.logic.not-equal', { label: 'Values Differ' });
  g.ret('return');
  g.wire('entry.was', 'differs.a');
  g.wire('entry.now', 'differs.b');
  const change = makeObject(g, 'change', 'Change', {
    field: ['string', 'entry.field'],
    was: ['any', 'entry.was'],
    now: ['any', 'entry.now']
  });
  g.wire(select(g, 'changed', 'Change, If Any', 'differs.result', change), 'return.change');
  return g.def;
};

const canReworkClaim = (): GraphDef => {
  const g = rule(
    [
      d('status', 'string', 'Claim Status', 'The status of the claim the new report revises.', true)
    ],
    [
      d(
        'canApply',
        'boolean',
        'Can Work Again',
        'Whether the claim can be worked again from the new report: it is a draft, needs review or is void.'
      )
    ]
  );
  const result = condition(
    g,
    'canApply',
    'Not Yet with Payers',
    { status: ['string', 'entry.status'] },
    [{ field: 'status', op: 'oneOf', value: ['draft', 'needs_review', 'void'] }]
  );
  g.ret('return');
  g.wire(result, 'return.canApply');
  return g.def;
};

const coverageBillingRank = (): GraphDef => {
  const g = rule(
    [
      d('coverage', COVERAGE, 'Coverage', 'A payer as resolved.', true),
      d(
        'medicareSecondary',
        'boolean',
        'Medicare Pays Second',
        'Another payer pays before Medicare, as the Medicare Secondary Payer rule decided.',
        true
      )
    ],
    [
      d(
        'ranked',
        { object: { coverage: COVERAGE, rank: 'number' } },
        'Ranked Coverage',
        'The coverage with its billing rank: lower ranks are billed first, and Medicare ranks after every other payer when it pays second.'
      )
    ]
  );
  g.add('parts', 'billing.coverage.break', { label: 'Coverage' });
  g.add('priority', 'std.table.lookup', { label: 'Coverage Priority', config: coveragePriority() });
  g.add('rank', 'std.math.add', { label: 'Billing Rank' });
  g.ret('return');
  g.wire('entry.coverage', 'parts.coverage');
  g.wire('parts.priority', 'priority.key');
  const medicareLast = condition(
    g,
    'medicareLast',
    'This Is Medicare and It Pays Second',
    {
      medicareSecondary: ['boolean', 'entry.medicareSecondary'],
      medicare: [
        'boolean',
        isListed(g, 'medicare', 'Medicare Payer', MEDICARE_CLAIM_FILINGS, 'parts.claimFiling')
      ]
    },
    [
      { field: 'medicareSecondary', op: 'is', value: true },
      { field: 'medicare', op: 'is', value: true }
    ]
  );
  g.wire('priority.value', 'rank.a');
  g.wire(
    select(
      g,
      'afterOthers',
      'Extra Rank to Bill Medicare Last',
      medicareLast,
      fixed(1000),
      fixed(0)
    ),
    'rank.b'
  );
  const ranked = makeObject(g, 'ranked', 'Ranked Coverage', {
    coverage: [COVERAGE, 'entry.coverage'],
    rank: ['number', 'rank.result']
  });
  g.wire(ranked, 'return.ranked');
  return g.def;
};

const reviewPatientMatch = (): GraphDef => {
  const g = action(
    [
      p('demographics', DEMOGRAPHICS),
      p('candidates', { list: PATIENT }),
      p('reason', 'string', true),
      p('pcrNumber', 'string', true)
    ],
    [p('patient', PATIENT)]
  );
  g.add('choiceList', 'std.list.map-rule', {
    label: 'Candidate Choices',
    config: { rule: 'billing.patient-choice', version: 1, item: 'candidate' }
  });
  const choices = makeObject(g, 'choices', 'Patient Choices', {
    patientId: [{ list: CHOICE }, 'choiceList.choice']
  });
  g.add('likeliest', 'std.list.first', { label: 'Likeliest Candidate' });
  const likeliest = getField(
    g,
    'likeliestId',
    'Likeliest Patient ID',
    PATIENT,
    'id',
    'likeliest.item'
  );
  const pick = makeObject(g, 'pick', 'Preselected Patient', {
    patientId: [{ id: 'patient' }, likeliest]
  });
  const match = {
    demographics: 'entry.demographics',
    candidates: 'entry.candidates',
    reason: 'entry.reason'
  } as const;
  use(g, 'context', 'billing.patient-match-context', 'Task Details', {
    ...match,
    pcrNumber: 'entry.pcrNumber'
  });
  use(g, 'confirmSummary', 'billing.patient-match-summary', 'Task Summary', match);
  const subject = reportSubjectOf(g, 'subject', 'entry.pcrNumber', 'entry.demographics');
  g.add('confirm', 'std.human.task', {
    label: 'Confirm Patient',
    config: {
      title: 'Confirm patient',
      queue: 'billing-patients',
      instructions:
        'Use the candidate that is this person, or create a new patient from the report when none of them is.',
      fields: [
        {
          name: 'patientId',
          type: { id: 'patient' },
          label: 'Candidate patient',
          required: ['useSelected']
        }
      ],
      outcomes: ['useSelected', 'createNew'],
      hints: {
        useSelected: 'Uses the chosen patient for this report and its claim.',
        createNew: "Creates a new patient from the report's details and uses it for the claim."
      },
      prefill: 'suggested'
    }
  });
  g.add('createNew', 'billing.create-patient', { label: 'Create New Patient' });
  g.add('find', 'billing.find-patient', { label: 'Find Chosen Patient' });
  g.ret('reviewed');
  g.ret('linked');
  g.wire('entry.exec', 'confirm.exec');
  g.wire('entry.candidates', 'choiceList.list', 'likeliest.list');
  g.wire('entry.demographics', 'createNew.demographics');
  g.wire(choices, 'confirm.options');
  g.wire(pick, 'confirm.defaults');
  g.wire('context.context', 'confirm.context');
  g.wire(subject, 'confirm.subject');
  g.wire('confirmSummary.summary', 'confirm.summary');
  g.wire('confirm.useSelected', 'find.exec');
  g.wire('confirm.patientId', 'find.patientId');
  g.wire('find.missing', 'confirm.exec');
  g.wire('confirm.createNew', 'createNew.exec');
  g.wire('createNew.invalid', 'confirm.exec');
  g.wire('createNew.created', 'reviewed.exec');
  g.wire('createNew.patient', 'reviewed.patient');
  g.wire('find.found', 'linked.exec');
  g.wire('find.patient', 'linked.patient');
  return g.def;
};

const patientMatchSummary = (): GraphDef => {
  const g = rule(
    [
      p('demographics', DEMOGRAPHICS, true),
      p('candidates', { list: PATIENT }, true),
      d('reason', 'string', 'Match Reason', 'Why the report may be one of the candidates.', true)
    ],
    [
      d(
        'summary',
        'string',
        'Task Summary',
        'What the Confirm Patient task asks a biller to decide.'
      )
    ]
  );
  const reported = nameOf(g, 'name', 'Reported Name', 'entry.demographics');
  const who = orElse(
    g,
    'who',
    'Reported Name, Else the Patient',
    reported,
    fixed('the patient on the report')
  );
  g.add('count', 'std.list.length', { label: 'How Many Candidates' });
  g.wire('entry.candidates', 'count.list');
  const existing = select(
    g,
    'existing',
    'An Existing Patient, Else One of Several',
    condition(g, 'oneOrNone', 'One Candidate at Most', { count: ['integer', 'count.length'] }, [
      { field: 'count', op: 'lte', value: 1 }
    ]),
    fixed('is an existing patient'),
    template(g, 'several', 'One of Several', 'is one of {count} existing patients', {
      count: 'count.length'
    })
  );
  const text = template(
    g,
    'summary',
    'Task Summary',
    'Decide whether {who}[, born {demographics.birthDate},] {existing}[ ({reason})], or create a new patient',
    { who, demographics: 'entry.demographics', existing, reason: 'entry.reason' }
  );
  g.ret('return');
  g.wire(text, 'return.summary');
  return g.def;
};

const MISSING_DETAILS: [pin: string, label: string, text: string][] = [
  ['firstName', 'First Name', 'first name'],
  ['lastName', 'Last Name', 'last name'],
  ['birthDate', 'Birth Date', 'birth date']
];

const missingDetailsSummary = (): GraphDef => {
  const g = rule(
    [d('demographics', DEMOGRAPHICS, 'Details to Complete', 'The patient details so far.', true)],
    [
      d(
        'summary',
        'string',
        'Task Summary',
        'What the Complete Patient Details task asks a biller to fill in.'
      )
    ]
  );
  g.add('details', 'billing.demographics.break', { label: 'Details to Complete' });
  g.wire('entry.demographics', 'details.demographics');
  const missing = makeList(
    g,
    'missing',
    'Missing Details',
    'string',
    MISSING_DETAILS.map(([pin, label, text]) =>
      select(
        g,
        `${pin}Missing`,
        `Missing ${label}`,
        condition(g, `${pin}Empty`, `No ${label}`, { value: ['string', `details.${pin}`] }, [
          { field: 'value', op: 'empty' }
        ]),
        fixed(text)
      )
    )
  );
  g.add('missingText', 'std.text.join', {
    label: 'Missing Details Text',
    values: { separator: ', ', last: ' and ' }
  });
  g.wire(missing, 'missingText.items');
  const text = select(
    g,
    'summary',
    'Task Summary',
    condition(g, 'noneMissing', 'Nothing Missing', { missing: [{ list: 'string' }, missing] }, [
      { field: 'missing', op: 'empty' }
    ]),
    fixed(
      'The patient name or birth date on the report is not valid; correct them so the patient can be matched or created'
    ),
    template(
      g,
      'missingSummary',
      'Missing Details Summary',
      'The report has no patient {missing}; fill in the details so the patient can be matched or created',
      { missing: 'missingText.text' }
    )
  );
  g.ret('return');
  g.wire(text, 'return.summary');
  return g.def;
};

const PATIENT_BASES = {
  matched: 'Matched an existing patient on name and birth date',
  created: 'No existing patient matched, so one was created from the report',
  reviewed: 'A biller chose between likely matches',
  completedMatched: 'Matched an existing patient on the details a biller completed',
  completedCreated: 'Created from the details a biller completed',
  completedReviewed: 'A biller chose between likely matches for the details they completed'
};

const resolvePatient = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [p('demographics', DEMOGRAPHICS), p('pcrNumber', 'string', true)],
      outputs: [
        p('patient', PATIENT),
        d(
          'basis',
          'string',
          'How It Was Found',
          'How the patient was found: matched, created from the report or chosen by a biller.'
        )
      ]
    },
    [{ name: 'entered', type: DEMOGRAPHICS, default: null }]
  );
  g.add('match', 'billing.match-patient', { label: 'Match Patient' });
  g.add('create', 'billing.create-patient', {
    label: 'Create Patient',
    values: { reuseMatch: true }
  });
  g.add('review', 'billing.review-patient-match', { label: 'Review Likely Matches' });
  g.add('context', 'billing.patient-match-context', { label: 'Task Details' });
  const subject = reportSubjectOf(g, 'subject', 'entry.pcrNumber', 'entry.demographics');
  g.add('completeSummary', 'billing.missing-details-summary', { label: 'Task Summary' });
  g.add('entered', 'std.var.get', { label: 'Details Entered Before', config: { name: 'entered' } });
  g.add('prefill', 'std.logic.coalesce', { label: 'Entered Before, Else the Report' });
  g.add('complete', 'std.human.task', {
    label: 'Complete Patient Details',
    config: {
      title: 'Complete patient details',
      queue: 'billing-patients',
      instructions:
        'The report is missing the name or birth date needed to find or create a patient, or one of them is not valid. Fill them in from the report, and the patient is matched or created from them.',
      fields: [
        { name: 'firstName', type: 'string', label: 'First name', required: ['savePatient'] },
        { name: 'lastName', type: 'string', label: 'Last name', required: ['savePatient'] },
        {
          name: 'birthDate',
          type: 'string',
          label: 'Birth date',
          format: 'date',
          required: ['savePatient']
        }
      ],
      outcomes: ['savePatient'],
      hints: {
        savePatient:
          'Matches or creates the patient from these details; a likely match opens a Confirm patient task.'
      },
      prefill: 'current'
    }
  });
  g.add('reported', 'billing.demographics.break', { label: 'Cleaned Demographics' });
  g.add('corrected', 'billing.demographics.make', { label: 'Completed Demographics' });
  g.add('remember', 'std.var.set', { label: 'Remember the Details', config: { name: 'entered' } });
  g.add('rematch', 'billing.match-patient', { label: 'Match Completed Patient' });
  g.add('createCompleted', 'billing.create-patient', {
    label: 'Create Completed Patient',
    values: { reuseMatch: true }
  });
  g.add('reviewCompleted', 'billing.review-patient-match', {
    label: 'Review Completed Matches'
  });
  for (const [id, basis] of Object.entries(PATIENT_BASES)) g.ret(id, undefined, { basis });
  g.wire('entry.exec', 'match.exec');
  g.wire('entry.demographics', 'match.demographics', 'create.demographics');
  g.wire('entry.pcrNumber', 'review.pcrNumber', 'reviewCompleted.pcrNumber');
  g.wire('entry.pcrNumber', 'context.pcrNumber');
  g.wire('match.matched', 'matched.exec');
  g.wire('match.patient', 'matched.patient');
  g.wire('match.unmatched', 'create.exec');
  g.wire('create.created', 'created.exec');
  g.wire('create.invalid', 'complete.exec');
  g.wire('create.patient', 'created.patient');
  g.wire('match.review', 'review.exec');
  g.wire('match.candidates', 'review.candidates', 'context.candidates');
  g.wire('match.reason', 'review.reason', 'context.reason');
  g.wire('match.demographics', 'review.demographics', 'context.demographics');
  g.wire('review.then', 'reviewed.exec');
  g.wire('review.patient', 'reviewed.patient');
  g.wire('match.incomplete', 'complete.exec');
  g.wire('context.context', 'complete.context');
  g.wire(subject, 'complete.subject');
  g.wire('entered.value', 'prefill.value');
  g.wire('match.demographics', 'prefill.fallback', 'reported.demographics');
  g.wire('prefill.result', 'complete.defaults', 'completeSummary.demographics');
  g.wire('completeSummary.summary', 'complete.summary');
  for (const pin of ['gender', ...ADDRESS_PINS]) {
    g.wire(`reported.${pin}`, `corrected.${pin}`);
  }
  for (const pin of ['firstName', 'lastName', 'birthDate']) {
    g.wire(`complete.${pin}`, `corrected.${pin}`);
  }
  g.wire('complete.savePatient', 'remember.exec');
  g.wire('corrected.demographics', 'remember.value');
  g.wire('remember.then', 'rematch.exec');
  g.wire('corrected.demographics', 'rematch.demographics');
  g.wire('rematch.matched', 'completedMatched.exec');
  g.wire('rematch.patient', 'completedMatched.patient');
  g.wire('rematch.unmatched', 'createCompleted.exec');
  g.wire('rematch.demographics', 'createCompleted.demographics', 'reviewCompleted.demographics');
  g.wire('createCompleted.created', 'completedCreated.exec');
  g.wire('createCompleted.invalid', 'complete.exec');
  g.wire('createCompleted.patient', 'completedCreated.patient');
  g.wire('rematch.review', 'reviewCompleted.exec');
  g.wire('rematch.candidates', 'reviewCompleted.candidates');
  g.wire('rematch.reason', 'reviewCompleted.reason');
  g.wire('reviewCompleted.then', 'completedReviewed.exec');
  g.wire('reviewCompleted.patient', 'completedReviewed.patient');
  g.wire('rematch.incomplete', 'complete.exec');
  return g.def;
};

const resolvePayers = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [
        p('coverages', COVERAGES),
        p('pcrNumber', 'string', true),
        p('patientName', 'string', true)
      ],
      outputs: [p('coverages', COVERAGES), p('notes', { list: 'string' })]
    },
    [{ name: 'removed', type: { list: 'string' }, default: [] }]
  );
  g.add('match', 'billing.match-payers', { label: 'Match Payers' });
  g.add('names', 'std.list.map-rule', {
    label: 'Payer Name Keys',
    config: { rule: 'billing.payer-name-key', version: 1, item: 'payer' }
  });
  g.add('distinct', 'std.list.unique', { label: 'Each Name Once' });
  g.add('byName', 'std.list.map-rule', {
    label: 'One Task per Payer Name',
    config: { rule: 'billing.payer-name-task', version: 1, item: 'name' }
  });
  g.add('each', 'std.flow.for-each', { label: 'Each Unlinked Payer Name' });
  g.add('unlinked', 'std.object.break', {
    label: 'Unlinked Payer Name',
    config: {
      fields: [
        { name: 'payer', type: 'string' },
        { name: 'memberId', type: 'string' },
        { name: 'suggested', type: 'string' },
        { name: 'candidates', type: { list: CHOICE } },
        { name: 'notes', type: { list: 'string' } },
        { name: 'keys', type: { list: 'string' } }
      ]
    }
  });
  const choices = select(
    g,
    'choices',
    'Directory Choices',
    condition(
      g,
      'hasChoices',
      'Has Directory Choices',
      { candidates: [{ list: CHOICE }, 'unlinked.candidates'] },
      [{ field: 'candidates', op: 'present' }]
    ),
    makeObject(g, 'choicesByField', 'Payer Choices', {
      payerId: [{ list: CHOICE }, 'unlinked.candidates']
    })
  );
  const suggestion = makeObject(g, 'suggestion', 'Suggested Payer', {
    payerId: ['string', 'unlinked.suggested']
  });
  const context = makeObject(g, 'context', 'Task Details', {
    reportedPayer: ['string', 'unlinked.payer'],
    memberId: ['string', 'unlinked.memberId'],
    patient: ['string', 'entry.patientName'],
    pcrNumber: ['string', 'entry.pcrNumber'],
    notes: [{ list: 'string' }, 'unlinked.notes']
  });
  const subject = subjectOf(g, 'subject', ['entry.pcrNumber', 'unlinked.payer']);
  g.add('likely', 'std.list.find-rule', {
    label: 'Suggested Choice',
    config: { rule: 'billing.is-suggested-payer', version: 1, item: 'choice', test: 'isSuggested' }
  });
  const likely = getField(g, 'likelyName', 'Likely Payer', CHOICE, 'label', 'likely.item');
  g.add('confirm', 'std.human.task', {
    label: 'Match Payer',
    config: {
      title: 'Match payer',
      queue: 'billing-payers',
      instructions:
        'The report names a payer that is not in the payer directory by that name. Choose the directory payer it means, and later reports with this name link automatically; similar payers come first with how close they are. Mark it unlisted when the payer is real but not in the directory yet, or remove it when it is not insurance (self pay, unknown).',
      fields: [
        { name: 'payerId', type: { id: 'payer' }, label: 'Directory payer', required: ['link'] }
      ],
      outcomes: ['link', 'unlisted', 'remove'],
      hints: {
        link: 'Links this payer name to the directory payer; later reports with this name link automatically.',
        unlisted:
          'Keeps the payer on the claim without a directory link until it is added to the directory.',
        remove: 'Leaves every payer with this name off the claim.'
      },
      prefill: 'suggested'
    }
  });
  g.add('link', 'billing.link-payer', { label: 'Link Payer Name' });
  g.add('leaveOut', 'std.list.join', {
    label: 'Coverages Left Out',
    config: { count: 2, type: 'string' }
  });
  g.add('remove', 'std.var.set', {
    label: 'Leave Out the Coverages with This Name',
    config: { name: 'removed' }
  });
  g.add('removed', 'std.var.get', {
    label: 'Coverages Left Out So Far',
    config: { name: 'removed' }
  });
  g.add('rematch', 'billing.match-payers', {
    label: 'Match Reviewed Payers',
    values: { suggest: false }
  });
  g.ret('matched');
  g.ret('reviewed');
  g.wire('entry.exec', 'match.exec');
  g.wire('entry.coverages', 'match.coverages', 'rematch.coverages');
  g.wire('match.matched', 'matched.exec');
  g.wire('match.coverages', 'matched.coverages');
  g.wire('match.notes', 'matched.notes');
  g.wire('match.review', 'each.exec');
  g.wire('match.unmatched', 'names.list', 'byName.unmatched');
  g.wire('names.key', 'distinct.list');
  g.wire('distinct.list', 'byName.list');
  g.wire('byName.task', 'each.list');
  g.wire('each.body', 'confirm.exec');
  g.wire('each.item', 'unlinked.object');
  g.wire('unlinked.candidates', 'likely.list');
  g.wire('unlinked.suggested', 'likely.suggested');
  g.wire(choices, 'confirm.options');
  g.wire(suggestion, 'confirm.defaults');
  g.wire(context, 'confirm.context');
  g.wire(subject, 'confirm.subject');
  summary(
    g,
    'confirm',
    'Link the reported payer "{payer}" to a directory payer[ (likely {likely})], mark it unlisted, or remove it if it is not insurance',
    { payer: 'unlinked.payer', likely }
  );
  g.wire('confirm.link', 'link.exec');
  g.wire('unlinked.payer', 'link.name');
  g.wire('confirm.payerId', 'link.payerId');
  g.wire('link.invalid', 'confirm.exec');
  g.wire('confirm.remove', 'remove.exec');
  g.wire('removed.value', 'leaveOut.list1');
  g.wire('unlinked.keys', 'leaveOut.list2');
  g.wire('leaveOut.list', 'remove.value');
  g.wire('removed.value', 'rematch.exclude');
  g.wire('each.completed', 'rematch.exec');
  g.wire('rematch.matched', 'reviewed.exec');
  g.wire('rematch.review', 'reviewed.exec');
  g.wire('rematch.coverages', 'reviewed.coverages');
  g.wire('match.notes', 'reviewed.notes');
  return g.def;
};

const REVIEW_FIELDS = [
  { ...CLASSIFICATION_FIELD, required: ['approve'] },
  { ...LEVEL_FIELD, required: ['approve'] },
  { name: 'emergency', type: 'boolean', label: 'Emergency response' },
  LOADED_MILES_FIELD,
  { name: 'note', type: 'string', label: 'Note' }
];

const pcrSubject = (): GraphDef => {
  const g = rule([p('pcr', PCR_TYPE)], [p('subject', 'string')]);
  const number = getField(g, 'number', 'PCR Number', PCR_TYPE, 'pcrNumber', 'entry.pcr');
  const patient = getField(g, 'patient', 'Patient', PCR_TYPE, 'patient', 'entry.pcr');
  g.ret('return');
  g.wire(reportSubjectOf(g, 'subject', number, patient), 'return.subject');
  return g.def;
};

const tripSummary = (): GraphDef => {
  const g = rule(
    [p('pcr', PCR_TYPE), p('classification', 'string', true), p('reason', 'string', true)],
    [p('trip', { object: {} })]
  );
  const pcr: Port = 'entry.pcr';
  const at = (id: string, label: string, path: string) =>
    getField(g, id, label, PCR_TYPE, path, pcr);
  const labelled = (id: string, label: string, code: Port, config: Json) => {
    g.add(`${id}Label`, 'std.table.lookup', { label: `${label} Label`, config });
    g.wire(code, `${id}Label.key`);
    return orElse(g, id, `${label}, Else Its Code`, `${id}Label.value`, code);
  };
  const place = (id: string, label: string, path: string) => {
    g.add(id, 'billing.place-text', { label });
    g.wire(at(`${id}Place`, `${label} Place`, path), `${id}.place`);
    return `${id}.text` as const;
  };
  const destination = joinText(
    g,
    'destination',
    'Destination',
    ' · ',
    makeList(g, 'destinationParts', 'Destination Name and Place', 'string', [
      at('destinationName', 'Destination Name', 'disposition.destinationName'),
      place('destinationPlace', 'Destination Address', 'disposition')
    ])
  );
  const trip = makeObject(g, 'trip', 'Trip Summary', {
    pcrNumber: ['string', at('pcrNumber', 'PCR Number', 'pcrNumber')],
    classification: ['string', 'entry.classification'],
    classifiedBy: ['string', 'entry.reason'],
    calledAt: ['string', at('calledAt', 'Call Time', 'times.psapCall')],
    response: [
      'string',
      labelled(
        'response',
        'Response',
        at('responseMode', 'Response Mode', 'response.responseMode'),
        responseModes()
      )
    ],
    careProvided: [
      'string',
      labelled(
        'careProvided',
        'Care Provided',
        at('levelOfCare', 'Level of Care', 'disposition.levelOfCare'),
        levelsOfCare()
      )
    ],
    primaryImpression: [
      { code: 'icd10' },
      at('primaryImpression', 'Primary Impression', 'situation.primaryImpression')
    ],
    otherImpressions: [
      { list: { code: 'icd10' } },
      at('otherImpressions', 'Other Impressions', 'situation.secondaryImpressions')
    ],
    pickup: ['string', place('pickup', 'Pickup', 'scene')],
    destination: ['string', destination]
  });
  g.ret('return');
  g.wire(trip, 'return.trip');
  return g.def;
};

const readFindings = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [p('narrative', 'string', true)],
      outputs: [p('findings', FINDINGS)]
    },
    [{ name: 'findings', type: FINDINGS, default: UNREAD_FINDINGS }]
  );
  g.add('try', 'std.flow.try', { label: 'Read the Narrative If the Model Is Up' });
  g.add('read', 'billing.read-narrative', {
    label: 'Read the Narrative',
    retry: { max: 3, delayMs: 30_000, factor: 4 }
  });
  g.add('keep', 'std.var.set', { label: 'Keep the Findings', config: { name: 'findings' } });
  g.add('findings', 'std.var.get', { label: 'Findings', config: { name: 'findings' } });
  g.ret('done');
  g.wire('entry.exec', 'try.exec');
  g.wire('try.try', 'read.exec');
  g.wire('entry.narrative', 'read.narrative');
  g.wire('read.then', 'keep.exec');
  g.wire('read.findings', 'keep.value');
  g.wire('try.then', 'done.exec');
  g.wire('try.catch', 'done.exec');
  g.wire('findings.value', 'done.findings');
  return g.def;
};

const claimPatient = (): GraphDef => {
  const g = action(
    [
      p('demographics', DEMOGRAPHICS),
      p('pcrNumber', 'string', true),
      p('claimId', { id: 'claim' })
    ],
    [p('patient', PATIENT)]
  );
  g.add('resolve', 'billing.resolve-patient', { label: 'Resolve Patient' });
  g.add('address', 'billing.update-patient-address', { label: 'Current Patient Address' });
  g.add('assign', 'billing.assign-patient', { label: 'Assign Patient to Claim' });
  const name = nameOf(g, 'name', 'Patient Name', 'address.patient');
  g.add('log', 'billing.record-decision', { label: 'Log the Patient' });
  g.ret('done');
  g.wire('entry.exec', 'resolve.exec');
  g.wire('entry.demographics', 'resolve.demographics', 'address.demographics');
  g.wire('entry.pcrNumber', 'resolve.pcrNumber');
  g.wire('resolve.then', 'address.exec');
  g.wire('resolve.patient', 'address.patient');
  g.wire('address.then', 'assign.exec');
  g.wire('address.patient', 'assign.patient', 'done.patient');
  g.wire('entry.claimId', 'assign.claimId', 'log.claimId');
  g.wire('assign.then', 'log.exec');
  g.wire(
    template(g, 'decision', 'Patient Decision', 'Patient is {name}', { name }),
    'log.decision'
  );
  g.wire('resolve.basis', 'log.reason');
  g.wire('log.then', 'done.exec');
  return g.def;
};

const reviewPcrDetails = (): GraphDef => {
  const g = rule(
    [
      p('trip', { object: {} }, true),
      p('pcr', PCR_TYPE, true),
      p('facts', FACTS, true),
      p('classification', 'string', true),
      p('reason', 'string', true),
      p('patient', PATIENT, true),
      p('coverages', COVERAGES, true),
      p('payerNotes', { list: 'string' }, true),
      p('findings', FINDINGS, true),
      p('service', SERVICE, true)
    ],
    [P.context()]
  );
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('reasonForTransport', 'billing.transport-reason', { label: 'Transport Reason' });
  g.add('documentation', 'std.object.set', {
    label: 'Documentation with the Transport Reason',
    values: { path: 'transportReason' }
  });
  g.add('patient', 'billing.patient-details', { label: 'Patient Details' });
  g.add('coverage', 'std.list.map-rule', {
    label: 'Coverage Details',
    config: { rule: 'billing.coverage-details', version: 1, item: 'coverage' }
  });
  g.add('findings', 'billing.findings.break', { label: 'Narrative Findings' });
  g.add('medications', 'std.list.map-rule', {
    label: 'Medications Given',
    config: { rule: 'billing.medication-text', version: 1, item: 'medication' }
  });
  const pcrField = (id: string, label: string, path: string) =>
    getField(g, id, label, PCR_TYPE, path, 'entry.pcr');
  const vitals = pcrField('vitals', 'Vital Signs', 'vitals');
  g.add('vitalTexts', 'std.list.map-rule', {
    label: 'Each Set of Vital Signs',
    config: { rule: 'billing.vital-signs-text', version: 1, item: 'vital' }
  });
  g.add('proceduresCoded', 'std.list.pluck', {
    label: 'Procedures Coded',
    values: { field: 'procedure' }
  });
  g.add('docs', 'billing.documentation.break', { label: 'Documentation' });
  use(g, 'warnings', 'billing.review-warnings', 'Review Warnings', {
    documentation: 'documentation.object',
    classification: 'entry.classification',
    reason: 'entry.reason',
    findings: 'entry.findings',
    vitals,
    payerNotes: 'entry.payerNotes',
    service: 'entry.service'
  });
  const narrative = makeObject(g, 'narrative', 'Narrative', {
    medications: [{ list: 'string' }, 'medications.text'],
    procedures: [{ list: 'string' }, 'findings.procedures']
  });
  const illness = makeObject(g, 'condition', 'Condition', {
    complaint: ['string', pcrField('complaint', 'Complaint', 'situation.complaint')],
    primarySymptom: [
      'string',
      pcrField('primarySymptom', 'Primary Symptom', 'situation.primarySymptom')
    ],
    vitals: [{ list: 'string' }, 'vitalTexts.text'],
    proceduresCoded: [{ list: 'string' }, 'proceduresCoded.list']
  });
  const documentation = makeObject(g, 'documented', 'Documentation Details', {
    signature: ['string', 'docs.signature'],
    signatureNote: ['string', 'docs.signatureNote'],
    physicianCertification: ['boolean', 'docs.pcsOnFile'],
    transportReason: ['string', 'docs.transportReason'],
    conditionCodes: [{ list: 'string' }, 'docs.conditionCodes'],
    patientsTransported: ['integer', 'docs.patientCount'],
    mspAccident: ['string', 'docs.mspAccident']
  });
  const context = makeObject(g, 'context', 'Task Details', {
    patient: [{ object: {} }, 'patient.details'],
    trip: [{ object: {} }, 'entry.trip'],
    coverage: [{ list: { object: {} } }, 'coverage.details'],
    narrative: [{ object: {} }, narrative],
    condition: [{ object: {} }, illness],
    documentation: [{ object: {} }, documentation],
    suggested: [SERVICE, 'entry.service'],
    warnings: [{ list: 'string' }, 'warnings.warnings']
  });
  g.ret('return');
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.documentation', 'reasonForTransport.documentation', 'documentation.object');
  g.wire('facts.locations', 'reasonForTransport.locations');
  g.wire('reasonForTransport.transportReason', 'documentation.value');
  g.wire('documentation.object', 'docs.documentation');
  g.wire('entry.patient', 'patient.person');
  g.wire('entry.coverages', 'coverage.list');
  g.wire('entry.findings', 'findings.findings');
  g.wire('findings.medications', 'medications.list');
  g.wire(vitals, 'vitalTexts.list');
  g.wire(pcrField('procedures', 'Procedures', 'procedures'), 'proceduresCoded.list');
  g.wire(context, 'return.context');
  return g.def;
};

const serviceText = (): GraphDef => {
  const g = rule(
    [P.classification(true), P.service(true)],
    [
      d(
        'text',
        'string',
        'Service Text',
        'The kind of trip, level, emergency, loaded miles and a death before loading, such as ALS1, emergency, 12.4 loaded miles.'
      )
    ]
  );
  g.add('suggested', 'billing.service.break', { label: 'Service' });
  g.add('tripKind', 'std.logic.choose', {
    label: 'Kind of Trip',
    config: {
      mode: 'byCase',
      type: 'string',
      cases: [
        { when: 'scheduled' },
        { when: 'treatNoTransport' },
        { when: 'refusal' },
        { when: 'notBillable' }
      ]
    },
    values: {
      case1: 'scheduled trip',
      case2: 'treat-no-transport',
      case3: 'refusal',
      case4: 'not billable'
    }
  });
  g.add('emergencyText', 'std.logic.choose', {
    label: 'Emergency or Not',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }, { when: 'false' }] },
    values: { case1: 'emergency', case2: 'non-emergency' }
  });
  g.add('roundedMiles', 'std.math.round', {
    label: 'Loaded Miles to a Tenth',
    values: { digits: 1 }
  });
  g.add('deceasedText', 'std.logic.choose', {
    label: 'Pronounced Dead Text',
    config: { mode: 'byCase', type: 'string', cases: [{ when: 'true' }] },
    values: { case1: 'pronounced dead before loading' }
  });
  g.wire('entry.service', 'suggested.service');
  g.wire('entry.classification', 'tripKind.key');
  g.wire('suggested.emergency', 'emergencyText.key');
  g.wire('suggested.loadedMiles', 'roundedMiles.value');
  g.wire('suggested.deceased', 'deceasedText.key');
  const parts = makeList(g, 'serviceParts', 'Service Parts', 'string', [
    'tripKind.value',
    'suggested.level',
    'emergencyText.value',
    template(g, 'milesText', 'Loaded Miles Text', '[{miles} loaded miles]', {
      miles: 'roundedMiles.result'
    }),
    'deceasedText.value'
  ]);
  g.ret('return');
  g.wire(joinText(g, 'text', 'Service Text', ', ', parts), 'return.text');
  return g.def;
};

const reviewPcrSummary = (): GraphDef => {
  const g = rule(
    [P.classification(true), P.service(true), P.findings(true)],
    [
      d(
        'summary',
        'string',
        'Task Summary',
        'What the Review PCR task asks a biller to confirm, with the suggested service.'
      )
    ]
  );
  g.add('findings', 'billing.findings.break', { label: 'Narrative Findings' });
  g.wire('entry.findings', 'findings.findings');
  use(g, 'service', 'billing.service-text', 'Suggested Service Text', {
    classification: 'entry.classification',
    service: 'entry.service'
  });
  const fromNarrative = select(
    g,
    'fromNarrative',
    'Suggested from the Narrative',
    condition(
      g,
      'narrativeFound',
      'Narrative Documents Care',
      {
        medications: [{ list: MEDICATION }, 'findings.medications'],
        procedures: [{ list: 'string' }, 'findings.procedures']
      },
      [
        { field: 'medications', op: 'present' },
        { field: 'procedures', op: 'present' }
      ],
      'any'
    ),
    fixed(', suggested from the narrative')
  );
  const text = select(
    g,
    'summary',
    'Task Summary',
    condition(g, 'nothingSuggested', 'Nothing Suggested', { text: ['string', 'service.text'] }, [
      { field: 'text', op: 'empty' }
    ]),
    fixed(
      'Confirm the classification, level of service and loaded miles before this claim is priced'
    ),
    template(
      g,
      'confirmService',
      'Confirm the Service',
      'Confirm the service: {parts}{narrative}, before this claim is priced',
      {
        parts: 'service.text',
        narrative: fromNarrative
      }
    )
  );
  g.ret('return');
  g.wire(text, 'return.summary');
  return g.def;
};

const reviewPcr = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['approved', 'voided'],
      inputs: [
        p('pcr', PCR_TYPE),
        p('facts', FACTS),
        p('classification', 'string'),
        p('reason', 'string', true),
        p('patient', PATIENT),
        p('coverages', COVERAGES),
        p('payerNotes', { list: 'string' }),
        p('findings', FINDINGS),
        p('service', SERVICE),
        p('answers', { object: {} }, true)
      ],
      outputs: [
        p('classification', 'string', true),
        p('service', SERVICE, true),
        p('answers', { object: {} }, true)
      ]
    },
    [{ name: 'answers', type: { object: {} }, default: null }]
  );
  g.add('start', 'std.var.set', {
    label: 'Keep the Answers Given Before',
    config: { name: 'answers' }
  });
  g.add('answers', 'std.var.get', { label: 'Answers So Far', config: { name: 'answers' } });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  use(g, 'details', 'billing.review-pcr-details', 'Task Details', {
    trip: 'trip.trip',
    pcr: 'entry.pcr',
    facts: 'entry.facts',
    classification: 'entry.classification',
    reason: 'entry.reason',
    patient: 'entry.patient',
    coverages: 'entry.coverages',
    payerNotes: 'entry.payerNotes',
    findings: 'entry.findings',
    service: 'entry.service'
  });
  use(g, 'reviewSummary', 'billing.review-pcr-summary', 'Task Summary', {
    classification: 'entry.classification',
    service: 'entry.service',
    findings: 'entry.findings'
  });
  g.add('classified', 'std.object.set', {
    label: 'Suggestion with the Classification',
    values: { path: 'classification' }
  });
  g.add('answered', 'std.object.compact', { label: 'Answers Given' });
  g.add('defaults', 'std.object.merge', { label: 'Answers Before, Else the Suggestion' });
  g.add('review', 'std.human.task', {
    label: 'Review PCR',
    config: {
      title: 'Review PCR',
      queue: 'billing-review',
      instructions:
        'Check the patient, payers and impression codes, and confirm the classification, level of service and loaded miles before this claim is priced. The suggestion lists what supports it, including what the narrative documents; warnings say what could not be read or decided.',
      fields: REVIEW_FIELDS,
      outcomes: ['approve', 'hold'],
      hints: {
        approve:
          'Confirms the classification, level of service and loaded miles; the claim is priced next.',
        hold: 'Holds the PCR in a Held PCR task until it is released back to review or voided.'
      },
      prefill: 'suggested'
    }
  });
  const given = makeObject(g, 'given', 'Review Answers', {
    classification: ['string', 'review.classification'],
    level: ['string', 'review.level'],
    emergency: ['boolean', 'review.emergency'],
    loadedMiles: ['number', 'review.loadedMiles'],
    note: ['string', 'review.note']
  });
  g.add('remember', 'std.var.set', { label: 'Remember the Answers', config: { name: 'answers' } });
  const holdContext = makeObject(g, 'holdContext', 'Hold Task Details', {
    note: ['string', 'review.note'],
    patient: ['string', nameOf(g, 'patientName', 'Patient Name', 'entry.patient')],
    trip: [{ object: {} }, 'trip.trip']
  });
  g.add('held', 'std.human.task', {
    label: 'Held PCR',
    config: {
      title: 'Held PCR',
      queue: 'billing-holds',
      instructions:
        'A reviewer held this PCR. Release it back to review once the report is sorted out, or void it so it is never billed.',
      outcomes: ['release', 'void'],
      hints: {
        release: 'Sends the PCR back to review, with the answers given before.',
        void: 'Voids the claim so it is never billed.'
      }
    }
  });
  g.add('confirmed', 'billing.confirmed-service', { label: 'Confirmed Service' });
  g.ret('approvedDone', 'approved');
  g.ret('voidedDone', 'voided');

  g.wire('entry.exec', 'start.exec');
  g.wire('entry.answers', 'start.value');
  g.wire('start.then', 'review.exec');
  g.wire('entry.pcr', 'trip.pcr', 'subject.pcr');
  g.wire('entry.classification', 'trip.classification', 'classified.value');
  g.wire('entry.reason', 'trip.reason');
  g.wire('entry.service', 'classified.object');
  g.wire('classified.object', 'defaults.a');
  g.wire('answers.value', 'answered.object');
  g.wire('answered.object', 'defaults.b');
  g.wire('defaults.object', 'review.defaults');
  g.wire('details.context', 'review.context');
  g.wire('reviewSummary.summary', 'review.summary');
  g.wire('subject.subject', 'review.subject', 'held.subject');

  g.wire('review.hold', 'remember.exec');
  g.wire(given, 'remember.value', 'approvedDone.answers');
  g.wire('remember.then', 'held.exec');
  g.wire(holdContext, 'held.context');
  g.wire(
    template(
      g,
      'heldSummary',
      'Hold Summary',
      'This PCR is on hold[: {note}]; release it back to review once it is sorted out, or void it',
      { note: 'review.note' }
    ),
    'held.summary'
  );
  g.wire('held.release', 'review.exec');
  g.wire('held.void', 'voidedDone.exec');

  g.wire('review.approve', 'approvedDone.exec');
  g.wire('review.classification', 'approvedDone.classification');
  g.wire('entry.service', 'confirmed.service');
  g.wire('entry.facts', 'confirmed.facts');
  g.wire('review.classification', 'confirmed.classification');
  g.wire('review.level', 'confirmed.level');
  g.wire('review.emergency', 'confirmed.emergency');
  g.wire('review.loadedMiles', 'confirmed.loadedMiles');
  g.wire('confirmed.service', 'approvedDone.service');
  return g.def;
};

const startCycle = (): GraphDef => {
  const g = action([p('claimId', { id: 'claim' })], [p('runId', { id: 'run' })]);
  const inputs = makeObject(g, 'inputs', 'Cycle Inputs', {
    claimId: [{ id: 'claim' }, 'entry.claimId']
  });
  g.add('cycle', 'std.flow.start-workflow', {
    label: 'Start Payer Cycle',
    config: { workflow: 'billing.cycle-claim', version: 1 }
  });
  g.add('attach', 'billing.attach-cycle', { label: 'Link Claim to Its Cycle' });
  g.ret('done');
  g.wire('entry.exec', 'cycle.exec');
  g.wire('entry.claimId', 'attach.claimId');
  g.wire(inputs, 'cycle.inputs');
  g.wire('cycle.then', 'attach.exec');
  g.wire('cycle.runId', 'attach.cycleRunId', 'done.runId');
  g.wire('attach.then', 'done.exec');
  return g.def;
};

const reworkClaim = (): GraphDef => {
  const g = action(
    [p('report', BLOB, true), p('claimId', { id: 'claim' })],
    [p('runId', { id: 'run' })]
  );
  const inputs = makeObject(g, 'inputs', 'Run Inputs', {
    report: [BLOB, 'entry.report'],
    claimId: [{ id: 'claim' }, 'entry.claimId']
  });
  g.add('restart', 'std.flow.start-workflow', {
    label: 'Work the Claim from Its Report',
    config: { workflow: 'billing.encounter-to-claim', version: 1 }
  });
  g.ret('done');
  g.wire('entry.exec', 'restart.exec');
  g.wire(inputs, 'restart.inputs');
  g.wire('restart.then', 'done.exec');
  g.wire('restart.runId', 'done.runId');
  return g.def;
};

const CHANGES: ValueType = { list: CHANGE };

const reportChanges = (): GraphDef => {
  const g = rule(
    [
      d('earlier', PCR_TYPE, 'Earlier PCR', 'The version of the report the claim came from.', true),
      d('pcr', PCR_TYPE, 'New PCR', 'The newer version of the report.', true)
    ],
    [
      d(
        'changes',
        CHANGES,
        'Changes',
        'Each billing detail the newer report changed, with both values; nothing when there is no earlier report to compare.',
        true
      )
    ]
  );
  g.add('earlier', 'billing.report-revision-facts', { label: 'Earlier Report Facts' });
  g.add('current', 'billing.report-revision-facts', { label: 'New Report Facts' });
  g.add('noEarlier', 'std.logic.is-null', { label: 'No Earlier PCR' });
  const changed = makeList(
    g,
    'changeList',
    'Changed Fields',
    CHANGE,
    REVISION_FACTS.map(([name, , label, field]) => {
      const id = `${name}Change`;
      g.add(id, 'billing.revision-change', { label: `${label} Change`, values: { field } });
      g.wire(`earlier.${name}`, `${id}.was`);
      g.wire(`current.${name}`, `${id}.now`);
      return `${id}.change` as const;
    })
  );
  g.ret('return');
  g.wire('entry.earlier', 'earlier.pcr', 'noEarlier.value');
  g.wire('entry.pcr', 'current.pcr');
  g.wire(select(g, 'changes', 'Changes', 'noEarlier.result', undefined, changed), 'return.changes');
  return g.def;
};

const revisionSummary = (): GraphDef => {
  const g = rule(
    [
      d('changes', CHANGES, 'Changes', 'What the newer report changed, if it was compared.', true),
      d(
        'status',
        'string',
        'Claim Status',
        'The status of the claim the new report revises.',
        true
      ),
      d(
        'canApply',
        'boolean',
        'Can Work Again',
        'Whether the claim can be worked again from the new report.',
        true
      )
    ],
    [
      d(
        'summary',
        'string',
        'Task Summary',
        'What the newer report changed and what a biller can do about it.'
      )
    ]
  );
  g.add('noEarlier', 'std.logic.is-null', { label: 'Not Compared' });
  g.add('fields', 'std.list.pluck', { label: 'Changed Field Names', values: { field: 'field' } });
  g.add('preview', 'billing.list-preview', {
    label: 'First Three Fields',
    values: { shown: 3, separator: ', ' }
  });
  g.add('listedLower', 'std.text.lower', { label: 'Fields in Lowercase' });
  g.add('headline', 'std.logic.choose', {
    label: 'What Changed',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '0' }] },
    values: {
      case1: 'A newer version of this report arrived with no changes to its billing details'
    }
  });
  g.wire('entry.changes', 'noEarlier.value', 'fields.list');
  g.wire('fields.list', 'preview.items');
  g.wire('preview.listed', 'listedLower.text');
  g.wire('preview.count', 'headline.key');
  g.wire(
    template(
      g,
      'changed',
      'Changes Text',
      'A newer version of this report changes the {fields}[ and {more} more]',
      { fields: 'listedLower.result', more: 'preview.more' }
    ),
    'headline.otherwise'
  );
  const arrived = select(
    g,
    'arrived',
    'What Arrived',
    'noEarlier.result',
    fixed('A newer version of this report arrived'),
    'headline.value'
  );
  g.add('statusText', 'std.logic.coalesce', {
    label: 'Status, Else Empty',
    values: { fallback: '' }
  });
  g.add('statusWords', 'std.text.replace', {
    label: 'Status in Words',
    values: { find: '_', replacement: ' ' }
  });
  g.wire('entry.status', 'statusText.value');
  g.wire('statusText.result', 'statusWords.text');
  const next = select(
    g,
    'next',
    'What to Do',
    'entry.canApply',
    fixed('; apply it, acknowledge it or void the claim'),
    template(
      g,
      'correctIt',
      'Correct It Text',
      '; the claim is {status}, so correct it with a Correct Claim Data task on the claim or acknowledge it',
      {
        status: orElse(
          g,
          'statusOrPast',
          'Status, Else Past Review',
          'statusWords.result',
          fixed('past review')
        )
      }
    )
  );
  g.ret('return');
  g.wire(
    template(g, 'summary', 'Task Summary', '{arrived}{next}', { arrived, next }),
    'return.summary'
  );
  return g.def;
};

const reviewRevision = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [p('report', BLOB), p('claimId', { id: 'claim' }), p('pcr', PCR_TYPE)],
      outputs: []
    },
    [{ name: 'previous', type: PCR_TYPE, default: null }]
  );
  g.add('note', 'billing.note-revision', { label: 'Note the Revision' });
  g.add('noPrevious', 'std.logic.is-null', { label: 'No Earlier Report' });
  g.add('first', 'std.flow.branch', { label: 'No Earlier Report to Read?' });
  g.add('readPrevious', 'nemsis.read-report', { label: 'Read the Earlier Report' });
  g.add('keep', 'std.var.set', { label: 'Keep the Earlier Report', config: { name: 'previous' } });
  g.add('previous', 'std.var.get', { label: 'Earlier PCR', config: { name: 'previous' } });
  g.input('pcr', 'pcr');
  g.input('contextClaimId', 'claimId');
  g.add('facts', 'billing.map-encounter-facts', { label: 'Map Encounter Facts' });
  g.add('classify', 'billing.classification', { label: 'Classification' });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('canApply', 'billing.can-rework-claim', { label: 'Can Rework Claim' });
  use(g, 'changes', 'billing.report-changes', 'Report Changes', {
    earlier: 'previous.value',
    pcr: 'pcr.pcr'
  });
  use(g, 'revisionSummary', 'billing.revision-summary', 'Task Summary', {
    changes: 'changes.changes',
    status: 'note.status',
    canApply: 'canApply.canApply'
  });
  const at = (id: string, label: string, path: string) =>
    getField(g, id, label, PCR_TYPE, path, 'pcr.pcr');
  const context = makeObject(g, 'context', 'Task Details', {
    claimId: [{ id: 'claim' }, 'contextClaimId.claimId'],
    status: ['string', 'note.status'],
    canApply: ['boolean', 'canApply.canApply'],
    patient: [
      { object: {} },
      makeObject(g, 'patient', 'Patient', {
        name: [
          'string',
          nameOf(g, 'patientName', 'Patient Name', at('person', 'Patient', 'patient'))
        ],
        birthDate: ['string', at('birthDate', 'Birth Date', 'patient.birthDate')]
      })
    ],
    trip: [{ object: {} }, 'trip.trip'],
    changes: [CHANGES, 'changes.changes']
  });
  g.add('revision', 'std.human.task', {
    label: 'Review Updated PCR',
    config: {
      title: 'Review updated PCR',
      queue: 'billing-review',
      instructions:
        'A newer version of this patient care report arrived after its claim was opened, so it was not billed again; the changes list what differs from the report the claim came from. Apply works the claim again from the new report while it is a draft, needs review or is void; a claim already on its way to payers is corrected with a Correct Claim Data task, started from Start Task on its claim. Acknowledge keeps the claim as it is; Void closes it, only while it has not gone to payers.',
      outcomes: ['apply', 'acknowledge', 'void'],
      hints: {
        apply:
          'Works the claim again from the new report; not possible once the claim has gone to payers.',
        acknowledge: 'Keeps the claim as it is; the new report is not billed.',
        void: 'Voids the claim so it is never billed; not possible once it has gone to payers.'
      }
    }
  });
  g.add('applies', 'std.flow.branch', { label: 'Can It Be Worked Again?' });
  g.add('voidable', 'std.flow.branch', { label: 'Can It Be Voided Here?' });
  g.input('report', 'report');
  g.input('claimId', 'claimId');
  g.add('rework', 'billing.rework-claim', { label: 'Work the Claim from the New Report' });
  g.add('void', 'billing.close-claim', {
    label: 'Void Revised Claim',
    values: { status: 'void' }
  });
  g.ret('done');
  g.wire('entry.exec', 'facts.exec');
  g.wire('entry.pcr', 'facts.pcr');
  g.wire('facts.then', 'note.exec');
  g.wire('facts.facts', 'classify.facts');
  g.wire('entry.report', 'note.report');
  g.wire('entry.claimId', 'note.claimId');
  g.wire('note.then', 'first.exec');
  g.wire('note.previous', 'noPrevious.value', 'readPrevious.report');
  g.wire('note.status', 'canApply.status');
  g.wire('noPrevious.result', 'first.condition');
  g.wire('first.true', 'revision.exec');
  g.wire('first.false', 'readPrevious.exec');
  g.wire('readPrevious.then', 'keep.exec');
  g.wire('readPrevious.pcr', 'keep.value');
  g.wire('keep.then', 'revision.exec');
  g.wire('pcr.pcr', 'trip.pcr', 'subject.pcr');
  g.wire('classify.classification', 'trip.classification');
  g.wire('classify.reason', 'trip.reason');
  g.wire('subject.subject', 'revision.subject');
  g.wire('revisionSummary.summary', 'revision.summary');
  g.wire(context, 'revision.context');
  g.wire('revision.apply', 'applies.exec');
  g.wire('canApply.canApply', 'applies.condition', 'voidable.condition');
  g.wire('applies.true', 'rework.exec');
  g.wire('applies.false', 'revision.exec');
  g.wire('report.report', 'rework.report');
  g.wire('claimId.claimId', 'rework.claimId', 'void.claimId');
  g.wire('rework.then', 'done.exec');
  g.wire('revision.acknowledge', 'done.exec');
  g.wire('revision.void', 'voidable.exec');
  g.wire('voidable.true', 'void.exec');
  g.wire('voidable.false', 'revision.exec');
  g.wire('void.then', 'done.exec');
  return g.def;
};

const encounterToClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('report', BLOB), p('claimId', { id: 'claim' }, true)],
    outputs: [
      p('classification', 'string', true),
      p('patient', PATIENT, true),
      p('claimId', { id: 'claim' }, true)
    ]
  });
  g.add('read', 'nemsis.read-report', { label: 'Read the Report' });
  g.add('pcr', 'nemsis.pcr.break', { label: 'PCR' });
  g.add('open', 'billing.open-claim', { label: 'Open Draft Claim' });
  g.add('work', 'billing.work-draft-claim', { label: 'Work the Draft Claim' });
  g.add('revision', 'billing.review-revision', { label: 'Review Updated PCR' });
  g.ret('done');
  g.ret('revised');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.report', 'read.report', 'open.report', 'work.report', 'revision.report');
  g.wire('entry.claimId', 'open.claimId');
  g.wire('read.then', 'open.exec');
  g.wire('read.pcr', 'pcr.pcr', 'work.pcr', 'revision.pcr');
  g.wire('pcr.pcrNumber', 'open.pcrNumber');
  g.wire('open.opened', 'work.exec');
  g.wire('open.duplicate', 'revision.exec');
  g.wire('open.claimId', 'work.claimId', 'revision.claimId', 'done.claimId', 'revised.claimId');
  for (const exit of ['claimed', 'skipped', 'voided']) g.wire(`work.${exit}`, 'done.exec');
  g.wire('work.classification', 'done.classification');
  g.wire('work.patient', 'done.patient');
  g.wire('revision.then', 'revised.exec');
  return g.def;
};

const recoverDraft = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('claimId', { id: 'claim' }), p('report', BLOB, true), p('reason', 'string', true)],
    outputs: []
  });
  const context = makeObject(g, 'context', 'Task Details', {
    claimId: [{ id: 'claim' }, 'entry.claimId'],
    reason: ['string', 'entry.reason']
  });
  g.add('orphan', 'std.human.task', {
    label: 'Draft Claim Has No Workflow',
    config: {
      title: 'Draft claim has no workflow',
      queue: 'billing-review',
      instructions:
        'The workflow working this draft claim stopped before the claim was ready, so nothing would happen to it. Restart works it again from its report, or void it.',
      outcomes: ['restart', 'void'],
      hints: {
        restart: 'Works the draft claim again from its report.',
        void: 'Voids the draft claim so it is never billed.'
      }
    }
  });
  g.add('rework', 'billing.rework-claim', { label: 'Work the Claim Again' });
  g.add('void', 'billing.close-claim', {
    label: 'Void Orphaned Draft',
    values: { status: 'void' }
  });
  g.ret('done');
  g.wire('entry.exec', 'orphan.exec');
  g.wire('entry.claimId', 'rework.claimId', 'void.claimId');
  g.wire('entry.report', 'rework.report');
  g.wire(context, 'orphan.context');
  summary(
    g,
    'orphan',
    'This draft claim stopped before it was ready[ ({reason})]; restart it from its report or void it',
    { reason: 'entry.reason' }
  );
  g.wire('orphan.restart', 'rework.exec');
  g.wire('rework.then', 'done.exec');
  g.wire('orphan.void', 'void.exec');
  g.wire('void.then', 'done.exec');
  return g.def;
};

const MSP_ANSWERS = [
  d(
    'mspEmployerPlan',
    'boolean',
    'Employer Plan',
    'The patient or spouse has a group health plan through current employment (working aged).',
    true
  ),
  d(
    'mspEsrd',
    'boolean',
    'End-Stage Renal Disease',
    'The patient has end-stage renal disease and is in the 30-month coordination period.',
    true
  ),
  d(
    'mspDisability',
    'boolean',
    'Disability',
    'The patient is under 65, disabled, with a group health plan through the employment of the patient or a family member.',
    true
  ),
  d(
    'mspEmployerSize',
    'integer',
    'Employer Size',
    'Employees at the employer that sponsors the group health plan, held to the MSP Employer Sizes table.',
    true
  ),
  d(
    'mspAccident',
    'string',
    'Accident',
    'An accident or work injury someone else pays for: one of none, liability, noFault or workersComp.',
    true
  )
];

const MSP_EMPLOYER_SIZES = shared.lookup(
  'billing.msp-employer-sizes',
  'MSP Employer Sizes',
  'The fewest employees the employer that sponsors a group health plan has for Medicare to pay second: Working Aged needs 20 (42 CFR 411.172) and Disability 100 (42 CFR 411.101).',
  {
    type: 'integer',
    rows: [
      { key: 'Working Aged', value: 20 },
      { key: 'Disability', value: 100 }
    ]
  }
);

const medicareSecondaryPayer = (): GraphDef => {
  const g = rule(MSP_ANSWERS, [
    d(
      'medicareSecondary',
      'boolean',
      'Medicare Pays Second',
      'Whether another payer pays before Medicare.'
    ),
    d(
      'insuranceType',
      'string',
      'MSP Type',
      "The Medicare Secondary Payer type the 837P names (SBR05): 12 working aged, 13 end-stage renal disease, 14 no-fault, 15 workers' compensation, 43 disability, 47 liability.",
      true
    ),
    P.reasons('Medicare pays first or second')
  ]);
  const fewest = (id: string, key: string) => {
    g.add(id, 'std.table.lookup', {
      label: `Fewest Employees for ${key}`,
      config: MSP_EMPLOYER_SIZES,
      values: { key }
    });
    return `${id}.value` as const;
  };
  const workingAged = fewest('workingAgedSize', 'Working Aged');
  const disability = fewest('disabilitySize', 'Disability');
  const accident = (id: string, label: string, kind: string) =>
    condition(g, id, label, { accident: ['string', 'entry.mspAccident'] }, [
      { field: 'accident', op: 'is', value: kind }
    ]);
  const plan = (id: string, label: string, answer: string, least: Port) =>
    condition(
      g,
      id,
      label,
      {
        [answer]: ['boolean', `entry.${answer}`],
        employees: ['integer', 'entry.mspEmployerSize'],
        fewest: ['integer', least]
      },
      [
        { field: answer, op: 'is', value: true },
        { field: 'employees', op: 'gte', input: 'fewest' }
      ]
    );
  const cases: {
    id: string;
    name: string;
    type: string;
    reason: Port | Fixed;
    when: Port;
  }[] = [
    {
      id: 'workersComp',
      name: "Workers' Compensation",
      type: '15',
      reason: fixed("Workers' compensation pays first"),
      when: accident('isWorkersComp', "Workers' Compensation", 'workersComp')
    },
    {
      id: 'noFault',
      name: 'No-Fault',
      type: '14',
      reason: fixed('No-fault or auto insurance pays first'),
      when: accident('isNoFault', 'No-Fault or Auto Insurance', 'noFault')
    },
    {
      id: 'liability',
      name: 'Liability',
      type: '47',
      reason: fixed('Liability insurance pays first'),
      when: accident('isLiability', 'Liability Insurance', 'liability')
    },
    {
      id: 'esrd',
      name: 'End-Stage Renal Disease',
      type: '13',
      reason: fixed('End-stage renal disease coordination period'),
      when: condition(
        g,
        'inEsrd',
        'End-Stage Renal Disease Coordination Period',
        { esrd: ['boolean', 'entry.mspEsrd'] },
        [{ field: 'esrd', op: 'is', value: true }]
      )
    },
    {
      id: 'workingAged',
      name: 'Working Aged',
      type: '12',
      reason: template(
        g,
        'workingAgedWhy',
        'Working Aged Reason Text',
        'Working aged with a group health plan from an employer of {fewest} or more',
        { fewest: workingAged }
      ),
      when: plan(
        'isWorkingAged',
        'Working Aged at a Large Enough Employer',
        'mspEmployerPlan',
        workingAged
      )
    },
    {
      id: 'disabled',
      name: 'Disability',
      type: '43',
      reason: template(
        g,
        'disabledWhy',
        'Disability Reason Text',
        'Disabled with a group health plan from an employer of {fewest} or more',
        { fewest: disability }
      ),
      when: plan('isDisabled', 'Disabled at a Large Enough Employer', 'mspDisability', disability)
    }
  ];
  const type = firstOf(
    g,
    'type',
    'MSP Type',
    'string',
    cases.map((c) => ({
      id: `${c.id}Type`,
      label: `${c.name} (${c.type})`,
      when: c.when,
      value: fixed(c.type)
    })),
    fixed(null)
  );
  g.ret('return');
  g.wire(type, 'return.insuranceType');
  g.wire(
    condition(g, 'secondary', 'Another Payer Pays First', { type: ['string', type] }, [
      { field: 'type', op: 'present' }
    ]),
    'return.medicareSecondary'
  );
  g.wire(
    makeList(
      g,
      'reasons',
      'Reasons',
      'string',
      cases.map((c) => select(g, `${c.id}Reason`, `${c.name} (${c.type}) Reason`, c.when, c.reason))
    ),
    'return.reasons'
  );
  return g.def;
};

const coordinationOrder = (): GraphDef => {
  const g = rule(
    [
      P.coverages('The payers as resolved.'),
      d(
        'medicareSecondary',
        'boolean',
        'Medicare Pays Second',
        'Another payer pays before Medicare, as the Medicare Secondary Payer rule decided.',
        true
      )
    ],
    [
      P.coverages('The payers in the order they are billed.'),
      P.reasons('the payers are in this order')
    ]
  );
  g.add('ranked', 'std.list.map-rule', {
    label: 'Each with Its Billing Rank',
    config: { rule: 'billing.coverage-billing-rank', version: 1, item: 'coverage' }
  });
  g.add('sorted', 'std.list.sort-by-field', {
    label: 'Sorted by Rank',
    values: { field: 'rank' }
  });
  g.add('ordered', 'std.list.pluck', {
    label: 'Coverages in Billing Order',
    values: { field: 'coverage' }
  });
  g.add('count', 'std.list.length', { label: 'How Many Payers' });
  keepListed(
    g,
    'othersFirst',
    'Payers Other Than Medicare',
    MEDICARE_CLAIM_FILINGS,
    'entry.coverages',
    'claimFiling',
    'notListed'
  );
  g.ret('return');
  g.wire('entry.coverages', 'ranked.list', 'count.list');
  g.wire('entry.medicareSecondary', 'ranked.medicareSecondary');
  g.wire('ranked.ranked', 'sorted.list');
  g.wire('sorted.list', 'ordered.list');
  g.wire('ordered.list', 'return.coverages');
  const inOrder = select(
    g,
    'inOrder',
    'Priority Order Reason',
    condition(g, 'several', 'Several Payers', { count: ['integer', 'count.length'] }, [
      { field: 'count', op: 'gt', value: 1 }
    ]),
    fixed('Billed in the priority order the report gives, then as reported')
  );
  const medicareAfter = select(
    g,
    'medicareAfter',
    'Medicare After Reason',
    condition(
      g,
      'medicareSecond',
      'Medicare Pays After the Others',
      {
        medicareSecondary: ['boolean', 'entry.medicareSecondary'],
        others: ['integer', 'othersFirst.count']
      },
      [
        { field: 'medicareSecondary', op: 'is', value: true },
        { field: 'others', op: 'gt', value: 0 }
      ]
    ),
    fixed('Medicare is billed after the payers that pay first')
  );
  g.wire(makeList(g, 'reasons', 'Reasons', 'string', [inOrder, medicareAfter]), 'return.reasons');
  return g.def;
};

const determinePayers = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [
      d('coverages', COVERAGES, 'Reported Coverages', 'The coverages the report lists.'),
      p('pcrNumber', 'string', true),
      p('patientName', 'string', true),
      p('facts', FACTS, true)
    ],
    outputs: [p('coverages', COVERAGES), p('notes', { list: 'string' })]
  });
  g.add('resolve', 'billing.resolve-payers', { label: 'Match Payer Directory' });
  g.add('facts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('documentation', 'billing.documentation.break', { label: 'Documentation' });
  g.add('msp', 'billing.medicare-secondary-payer', { label: 'Medicare Secondary Payer' });
  g.add('order', 'billing.coordination-order', { label: 'Coordination Order' });
  g.ret('done');
  g.wire('entry.exec', 'resolve.exec');
  g.wire('entry.coverages', 'resolve.coverages');
  g.wire('entry.pcrNumber', 'resolve.pcrNumber');
  g.wire('entry.patientName', 'resolve.patientName');
  g.wire('resolve.then', 'done.exec');
  g.wire('resolve.coverages', 'order.coverages');
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.documentation', 'documentation.documentation');
  for (const { name } of MSP_ANSWERS) g.wire(`documentation.${name}`, `msp.${name}`);
  g.wire('msp.medicareSecondary', 'order.medicareSecondary');
  g.wire('order.coverages', 'done.coverages');
  g.wire('resolve.notes', 'done.notes');
  return g.def;
};

const buildClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['saved', 'voided'],
    inputs: [
      p('claimId', { id: 'claim' }),
      p('report', BLOB, true),
      p('facts', FACTS),
      p('classification', 'string'),
      p('patient', PATIENT),
      p('coverages', COVERAGES),
      p('service', SERVICE),
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: []
  });
  g.add('primary', 'std.list.first', { label: 'Primary Coverage' });
  g.add('primaryPayer', 'billing.coverage.break', { label: 'Primary Payer' });
  g.add('charges', 'billing.assign-charges', { label: 'Assign Charges' });
  g.add('claim', 'billing.map-claim', { label: 'Assign Claim Properties' });
  g.add('save', 'billing.save-claim', { label: 'Save Draft Claim' });
  const eligibilityInputs = makeObject(g, 'eligibilityInputs', 'Eligibility Inputs', {
    claimId: [{ id: 'claim' }, 'entry.claimId']
  });
  g.add('eligibility', 'std.flow.start-workflow', {
    label: 'Check Eligibility of the Payers',
    config: { workflow: 'billing.check-eligibility', version: 1 }
  });
  g.ret('savedDone', 'saved');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'charges.exec');
  g.wire('entry.classification', 'charges.classification', 'claim.classification');
  g.wire('entry.service', 'charges.service', 'claim.service');
  g.wire('entry.coverages', 'primary.list', 'claim.coverages');
  g.wire('primary.item', 'primaryPayer.coverage');
  g.wire('primaryPayer.payerId', 'charges.payerId');
  g.wire('entry.subject', 'charges.subject');
  g.wire('entry.context', 'charges.context');
  g.wire('charges.voided', 'voidedDone.exec');
  g.wire('charges.priced', 'save.exec');
  g.wire('charges.lines', 'claim.lines');
  g.wire('charges.totalCents', 'claim.totalCents');
  g.wire('entry.facts', 'claim.facts');
  g.wire('entry.patient', 'claim.patient');
  g.wire('entry.report', 'claim.report');
  g.wire('claim.claim', 'save.claim');
  g.wire('entry.claimId', 'save.claimId');
  g.wire(eligibilityInputs, 'eligibility.inputs');
  g.wire('save.then', 'eligibility.exec');
  g.wire('eligibility.then', 'savedDone.exec');
  return g.def;
};

const billClaim = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['claimed', 'voided'],
      inputs: [
        p('claimId', { id: 'claim' }),
        p('report', BLOB, true),
        p('pcr', PCR_TYPE),
        p('facts', FACTS),
        p('classification', 'string'),
        p('reason', 'string', true),
        p('patient', PATIENT),
        p('coverages', COVERAGES),
        p('payerNotes', { list: 'string' }),
        p('findings', FINDINGS)
      ],
      outputs: [p('classification', 'string', true)]
    },
    [
      { name: 'classification', type: 'string', default: null },
      { name: 'answers', type: { object: {} }, default: null }
    ]
  );
  g.add('classified', 'std.var.set', {
    label: 'Classification to Bill',
    config: { name: 'classification' }
  });
  g.add('classification', 'std.var.get', {
    label: 'Classification So Far',
    config: { name: 'classification' }
  });
  g.add('suggest', 'billing.determine-service', { label: 'Determine Service' });
  g.add('answers', 'std.var.get', { label: 'Answers Given Before', config: { name: 'answers' } });
  g.add('review', 'billing.review-pcr', { label: 'Review PCR' });
  g.add('remember', 'std.var.set', {
    label: 'Remember the Approved Answers',
    config: { name: 'answers' }
  });
  g.add('reviewed', 'std.var.set', {
    label: 'Reviewed Classification',
    config: { name: 'classification' }
  });
  g.add('billedTrip', 'std.var.get', {
    label: 'Classification Billed',
    config: { name: 'classification' }
  });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  const claimContext = makeObject(g, 'claimContext', 'Task Details', {
    trip: [{ object: {} }, 'trip.trip']
  });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('logService', 'billing.record-decision', { label: 'Log the Service' });
  use(g, 'approvedText', 'billing.service-text', 'Approved Service Text', {
    classification: 'billedTrip.value',
    service: 'review.service'
  });
  g.add('approved', 'billing.service.break', { label: 'Approved Service' });
  g.add('build', 'billing.build-claim', { label: 'Build Claim' });
  g.add('responsibility', 'billing.decide-responsibility', { label: 'Decide Responsibility' });
  g.add('facility', 'billing.bill-facility', { label: 'Bill Facility' });
  g.add('fix', 'billing.fix-claim', { label: 'Check and Fix Claim', values: { all: false } });
  g.add('cycle', 'billing.start-cycle', { label: 'Start Payer Cycle' });
  g.add('finalTrip', 'std.var.get', {
    label: 'Final Classification',
    config: { name: 'classification' }
  });
  g.add('void', 'billing.close-claim', { label: 'Void Draft Claim', values: { status: 'void' } });
  g.ret('claimed', 'claimed');
  g.ret('voided', 'voided');

  g.wire('entry.exec', 'classified.exec');
  g.wire('entry.classification', 'classified.value');
  g.wire('classified.then', 'review.exec');
  g.wire('entry.facts', 'suggest.facts', 'review.facts', 'build.facts');
  g.wire('entry.findings', 'suggest.findings', 'review.findings');
  g.wire('entry.pcr', 'review.pcr', 'trip.pcr', 'subject.pcr');
  g.wire('classification.value', 'suggest.classification', 'review.classification');
  g.wire('suggest.service', 'review.service');
  for (const pin of ['reason', 'patient', 'coverages', 'payerNotes']) {
    g.wire(`entry.${pin}`, `review.${pin}`);
  }
  g.wire('answers.value', 'review.answers');
  g.wire('review.approved', 'remember.exec');
  g.wire('review.answers', 'remember.value');
  g.wire('remember.then', 'reviewed.exec');
  g.wire('review.classification', 'reviewed.value');
  g.wire('review.voided', 'void.exec');

  g.wire('reviewed.then', 'logService.exec');
  g.wire('entry.claimId', 'logService.claimId');
  g.wire('review.service', 'approved.service');
  g.wire(
    template(g, 'serviceDecision', 'Service Decision', 'Bill as {service}', {
      service: 'approvedText.text'
    }),
    'logService.decision'
  );
  g.wire(joinText(g, 'serviceBasis', 'Why', '; ', 'approved.basis'), 'logService.reason');
  g.wire('logService.then', 'build.exec');
  g.wire('entry.reason', 'trip.reason');
  g.wire('billedTrip.value', 'trip.classification', 'build.classification');
  for (const pin of ['claimId', 'report', 'patient', 'coverages']) {
    g.wire(`entry.${pin}`, `build.${pin}`);
  }
  g.wire('review.service', 'build.service');
  g.wire('subject.subject', 'build.subject', 'fix.subject', 'facility.subject');
  g.wire(claimContext, 'build.context', 'fix.context', 'facility.context');
  g.wire('entry.claimId', 'fix.claimId', 'cycle.claimId', 'void.claimId');
  g.wire('entry.claimId', 'responsibility.claimId', 'facility.claimId');
  g.wire('build.saved', 'responsibility.exec');
  g.wire('responsibility.payers', 'fix.exec');
  g.wire('responsibility.facility', 'facility.exec');
  g.wire('responsibility.facilityId', 'facility.facilityId');
  g.wire('responsibility.reason', 'facility.reason');
  g.wire('facility.billed', 'cycle.exec');
  g.wire('facility.payers', 'fix.exec');
  g.wire('facility.voided', 'void.exec');
  g.wire('build.voided', 'void.exec');
  g.wire('fix.fixed', 'cycle.exec');
  g.wire('fix.backToReview', 'review.exec');
  g.wire('fix.voided', 'void.exec');
  g.wire('cycle.then', 'claimed.exec');
  g.wire('finalTrip.value', 'claimed.classification');
  g.wire('void.then', 'voided.exec');
  return g.def;
};

const workDraftClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['claimed', 'skipped', 'voided'],
    inputs: [p('report', BLOB, true), p('pcr', PCR_TYPE), p('claimId', { id: 'claim' })],
    outputs: [p('classification', 'string', true), p('patient', PATIENT, true)]
  });
  g.add('facts', 'billing.map-encounter-facts', { label: 'Map Encounter Facts' });
  g.add('parts', 'billing.encounter-facts.break', { label: 'Encounter Facts' });
  g.add('trip', 'billing.trip-facts.break', { label: 'Trip Facts' });
  g.add('clinical', 'billing.clinical-facts.break', { label: 'Clinical Facts' });
  g.add('decide', 'billing.decide-claim', { label: 'Is a Claim Needed?' });
  g.add('skip', 'billing.close-claim', {
    label: 'Void Skipped Claim',
    values: { status: 'void' }
  });
  g.add('classified', 'billing.record-classification', { label: 'Record Classification' });
  g.add('notBillable', 'billing.record-classification', {
    label: 'Record Not Billable',
    values: { classification: 'notBillable' }
  });
  g.add('findings', 'billing.read-findings', { label: 'Narrative Findings' });
  g.add('patient', 'billing.claim-patient', { label: 'Claim Patient' });
  const patientName = nameOf(g, 'patientName', 'Patient Name', 'parts.patient');
  g.add('payers', 'billing.determine-payers', { label: 'Determine Payers' });
  g.add('bill', 'billing.bill-claim', { label: 'Bill the Claim' });
  g.add('logPayers', 'billing.record-decision', { label: 'Log the Payers' });
  g.add('payerNames', 'std.list.pluck', { label: 'Payer Names', values: { field: 'payer' } });
  const payerDecision = select(
    g,
    'payerDecision',
    'Patient When No Payer, Else the Payers in Order',
    condition(
      g,
      'noPayer',
      'No Payer on the Report',
      { payers: [{ list: 'string' }, 'payerNames.list'] },
      [{ field: 'payers', op: 'empty' }]
    ),
    fixed('No payer on the report, so the patient is billed'),
    template(g, 'payerOrder', 'Payers in Billing Order', 'Payers in billing order: {payers}', {
      payers: joinText(g, 'payerList', 'Payer List', ', ', 'payerNames.list')
    })
  );
  g.ret('skipped', 'skipped');
  g.ret('claimed', 'claimed');
  g.ret('voided', 'voided');

  g.wire('entry.exec', 'facts.exec');
  g.wire('entry.pcr', 'facts.pcr', 'decide.pcr', 'bill.pcr');
  g.wire('facts.then', 'decide.exec');
  g.wire('facts.facts', 'parts.facts', 'decide.facts', 'bill.facts');
  g.wire('parts.trip', 'trip.trip');
  g.wire('parts.clinical', 'clinical.clinical');
  g.wire('decide.skip', 'notBillable.exec');
  g.wire('notBillable.then', 'skip.exec');
  g.wire('entry.claimId', 'decide.claimId', 'skip.claimId', 'patient.claimId', 'bill.claimId');
  g.wire('entry.claimId', 'logPayers.claimId', 'classified.claimId', 'notBillable.claimId');
  g.wire('skip.then', 'skipped.exec');
  g.wire('decide.classification', 'skipped.classification', 'bill.classification');
  g.wire('decide.reason', 'bill.reason');
  g.wire('decide.claim', 'classified.exec');
  g.wire('decide.classification', 'classified.classification');
  g.wire('classified.then', 'findings.exec');
  g.wire('clinical.narrative', 'findings.narrative');
  g.wire('findings.then', 'patient.exec');
  g.wire('parts.patient', 'patient.demographics');
  g.wire('trip.pcrNumber', 'patient.pcrNumber', 'payers.pcrNumber');
  g.wire('patient.then', 'payers.exec');
  g.wire('parts.coverages', 'payers.coverages');
  g.wire('facts.facts', 'payers.facts');
  g.wire(patientName, 'payers.patientName');
  g.wire('payers.then', 'logPayers.exec');
  g.wire('payers.coverages', 'payerNames.list');
  g.wire(payerDecision, 'logPayers.decision');
  g.wire(joinText(g, 'payerNotes', 'Payer Notes', '; ', 'payers.notes'), 'logPayers.reason');
  g.wire('logPayers.then', 'bill.exec');
  g.wire('entry.report', 'bill.report');
  g.wire('patient.patient', 'bill.patient', 'claimed.patient', 'voided.patient');
  g.wire('payers.coverages', 'bill.coverages');
  g.wire('payers.notes', 'bill.payerNotes');
  g.wire('findings.findings', 'bill.findings');
  g.wire('bill.claimed', 'claimed.exec');
  g.wire('bill.classification', 'claimed.classification');
  g.wire('bill.voided', 'voided.exec');
  return g.def;
};

export const intakeGraphs: SeedGraph[] = [
  asRule(
    'billing.person-name',
    'Person Name',
    'Writes a person as their first and last name, such as Jane Doe.',
    personName()
  ),
  asRule(
    'billing.report-subject',
    'Report Subject',
    'Names a report in task lists by its PCR number and patient name, such as PCR-1001 · Jane Doe.',
    reportSubject()
  ),
  asRule(
    'billing.patient-details',
    'Patient Details',
    'Shows a patient to a biller: name, birth date, sex in words (Sex Labels table) and address.',
    patientDetails()
  ),
  asRule(
    'billing.patient-match-context',
    'Patient Match Context',
    'What a biller sees when matching a report to a patient: why it may be a match, the patient on the report with its PCR number, and the details of each candidate.',
    patientMatchContext()
  ),
  asRule(
    'billing.patient-match-summary',
    'Patient Match Summary',
    'Says what the Confirm Patient task asks: whether the patient on the report is an existing patient (or one of several), or a new one.',
    patientMatchSummary()
  ),
  asRule(
    'billing.missing-details-summary',
    'Missing Details Summary',
    'Says which of the first name, last name and birth date the report is missing, or that they are not valid, for the Complete Patient Details task.',
    missingDetailsSummary()
  ),
  asRule(
    'billing.patient-choice',
    'Patient Choice',
    'Offers a candidate patient as a choice, named by last and first name, birth date and ZIP code.',
    patientChoice()
  ),
  asRule(
    'billing.payer-name-key',
    'Payer Name Key',
    'Writes a reported payer name in lowercase, so the same name written in any case is asked about once.',
    payerNameKey()
  ),
  asRule(
    'billing.payer-has-name',
    'Payer Has Name',
    'Says whether a reported payer has the given name, ignoring case.',
    payerHasName()
  ),
  asRule(
    'billing.payer-name-task',
    'Payer Name Task',
    'Gathers every reported payer with the same name into one Match Payer task, so a biller answers once for all the coverages with that name.',
    payerNameTask()
  ),
  asRule(
    'billing.is-suggested-payer',
    'Is Suggested Payer',
    'Says whether a directory payer offered for a name is the one suggested.',
    isSuggestedPayer()
  ),
  asRule(
    'billing.coverage-details',
    'Coverage Details',
    'Shows a payer to a biller: the name reported, its directory payer (or that it is not linked), member ID and group ID.',
    coverageDetails()
  ),
  asRule(
    'billing.medication-text',
    'Medication Text',
    'Writes a medication the narrative documents as its name and route, with the number of doses when more than one.',
    medicationText()
  ),
  asRule(
    'billing.vital-signs-text',
    'Vital Signs Text',
    'Writes one set of vital signs as when they were taken and each reading recorded.',
    vitalSignsText()
  ),
  asRule(
    'billing.review-warnings',
    'Review Warnings',
    'Warns the PCR reviewer about what could not be read or decided or needs care: a trip nothing classified, no signature, no certification for a scheduled trip, no vital signs, a death before loading, non-covered miles, several patients, and the narrative and payer notes.',
    reviewWarnings()
  ),
  asRule(
    'billing.review-pcr-details',
    'Review PCR Details',
    'What the Review PCR task shows a biller: the patient, trip, payers, what the narrative documents, the condition and vital signs, the documentation, the suggested service and the warnings.',
    reviewPcrDetails()
  ),
  asRule(
    'billing.service-text',
    'Service Text',
    'Writes a service as one line for tasks and the claim history: kind of trip, level, emergency, loaded miles and a death before loading.',
    serviceText()
  ),
  asRule(
    'billing.review-pcr-summary',
    'Review PCR Summary',
    'Says what the Review PCR task asks a biller to confirm, naming the suggested service: kind of trip, level, emergency, loaded miles and a death before loading, and whether the narrative suggested it.',
    reviewPcrSummary()
  ),
  asRule(
    'billing.report-revision-facts',
    'Report Revision Facts',
    'The billing details of one version of a report that a revision compares: patient, call time, places, impressions, care, response, odometers, payers and narrative length.',
    reportRevisionFacts()
  ),
  asRule(
    'billing.revision-change',
    'Revision Change',
    'Gives a billing detail with its earlier and new values when a newer report changed it, or nothing when it is the same.',
    revisionChange()
  ),
  asRule(
    'billing.report-changes',
    'Report Changes',
    'Lists each billing detail (Report Revision Facts) a newer report changed from the earlier version, or nothing when there is no earlier version to compare.',
    reportChanges()
  ),
  asRule(
    'billing.revision-summary',
    'Updated PCR Summary',
    'Says what a newer report changed (naming the first three billing details) and what a biller can do: apply it while the claim can be worked again, or else correct the claim or acknowledge it.',
    revisionSummary()
  ),
  asRule(
    'billing.can-rework-claim',
    'Can Rework Claim',
    'Says whether a claim can still be worked again from a newer report: while it is a draft, needs review or is void.',
    canReworkClaim()
  ),
  asRule(
    'billing.coverage-billing-rank',
    'Coverage Billing Rank',
    'Ranks a payer for billing order by its reported priority (Coverage Priority table), placing Medicare after the other payers when another payer pays first.',
    coverageBillingRank()
  ),
  asStage(
    'billing.review-patient-match',
    'Review Patient Match',
    'Asks a biller which of the likely matching patients is the one on the report, or to create a new patient from the report.',
    reviewPatientMatch()
  ),
  asStage(
    'billing.resolve-patient',
    'Resolve Patient',
    'Finds the patient on the report: uses an exact match, creates a patient when nothing is close, or asks a biller to pick among likely matches. When the name or birth date is missing or not valid, asks a biller to complete them (prefilled with what was entered before) and matches again.',
    resolvePatient()
  ),
  asStage(
    'billing.resolve-payers',
    'Match Payer Directory',
    'Links the payers on the report to the payer directory and asks a biller about each name it does not know: link it (remembered for later reports), keep it unlisted, or remove it when it is not insurance. Also gives what limited the matching.',
    resolvePayers()
  ),
  asRule(
    'billing.medicare-secondary-payer',
    'Medicare Secondary Payer',
    'Decides from the Medicare Secondary Payer (MSP) answers (employer plan, end-stage renal disease, disability, accident or work injury) whether another payer pays before Medicare, and the MSP type the 837P names: the first answer that holds wins, and employer plans count from the sizes in the MSP Employer Sizes table.',
    medicareSecondaryPayer()
  ),
  asRule(
    'billing.coordination-order',
    'Coordination Order',
    'Puts the payers in billing order: by the priority the report gives each coverage (Coverage Priority table), then as reported, with Medicare after the other payers when the Medicare Secondary Payer rule says another payer pays first.',
    coordinationOrder()
  ),
  asStage(
    'billing.determine-payers',
    'Determine Payers',
    'Decides which payers to bill, in order, from the coverages on the report: Match Payer Directory, Medicare Secondary Payer from the MSP answers on the report, then Coordination Order.',
    determinePayers()
  ),
  asRule(
    'billing.pcr-subject',
    'PCR Subject',
    'Names a patient care report in task lists by its PCR number and patient name (Report Subject).',
    pcrSubject()
  ),
  asRule(
    'billing.trip-summary',
    'Trip Summary',
    'Describes a trip for billers: PCR number, classification and why, call time, response, care provided, impressions, pickup and destination.',
    tripSummary()
  ),
  asStage(
    'billing.read-findings',
    'Read Narrative Findings',
    'Reads the medications and procedures the narrative documents with the local model, retrying while it is busy, or leaves the findings unread when it is down.',
    readFindings()
  ),
  asStage(
    'billing.claim-patient',
    'Claim Patient',
    'Finds or creates the patient on the report, updates their address when the report has a complete one that differs, and assigns them to the draft claim.',
    claimPatient()
  ),
  asStage(
    'billing.review-pcr',
    'Review PCR',
    'Coding review: asks a biller to confirm the classification, level of service and loaded miles, prefilled with earlier answers or the suggestion, with the reasons for it. A held report waits until a biller releases it back to review or voids it.',
    reviewPcr()
  ),
  asStage(
    'billing.build-claim',
    'Build Claim',
    "Assigns the charges for the confirmed service, priced for the primary payer, assigns the claim properties from the encounter facts, saves the draft and checks the payers' eligibility. Stops instead when a biller voids the claim rather than pricing a charge code.",
    buildClaim()
  ),
  asStage(
    'billing.start-cycle',
    'Start Payer Cycle',
    'Starts the Cycle Claim workflow for a claim and links the claim to it.',
    startCycle()
  ),
  asStage(
    'billing.rework-claim',
    'Work the Claim Again',
    'Starts Encounter to Claim again for a claim, from its report.',
    reworkClaim()
  ),
  asStage(
    'billing.review-revision',
    'Review Updated PCR',
    'Shows a biller what a newer version of a report changed on an existing claim, then works the claim again from it, keeps the claim as it is, or voids it.',
    reviewRevision()
  ),
  asStage(
    'billing.bill-claim',
    'Bill the Claim',
    'Determines the service for the classification, has a biller review it, builds the claim, has a biller bill a facility instead when the Facility Responsibility rule says so (Bill Facility, then the payer cycle waits on the facility invoice), else checks the claim, and starts its payer cycle. A claim sent back to review is reviewed again with the answers given before.',
    billClaim()
  ),
  asStage(
    'billing.work-draft-claim',
    'Work Draft Claim',
    'Works a draft claim from its report: maps the encounter facts, decides whether to claim, reads the narrative, resolves the patient, determines the payers, then bills the claim.',
    workDraftClaim()
  ),
  asWorkflow(
    'billing.encounter-to-claim',
    'Encounter to Claim',
    'Turns one patient care report into a claim: opens a draft claim (or works an existing one again), maps the encounter facts, classifies the trip, reads the narrative when the model is up, resolves the patient and payers, determines the service, has a biller confirm it, assigns and prices the charges and claim properties, saves the draft, checks and fixes it and starts its payer cycle. A report already billed becomes a revision of its claim, shown with what changed.',
    encounterToClaim()
  ),
  asWorkflow(
    'billing.recover-draft',
    'Recover Draft Claim',
    'Asks a biller what to do with a draft claim whose workflow stopped: work it again from its report, or void it.',
    recoverDraft()
  )
];
