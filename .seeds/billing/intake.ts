import {
  CLASSIFICATION_FIELD,
  LEVEL_FIELD,
  LOADED_MILES_FIELD,
  UNREAD_FINDINGS
} from '@ugula/billing';
import type { GraphDef, Json, ValueType } from '@ugula/graph';
import { PCR_TYPE } from '@ugula/nemsis';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import { action, graph, p } from './glossary.ts';
import {
  ADDRESS_PINS,
  asRule,
  asStage,
  asWorkflow,
  atLeast,
  type Builder,
  d,
  field,
  is,
  P,
  rule,
  shared,
  summary,
  T,
  table,
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

type Port = `${string}.${string}`;

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

const MEDICARE_FILING = ['MA', 'MB'];

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

const getField = (
  g: Builder,
  id: string,
  label: string,
  record: ValueType,
  path: string,
  from: Port
) => {
  g.add(id, 'std.object.get-field', { label, config: { record, path } });
  g.wire(from, `${id}.record`);
  return `${id}.value` as const;
};

const makeObject = (
  g: Builder,
  id: string,
  label: string,
  fields: Record<string, [ValueType, Port]>
) => {
  g.add(id, 'std.object.make', {
    label,
    config: { fields: Object.entries(fields).map(([name, [type]]) => ({ name, type })) }
  });
  for (const [name, [, port]] of Object.entries(fields)) g.wire(port, `${id}.${name}`);
  return `${id}.object` as const;
};

const makeList = (g: Builder, id: string, label: string, type: ValueType, items: Port[]) => {
  g.add(id, 'std.list.make', { label, config: { count: items.length, type } });
  for (const [i, port] of items.entries()) g.wire(port, `${id}.item${i + 1}`);
  return `${id}.list` as const;
};

const joinText = (g: Builder, id: string, label: string, separator: string, items: Port) => {
  g.add(id, 'std.text.join', { label, values: { separator } });
  g.wire(items, `${id}.items`);
  return `${id}.text` as const;
};

const when = (
  g: Builder,
  id: string,
  label: string,
  inputs: Record<string, [ValueType, Port]>,
  rules: { field: string; op: string; value?: Json }[],
  match: 'all' | 'any' = 'all'
) => {
  g.add(id, 'std.logic.condition', {
    label,
    config: {
      match,
      inputs: Object.entries(inputs).map(([name, [type]]) => ({ name, type })),
      rules
    }
  });
  for (const [name, [, port]] of Object.entries(inputs)) g.wire(port, `${id}.${name}`);
  return `${id}.result` as const;
};

const select = (
  g: Builder,
  id: string,
  label: string,
  condition: Port,
  whenTrue: Port | Json,
  whenFalse: Port | Json = null
) => {
  const isPort = (x: Port | Json): x is Port => typeof x === 'string' && /^\w+\.\w+$/.test(x);
  const fixed = Object.fromEntries(
    (
      [
        ['whenTrue', whenTrue],
        ['whenFalse', whenFalse]
      ] as const
    ).filter(([, x]) => x !== null && !isPort(x))
  ) as Record<string, Json>;
  g.add(id, 'std.logic.select', { label, ...(Object.keys(fixed).length ? { values: fixed } : {}) });
  g.wire(condition, `${id}.condition`);
  if (isPort(whenTrue)) g.wire(whenTrue, `${id}.whenTrue`);
  if (isPort(whenFalse)) g.wire(whenFalse, `${id}.whenFalse`);
  return `${id}.result` as const;
};

const nameOf = (g: Builder, id: string, label: string, person: Port) =>
  template(g, id, label, '{person.firstName} {person.lastName}', { person });

const subjectOf = (g: Builder, id: string, parts: Port[]) =>
  joinText(
    g,
    id,
    'Task Subject',
    ' · ',
    makeList(g, `${id}Parts`, 'Subject Parts', 'string', parts)
  );

const patientDetails = (): GraphDef => {
  const g = rule(
    [d('person', DEMOGRAPHICS, 'Person', 'A patient, or the demographics a report gives.', true)],
    [d('details', DETAILS, 'Details', 'The name, birth date, sex and address, for a biller.')]
  );
  g.add('parts', 'billing.demographics.break', { label: 'Person' });
  const name = nameOf(g, 'name', 'Name', 'entry.person');
  g.add('sex', 'std.table.lookup', { label: 'Sex', config: sexLabels() });
  g.add('address', 'billing.place-text', { label: 'Address' });
  g.ret('return');
  g.wire('entry.person', 'parts.demographics', 'address.place');
  g.wire('parts.gender', 'sex.key');
  const details = makeObject(g, 'details', 'Details', {
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
        'Choice',
        'The patient as a choice: the patient, named with birth date and ZIP code.'
      )
    ]
  );
  const id = getField(g, 'id', 'Patient ID', PATIENT, 'id', 'entry.candidate');
  const label = template(
    g,
    'label',
    'Choice Label',
    '{candidate.lastName}, {candidate.firstName} · born {candidate.birthDate}[ · {candidate.postalCode}]',
    { candidate: 'entry.candidate' }
  );
  g.ret('return');
  g.wire(
    makeObject(g, 'choice', 'Choice', { value: ['string', id], label: ['string', label] }),
    'return.choice'
  );
  return g.def;
};

const payerNameKey = (): GraphDef => {
  const g = rule(
    [d('payer', UNMATCHED_PAYER, 'Unlinked Payer', 'A payer name the report gives.', true)],
    [d('key', 'string', 'Name Key', 'The payer name in small letters, to group the same names.')]
  );
  const name = getField(g, 'name', 'Payer Name', UNMATCHED_PAYER, 'payer', 'entry.payer');
  g.add('key', 'std.text.lower', { label: 'In Small Letters' });
  g.ret('return');
  g.wire(name, 'key.text');
  g.wire('key.result', 'return.key');
  return g.def;
};

const payerHasName = (): GraphDef => {
  const g = rule(
    [
      d('payer', UNMATCHED_PAYER, 'Unlinked Payer', 'A payer name the report gives.', true),
      d('name', 'string', 'Name Key', 'A payer name in small letters.', true)
    ],
    [d('matches', 'boolean', 'Has the Name', 'Whether the payer has this name, in any case.')]
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
      d('name', 'string', 'Name Key', 'A payer name in small letters.', true),
      d(
        'unmatched',
        { list: UNMATCHED_PAYER },
        'Unlinked Payers',
        'The payers on the report the directory does not know, with their coverage keys.',
        true
      )
    ],
    [
      d(
        'task',
        { object: {} },
        'Payer Name Task',
        'The first payer with the name, with the keys of every coverage that has it.'
      )
    ]
  );
  const byName = { rule: 'billing.payer-has-name', version: 1, item: 'payer', test: 'matches' };
  g.add('first', 'std.list.find-rule', { label: 'First With the Name', config: byName });
  g.add('same', 'std.list.filter-rule', { label: 'All With the Name', config: byName });
  g.add('keys', 'std.list.pluck', { label: 'Their Coverage Keys', values: { field: 'key' } });
  g.add('task', 'std.object.merge', { label: 'First With Every Key' });
  g.ret('return');
  g.wire('entry.unmatched', 'first.list', 'same.list');
  g.wire('entry.name', 'first.name', 'same.name');
  g.wire('same.list', 'keys.list');
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
        'The payer as reported, its directory payer, member ID and group ID, for a biller.'
      )
    ]
  );
  g.add('parts', 'billing.coverage.break', { label: 'Coverage' });
  g.add('directory', 'std.logic.choose', {
    label: 'Directory Payer, Else Not Linked',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'Not linked to the payer directory' }
  });
  g.ret('return');
  g.wire('entry.coverage', 'parts.coverage');
  g.wire('parts.directoryName', 'directory.option1');
  const details = makeObject(g, 'details', 'Coverage Details', {
    payer: ['string', 'parts.payer'],
    directory: ['string', 'directory.value'],
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
  const several = when(g, 'several', 'More Than One Dose', { doses: ['integer', 'parts.doses'] }, [
    { field: 'doses', op: 'gt', value: 1 }
  ]);
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
        'When they were taken and each reading, separated by dots.'
      )
    ]
  );
  const takenAt = getField(g, 'takenAt', 'Taken At', VITAL, 'takenAt', 'entry.vital');
  const diastolic = getField(g, 'diastolic', 'Diastolic', VITAL, 'diastolic', 'entry.vital');
  g.add('diastolicOrUnknown', 'std.logic.choose', {
    label: 'Diastolic, Else Unknown',
    config: { mode: 'first', type: 'any', count: 2 },
    values: { option2: '?' }
  });
  g.wire(diastolic, 'diastolicOrUnknown.option1');
  const bp = template(g, 'bloodPressure', 'Blood Pressure', '[BP {vital.systolic}/{diastolic}]', {
    vital: 'entry.vital',
    diastolic: 'diastolicOrUnknown.value'
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
    when(g, 'unclassified', 'Nothing Classified It', { reason: ['string', 'entry.reason'] }, [
      { field: 'reason', op: 'empty' }
    ]),
    'No disposition or type of service is recorded, so the trip was classified as an emergency transport'
  );
  g.add('signatureNote', 'std.logic.choose', {
    label: 'Signature Note, Else No Signature',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'No billing signature' }
  });
  g.wire('docs.signatureNote', 'signatureNote.option1');
  const unsigned = select(
    g,
    'unsignedWarning',
    'Signature Warning',
    when(g, 'unsigned', 'Not Signed', { signature: ['string', 'docs.signature'] }, [
      { field: 'signature', op: 'isNot', value: 'signed' }
    ]),
    'signatureNote.value'
  );
  const noPcs = select(
    g,
    'noPcsWarning',
    'Certification Warning',
    when(
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
    'This scheduled trip has no physician certification statement'
  );
  const noVitals = select(
    g,
    'noVitalsWarning',
    'Vital Signs Warning',
    when(g, 'noVitals', 'No Vital Signs', { vitals: [{ list: VITAL }, 'entry.vitals'] }, [
      { field: 'vitals', op: 'empty' }
    ]),
    'No vital signs are recorded to support medical necessity'
  );
  const dead = select(
    g,
    'deceasedWarning',
    'Pronounced Dead Warning',
    when(g, 'deceased', 'Pronounced Dead', { deceased: ['boolean', 'service.deceased'] }, [
      { field: 'deceased', op: 'is', value: true }
    ]),
    'The patient was pronounced dead before loading, so the trip is billed as BLS with QL and no mileage'
  );
  const nonCovered = select(
    g,
    'nonCoveredWarning',
    'Non-Covered Miles Warning',
    when(
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
    when(g, 'several', 'Several Patients', { count: ['integer', 'docs.patientCount'] }, [
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
      d(name, type, label, `The ${label.toLowerCase()} the report gives, as compared.`, true)
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
    label: 'Narrative, Else None',
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
    patientName: template(
      g,
      'patientName',
      'Patient Name',
      '{pcr.patient.firstName} {pcr.patient.lastName}',
      { pcr }
    ),
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
      d('field', 'string', 'Field', 'What the change is to, such as Birth date.'),
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
  g.add('differs', 'std.logic.not-equal', { label: 'Changed' });
  g.ret('return');
  g.wire('entry.was', 'differs.a');
  g.wire('entry.now', 'differs.b');
  const change = makeObject(g, 'change', 'Change', {
    field: ['string', 'entry.field'],
    was: ['any', 'entry.was'],
    now: ['any', 'entry.now']
  });
  g.wire(select(g, 'changed', 'Change If Changed', 'differs.result', change), 'return.change');
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
        'Can Apply',
        'Whether the claim can be worked again from the new report: it is a draft, needs review or is void.'
      )
    ]
  );
  const result = when(
    g,
    'canApply',
    'Not Yet With Payers',
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
        'Medicare Secondary',
        'Another payer pays before Medicare, as the Medicare Secondary Payer rule decided.',
        true
      )
    ],
    [
      d(
        'ranked',
        { object: { coverage: COVERAGE, rank: 'number' } },
        'Ranked Coverage',
        'The coverage with its billing rank: its priority, plus 1000 when Medicare goes after the payers that pay first.'
      )
    ]
  );
  g.add('parts', 'billing.coverage.break', { label: 'Coverage' });
  g.add('priority', 'std.table.lookup', { label: 'Coverage Priority', config: coveragePriority() });
  g.add('rank', 'std.math.add', { label: 'Billing Rank' });
  g.ret('return');
  g.wire('entry.coverage', 'parts.coverage');
  g.wire('parts.priority', 'priority.key');
  const medicareLast = when(
    g,
    'medicareLast',
    'Medicare Pays Second',
    {
      medicareSecondary: ['boolean', 'entry.medicareSecondary'],
      claimFiling: ['string', 'parts.claimFiling']
    },
    [
      { field: 'medicareSecondary', op: 'is', value: true },
      { field: 'claimFiling', op: 'oneOf', value: MEDICARE_FILING }
    ]
  );
  g.wire('priority.value', 'rank.a');
  g.wire(select(g, 'afterOthers', 'After the Others', medicareLast, 1000, 0), 'rank.b');
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
  const choices = makeObject(g, 'choices', 'Choices by Field', {
    patientId: [{ list: CHOICE }, 'choiceList.choice']
  });
  g.add('likeliest', 'std.list.first', { label: 'Likeliest Candidate' });
  const likeliest = getField(g, 'likeliestId', 'Its Patient', PATIENT, 'id', 'likeliest.item');
  const pick = makeObject(g, 'pick', 'Preselected Patient', {
    patientId: [{ id: 'patient' }, likeliest]
  });
  g.add('context', 'billing.patient-match-context', { label: 'Review Context' });
  const reported = nameOf(g, 'reportedName', 'Reported Name', 'entry.demographics');
  const subject = subjectOf(g, 'subject', ['entry.pcrNumber', reported]);
  g.add('count', 'std.list.length', { label: 'Candidates' });
  const existing = select(
    g,
    'existing',
    'Existing Patient or One of Several',
    when(g, 'oneOrNone', 'One Candidate at Most', { count: ['integer', 'count.length'] }, [
      { field: 'count', op: 'lte', value: 1 }
    ]),
    'is an existing patient',
    template(g, 'several', 'One of Several', 'is one of {count} existing patients', {
      count: 'count.length'
    })
  );
  g.add('who', 'std.logic.choose', {
    label: 'Reported Name, Else the Patient',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'the patient on the report' }
  });
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
  g.add('find', 'billing.find-patient');
  g.ret('reviewed');
  g.ret('linked');
  g.wire('entry.exec', 'confirm.exec');
  g.wire('entry.candidates', 'choiceList.list', 'likeliest.list', 'context.candidates');
  g.wire('entry.candidates', 'count.list');
  g.wire('entry.reason', 'context.reason');
  g.wire('entry.demographics', 'context.demographics', 'createNew.demographics');
  g.wire('entry.pcrNumber', 'context.pcrNumber');
  g.wire(reported, 'who.option1');
  g.wire(choices, 'confirm.options');
  g.wire(pick, 'confirm.defaults');
  g.wire('context.context', 'confirm.context');
  g.wire(subject, 'confirm.subject');
  summary(
    g,
    'confirm',
    'Decide whether {who}[, born {demographics.birthDate},] {existing}[ ({reason})], or create a new patient',
    { who: 'who.value', demographics: 'entry.demographics', existing, reason: 'entry.reason' }
  );
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

const resolvePatient = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['then'],
      inputs: [p('demographics', DEMOGRAPHICS), p('pcrNumber', 'string', true)],
      outputs: [p('patient', PATIENT)]
    },
    [{ name: 'entered', type: DEMOGRAPHICS, default: null }]
  );
  g.add('match', 'billing.match-patient');
  g.add('create', 'billing.create-patient', { values: { reuseMatch: true } });
  g.add('review', 'billing.review-patient-match', { label: 'Review Likely Matches' });
  g.add('context', 'billing.patient-match-context', { label: 'Report Context' });
  const reportedName = nameOf(g, 'reportedName', 'Reported Name', 'entry.demographics');
  const subject = subjectOf(g, 'subject', ['entry.pcrNumber', reportedName]);
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
  g.add('prefilled', 'billing.demographics.break', { label: 'Details to Complete' });
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
  for (const id of [
    'matched',
    'created',
    'reviewed',
    'completedMatched',
    'completedCreated',
    'completedReviewed'
  ]) {
    g.ret(id);
  }
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
  g.wire('prefill.result', 'complete.defaults', 'prefilled.demographics');
  const missing = (pin: string, label: string, text: string) =>
    select(
      g,
      `${pin}Missing`,
      `Missing ${label}`,
      when(g, `${pin}Empty`, `No ${label}`, { value: ['string', `prefilled.${pin}`] }, [
        { field: 'value', op: 'empty' }
      ]),
      text
    );
  const missingList = makeList(g, 'missing', 'Missing Details', 'string', [
    missing('firstName', 'First Name', 'first name'),
    missing('lastName', 'Last Name', 'last name'),
    missing('birthDate', 'Birth Date', 'birth date')
  ]);
  g.wire(
    select(
      g,
      'completeSummary',
      'Task Summary',
      when(g, 'noneMissing', 'Nothing Missing', { missing: [{ list: 'string' }, missingList] }, [
        { field: 'missing', op: 'empty' }
      ]),
      'The patient name or birth date on the report is not valid; correct them so the patient can be matched or created',
      template(
        g,
        'missingSummary',
        'Missing Details Summary',
        'The report has no patient {missing}; fill it in so the patient can be matched or created',
        { missing: joinText(g, 'missingText', 'Missing Details Text', ', ', missingList) }
      )
    ),
    'complete.summary'
  );
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
  g.add('match', 'billing.match-payers');
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
    when(
      g,
      'hasChoices',
      'Has Directory Choices',
      { candidates: [{ list: CHOICE }, 'unlinked.candidates'] },
      [{ field: 'candidates', op: 'present' }]
    ),
    makeObject(g, 'choicesByField', 'Choices by Field', {
      payerId: [{ list: CHOICE }, 'unlinked.candidates']
    })
  );
  const suggestion = makeObject(g, 'suggestion', 'Suggested Payer', {
    payerId: ['string', 'unlinked.suggested']
  });
  const context = makeObject(g, 'context', 'Payer Context', {
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
  g.add('link', 'billing.link-payer', { label: 'Remember Payer Name' });
  g.add('leaveOut', 'std.list.join', {
    label: 'Coverages Left Out',
    config: { count: 2, type: 'string' }
  });
  g.add('remove', 'std.var.set', {
    label: 'Leave Out the Coverages With This Name',
    config: { name: 'removed' }
  });
  g.add('removed', 'std.var.get', { config: { name: 'removed' } });
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
  const name = template(
    g,
    'name',
    'Patient Name',
    '{pcr.patient.firstName} {pcr.patient.lastName}',
    {
      pcr: 'entry.pcr'
    }
  );
  g.ret('return');
  g.wire(subjectOf(g, 'subject', [number, name]), 'return.subject');
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
    g.add(id, 'std.logic.choose', {
      label: `${label}, Else Its Code`,
      config: { mode: 'first', type: 'string', count: 2 }
    });
    g.wire(code, `${id}Label.key`, `${id}.option2`);
    g.wire(`${id}Label.value`, `${id}.option1`);
    return `${id}.value` as const;
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
  g.add('read', 'billing.read-narrative', { retry: { max: 3, delayMs: 30_000, factor: 4 } });
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
  g.ret('done');
  g.wire('entry.exec', 'resolve.exec');
  g.wire('entry.demographics', 'resolve.demographics', 'address.demographics');
  g.wire('entry.pcrNumber', 'resolve.pcrNumber');
  g.wire('resolve.then', 'address.exec');
  g.wire('resolve.patient', 'address.patient');
  g.wire('address.then', 'assign.exec');
  g.wire('address.patient', 'assign.patient', 'done.patient');
  g.wire('entry.claimId', 'assign.claimId');
  g.wire('assign.then', 'done.exec');
  return g.def;
};

const REVIEW_ANSWERS = ['classification', 'level', 'emergency', 'loadedMiles', 'note'];

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
  g.add('start', 'std.var.set', { label: 'Answers Given Before', config: { name: 'answers' } });
  g.add('answers', 'std.var.get', { label: 'Answers So Far', config: { name: 'answers' } });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('facts', 'billing.encounter-facts.break');
  g.add('reasonForTransport', 'billing.transport-reason', { label: 'Transport Reason' });
  g.add('documentation', 'std.object.set', {
    label: 'Documentation With the Transport Reason',
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
  g.add('warnings', 'billing.review-warnings', { label: 'Review Warnings' });
  const narrative = makeObject(g, 'narrative', 'Narrative', {
    medications: [{ list: 'string' }, 'medications.text'],
    procedures: [{ list: 'string' }, 'findings.procedures']
  });
  const condition = makeObject(g, 'condition', 'Condition', {
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
  const context = makeObject(g, 'context', 'Review Context', {
    patient: [{ object: {} }, 'patient.details'],
    trip: [{ object: {} }, 'trip.trip'],
    coverage: [{ list: { object: {} } }, 'coverage.details'],
    narrative: [{ object: {} }, narrative],
    condition: [{ object: {} }, condition],
    documentation: [{ object: {} }, documentation],
    suggested: [SERVICE, 'entry.service'],
    warnings: [{ list: 'string' }, 'warnings.warnings']
  });
  g.add('classified', 'std.object.set', {
    label: 'Suggestion With the Classification',
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
  g.add('given', 'std.object.make', {
    label: 'Answers',
    config: {
      fields: [
        { name: 'classification', type: 'string' },
        { name: 'level', type: 'string' },
        { name: 'emergency', type: 'boolean' },
        { name: 'loadedMiles', type: 'number' },
        { name: 'note', type: 'string' }
      ]
    }
  });
  g.add('remember', 'std.var.set', { label: 'Remember the Answers', config: { name: 'answers' } });
  const holdContext = makeObject(g, 'holdContext', 'Hold Context', {
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
  g.add('suggested', 'billing.service.break', { label: 'Suggested Service' });
  g.add('level', 'std.logic.coalesce', { label: 'Confirmed Level' });
  g.add('emergency', 'std.logic.coalesce', { label: 'Confirmed Emergency' });
  g.add('miles', 'std.logic.coalesce', { label: 'Confirmed Loaded Miles' });
  g.add('nonCovered', 'billing.non-covered-miles', { label: 'Non-Covered Miles' });
  const nonCoveredUnlessDead = select(
    g,
    'nonCoveredUnlessDead',
    'No Non-Covered Miles When Pronounced Dead',
    when(g, 'pronouncedDead', 'Pronounced Dead', { deceased: ['boolean', 'suggested.deceased'] }, [
      { field: 'deceased', op: 'is', value: true }
    ]),
    null,
    'nonCovered.nonCoveredMiles'
  );
  g.add('confirmed', 'billing.service.make', { label: 'Confirmed Service' });
  g.ret('approvedDone', 'approved');
  g.ret('voidedDone', 'voided');

  g.wire('entry.exec', 'start.exec');
  g.wire('entry.answers', 'start.value');
  g.wire('start.then', 'review.exec');
  g.wire('entry.pcr', 'trip.pcr', 'subject.pcr');
  g.wire('entry.facts', 'facts.facts');
  g.wire('facts.documentation', 'reasonForTransport.documentation', 'documentation.object');
  g.wire('facts.locations', 'reasonForTransport.locations');
  g.wire('reasonForTransport.transportReason', 'documentation.value');
  g.wire('documentation.object', 'docs.documentation', 'warnings.documentation');
  g.wire('entry.classification', 'trip.classification', 'classified.value');
  g.wire('entry.classification', 'warnings.classification', 'tripKind.key');
  g.wire('entry.reason', 'trip.reason', 'warnings.reason');
  g.wire('entry.patient', 'patient.person');
  g.wire('entry.coverages', 'coverage.list');
  g.wire('entry.findings', 'findings.findings', 'warnings.findings');
  g.wire('findings.medications', 'medications.list');
  g.wire(vitals, 'vitalTexts.list', 'warnings.vitals');
  g.wire(pcrField('procedures', 'Procedures', 'procedures'), 'proceduresCoded.list');
  g.wire('entry.payerNotes', 'warnings.payerNotes');
  g.wire('entry.service', 'warnings.service', 'classified.object', 'suggested.service');
  g.wire('classified.object', 'defaults.a');
  g.wire('answers.value', 'answered.object');
  g.wire('answered.object', 'defaults.b');
  g.wire('defaults.object', 'review.defaults');
  g.wire(context, 'review.context');
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
  g.wire('suggested.emergency', 'emergencyText.key');
  g.wire('suggested.loadedMiles', 'roundedMiles.value');
  g.wire('suggested.deceased', 'deceasedText.key');
  const serviceParts = makeList(g, 'serviceParts', 'Suggested Service Parts', 'string', [
    'tripKind.value',
    'suggested.level',
    'emergencyText.value',
    template(g, 'milesText', 'Loaded Miles Text', '[{miles} loaded miles]', {
      miles: 'roundedMiles.result'
    }),
    'deceasedText.value'
  ]);
  const fromNarrative = select(
    g,
    'fromNarrative',
    'Suggested From the Narrative',
    when(
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
    ', suggested from the narrative'
  );
  g.wire(
    select(
      g,
      'reviewSummary',
      'Task Summary',
      when(
        g,
        'nothingSuggested',
        'Nothing Suggested',
        { parts: [{ list: 'string' }, serviceParts] },
        [{ field: 'parts', op: 'empty' }]
      ),
      'Confirm the classification, level of service and loaded miles before this claim is priced',
      template(
        g,
        'confirmService',
        'Confirm the Service',
        'Confirm the service: {parts}{narrative}, before this claim is priced',
        {
          parts: joinText(g, 'serviceText', 'Suggested Service Text', ', ', serviceParts),
          narrative: fromNarrative
        }
      )
    ),
    'review.summary'
  );
  g.wire('subject.subject', 'review.subject', 'held.subject');
  for (const pin of REVIEW_ANSWERS) g.wire(`review.${pin}`, `given.${pin}`);

  g.wire('review.hold', 'remember.exec');
  g.wire('given.object', 'remember.value', 'approvedDone.answers');
  g.wire('remember.then', 'held.exec');
  g.wire(holdContext, 'held.context');
  summary(
    g,
    'held',
    'This PCR is on hold[: {note}]; release it back to review once it is sorted out, or void it',
    { note: 'review.note' }
  );
  g.wire('held.release', 'review.exec');
  g.wire('held.void', 'voidedDone.exec');

  g.wire('review.approve', 'approvedDone.exec');
  g.wire('review.classification', 'approvedDone.classification');
  g.wire('review.level', 'level.value');
  g.wire('suggested.level', 'level.fallback');
  g.wire('review.emergency', 'emergency.value');
  g.wire('suggested.emergency', 'emergency.fallback');
  g.wire('level.result', 'confirmed.level');
  g.wire('emergency.result', 'confirmed.emergency');
  g.wire('review.loadedMiles', 'miles.value');
  g.wire('suggested.loadedMiles', 'miles.fallback');
  g.wire('miles.result', 'confirmed.loadedMiles', 'nonCovered.loadedMiles');
  g.wire('entry.facts', 'nonCovered.facts');
  g.wire('suggested.deceased', 'confirmed.deceased');
  g.wire(nonCoveredUnlessDead, 'confirmed.nonCoveredMiles');
  g.wire('suggested.basis', 'confirmed.basis');
  g.wire('confirmed.service', 'approvedDone.service');
  return g.def;
};

const startCycle = (): GraphDef => {
  const g = action([p('claimId', { id: 'claim' })], [p('runId', { id: 'run' })]);
  g.add('inputs', 'std.object.make', {
    label: 'Cycle Inputs',
    config: { fields: [{ name: 'claimId', type: { id: 'claim' } }] }
  });
  g.add('cycle', 'std.flow.start-workflow', {
    label: 'Start Payer Cycle',
    config: { workflow: 'billing.cycle-claim', version: 1 }
  });
  g.add('attach', 'billing.attach-cycle', { label: 'Link Claim to Its Cycle' });
  g.ret('done');
  g.wire('entry.exec', 'cycle.exec');
  g.wire('entry.claimId', 'inputs.claimId', 'attach.claimId');
  g.wire('inputs.object', 'cycle.inputs');
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
  g.add('inputs', 'std.object.make', {
    label: 'Run Inputs',
    config: {
      fields: [
        { name: 'report', type: BLOB },
        { name: 'claimId', type: { id: 'claim' } }
      ]
    }
  });
  g.add('restart', 'std.flow.start-workflow', {
    label: 'Work the Claim From Its Report',
    config: { workflow: 'billing.encounter-to-claim', version: 1 }
  });
  g.ret('done');
  g.wire('entry.exec', 'restart.exec');
  g.wire('entry.report', 'inputs.report');
  g.wire('entry.claimId', 'inputs.claimId');
  g.wire('inputs.object', 'restart.inputs');
  g.wire('restart.then', 'done.exec');
  g.wire('restart.runId', 'done.runId');
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
  g.add('note', 'billing.note-revision');
  g.add('hasPrevious', 'std.logic.is-null', { label: 'No Earlier Report' });
  g.add('first', 'std.flow.branch', { label: 'Compare With the Earlier Report?' });
  g.add('readPrevious', 'nemsis.read-report', { label: 'Read the Earlier Report' });
  g.add('keep', 'std.var.set', { label: 'Earlier Report', config: { name: 'previous' } });
  g.add('previous', 'std.var.get', { label: 'Earlier PCR', config: { name: 'previous' } });
  g.input('pcr', 'pcr');
  g.input('contextClaimId', 'claimId');
  g.add('facts', 'billing.map-encounter-facts', { label: 'Map Encounter Facts' });
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('canApply', 'billing.can-rework-claim', { label: 'Can Rework Claim' });
  g.add('earlier', 'billing.report-revision-facts', { label: 'Earlier Report Facts' });
  g.add('current', 'billing.report-revision-facts', { label: 'New Report Facts' });
  const changeList = makeList(
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
  g.add('noEarlier', 'std.logic.is-null', { label: 'No Earlier PCR' });
  const changes = select(g, 'changes', 'Changes', 'noEarlier.result', null, changeList);
  const context = makeObject(g, 'context', 'Revision Context', {
    claimId: [{ id: 'claim' }, 'contextClaimId.claimId'],
    status: ['string', 'note.status'],
    canApply: ['boolean', 'canApply.canApply'],
    patient: [
      { object: {} },
      makeObject(g, 'patient', 'Patient', {
        name: ['string', 'current.patientName'],
        birthDate: ['string', 'current.birthDate']
      })
    ],
    trip: [{ object: {} }, 'trip.trip'],
    changes: [{ list: CHANGE }, changes]
  });
  g.add('fields', 'std.list.pluck', { label: 'Changed Field Names', values: { field: 'field' } });
  g.add('firstThree', 'std.list.slice', { label: 'First Three', values: { start: 0, end: 3 } });
  g.add('listedLower', 'std.text.lower', { label: 'In Small Letters' });
  g.add('count', 'std.list.length', { label: 'How Many Changed' });
  g.add('beyond', 'std.math.subtract', { label: 'Beyond Three', values: { b: 3 } });
  g.wire(changes, 'fields.list', 'count.list');
  g.wire('fields.list', 'firstThree.list');
  g.wire(joinText(g, 'listed', 'Listed', ', ', 'firstThree.list'), 'listedLower.text');
  g.wire('count.length', 'beyond.a');
  const more = select(
    g,
    'more',
    'How Many More',
    when(g, 'moreThanThree', 'More Than Three', { count: ['integer', 'count.length'] }, [
      { field: 'count', op: 'gt', value: 3 }
    ]),
    'beyond.result'
  );
  g.add('headline', 'std.logic.choose', {
    label: 'What Changed',
    config: { mode: 'byCase', type: 'string', cases: [{ when: '0' }] },
    values: {
      case1: 'A newer version of this report arrived with no changes to its billing details'
    }
  });
  g.wire('count.length', 'headline.key');
  g.wire(
    template(
      g,
      'changed',
      'Changes Text',
      'A newer version of this report changes the {fields}[ and {more} more]',
      { fields: 'listedLower.result', more }
    ),
    'headline.otherwise'
  );
  const arrived = select(
    g,
    'arrived',
    'What Arrived',
    'noEarlier.result',
    'A newer version of this report arrived',
    'headline.value'
  );
  g.add('statusText', 'std.logic.coalesce', {
    label: 'Status, Else None',
    values: { fallback: '' }
  });
  g.add('statusWords', 'std.text.replace', {
    label: 'Status in Words',
    values: { find: '_', replacement: ' ' }
  });
  g.add('statusOrPast', 'std.logic.choose', {
    label: 'Status, Else Past Review',
    config: { mode: 'first', type: 'string', count: 2 },
    values: { option2: 'past review' }
  });
  g.wire('note.status', 'statusText.value');
  g.wire('statusText.result', 'statusWords.text');
  g.wire('statusWords.result', 'statusOrPast.option1');
  const next = select(
    g,
    'next',
    'What to Do',
    'canApply.canApply',
    '; apply it, acknowledge it or void the claim',
    template(
      g,
      'correctIt',
      'Correct It Text',
      '; the claim is {status}, so correct it with a Correct Claim Data task on the claim or acknowledge it',
      { status: 'statusOrPast.value' }
    )
  );
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
  g.add('rework', 'billing.rework-claim', { label: 'Work the Claim From the New Report' });
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
  g.wire('note.restartable', 'first.exec');
  g.wire('note.billed', 'first.exec');
  g.wire('note.previous', 'hasPrevious.value', 'readPrevious.report');
  g.wire('note.status', 'canApply.status');
  g.wire('hasPrevious.result', 'first.condition');
  g.wire('first.true', 'revision.exec');
  g.wire('first.false', 'readPrevious.exec');
  g.wire('readPrevious.then', 'keep.exec');
  g.wire('readPrevious.pcr', 'keep.value');
  g.wire('keep.then', 'revision.exec');
  g.wire('previous.value', 'earlier.pcr', 'noEarlier.value');
  g.wire('pcr.pcr', 'trip.pcr', 'subject.pcr', 'current.pcr');
  g.wire('classify.classification', 'trip.classification');
  g.wire('classify.reason', 'trip.reason');
  g.wire('subject.subject', 'revision.subject');
  summary(g, 'revision', '{arrived}{next}', { arrived, next });
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
  g.add('read', 'nemsis.read-report');
  g.add('pcr', 'nemsis.pcr.break');
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
  g.add('context', 'std.object.make', {
    label: 'Orphan Context',
    config: {
      fields: [
        { name: 'claimId', type: { id: 'claim' } },
        { name: 'reason', type: 'string' }
      ]
    }
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
  g.wire('entry.claimId', 'context.claimId', 'rework.claimId', 'void.claimId');
  g.wire('entry.reason', 'context.reason');
  g.wire('entry.report', 'rework.report');
  g.wire('context.object', 'orphan.context');
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
    'Employees at the employer that sponsors the group health plan: working aged needs 20 or more (42 CFR 411.172), disability 100 or more (42 CFR 411.101).',
    true
  ),
  d(
    'mspAccident',
    'string',
    'Accident',
    'An accident or work injury someone else pays for: none, liability, noFault or workersComp.',
    true
  )
];

const medicareSecondaryPayer = (): GraphDef => {
  const g = rule(MSP_ANSWERS, [
    d(
      'medicareSecondary',
      'boolean',
      'Medicare Secondary',
      'Whether another payer pays before Medicare.'
    ),
    d(
      'insuranceType',
      'string',
      'MSP Type',
      'The Medicare secondary payer type (SBR05): 12 working aged, 13 ESRD, 14 no-fault, 15 workers compensation, 43 disability, 47 liability.',
      true
    ),
    P.reasons('Medicare pays first or second')
  ]);
  g.add('decide', 'std.table.decide', {
    label: 'Medicare Secondary Payer',
    config: shared.decision(
      'billing.medicare-secondary-payer',
      'Medicare Secondary Payer',
      'Decides from the MSP answers whether another payer pays before Medicare, and the MSP type the 837P names for it.',
      table(
        [
          field('mspAccident', 'string', 'Accident or work injury'),
          field('mspEsrd', 'boolean', 'End-stage renal disease coordination period'),
          field('mspEmployerPlan', 'boolean', 'Group health plan from current employment'),
          field('mspDisability', 'boolean', 'Disabled with a group health plan from employment'),
          field('mspEmployerSize', 'integer', 'Employees at the plan sponsor')
        ],
        [
          field('secondary', 'boolean', 'Medicare pays second'),
          field('insuranceType', 'string', 'MSP type (SBR05)')
        ],
        [
          {
            label: "Workers' compensation pays first",
            when: { mspAccident: is('workersComp') },
            set: { secondary: true, insuranceType: '15' }
          },
          {
            label: 'No-fault or auto insurance pays first',
            when: { mspAccident: is('noFault') },
            set: { secondary: true, insuranceType: '14' }
          },
          {
            label: 'Liability insurance pays first',
            when: { mspAccident: is('liability') },
            set: { secondary: true, insuranceType: '47' }
          },
          {
            label: 'End-stage renal disease coordination period',
            when: { mspEsrd: is(true) },
            set: { secondary: true, insuranceType: '13' }
          },
          {
            label: 'Working aged with a group health plan from an employer of 20 or more',
            when: { mspEmployerPlan: is(true), mspEmployerSize: atLeast(20) },
            set: { secondary: true, insuranceType: '12' }
          },
          {
            label: 'Disabled with a group health plan from an employer of 100 or more',
            when: { mspDisability: is(true), mspEmployerSize: atLeast(100) },
            set: { secondary: true, insuranceType: '43' }
          }
        ],
        { secondary: false }
      )
    )
  });
  g.ret('return');
  for (const { name } of MSP_ANSWERS) g.wire(`entry.${name}`, `decide.${name}`);
  g.wire('decide.secondary', 'return.medicareSecondary');
  g.wire('decide.insuranceType', 'return.insuranceType');
  g.wire('decide.rules', 'return.reasons');
  return g.def;
};

const coordinationOrder = (): GraphDef => {
  const g = rule(
    [
      P.coverages('The payers as resolved.'),
      d(
        'medicareSecondary',
        'boolean',
        'Medicare Secondary',
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
    label: 'Each With Its Billing Rank',
    config: { rule: 'billing.coverage-billing-rank', version: 1, item: 'coverage' }
  });
  g.add('sorted', 'std.list.sort-by-field', { label: 'By Rank', values: { field: 'rank' } });
  g.add('ordered', 'std.list.pluck', {
    label: 'By Priority, Then as Reported',
    values: { field: 'coverage' }
  });
  g.add('count', 'std.list.length', { label: 'How Many Payers' });
  g.add('othersFirst', 'std.list.where', {
    label: 'Payers Other Than Medicare',
    config: { field: 'claimFiling', op: 'notOneOf', value: MEDICARE_FILING }
  });
  g.ret('return');
  g.wire('entry.coverages', 'ranked.list', 'count.list', 'othersFirst.list');
  g.wire('entry.medicareSecondary', 'ranked.medicareSecondary');
  g.wire('ranked.ranked', 'sorted.list');
  g.wire('sorted.list', 'ordered.list');
  g.wire('ordered.list', 'return.coverages');
  const inOrder = select(
    g,
    'inOrder',
    'Priority Order Reason',
    when(g, 'several', 'Several Payers', { count: ['integer', 'count.length'] }, [
      { field: 'count', op: 'gt', value: 1 }
    ]),
    'Billed in the priority order the report gives, then as reported'
  );
  const medicareAfter = select(
    g,
    'medicareAfter',
    'Medicare After Reason',
    when(
      g,
      'medicareSecond',
      'Medicare Pays After Others',
      {
        medicareSecondary: ['boolean', 'entry.medicareSecondary'],
        others: ['integer', 'othersFirst.count']
      },
      [
        { field: 'medicareSecondary', op: 'is', value: true },
        { field: 'others', op: 'gt', value: 0 }
      ]
    ),
    'Medicare is billed after the payers that pay first'
  );
  g.wire(makeList(g, 'reasons', 'Why', 'string', [inOrder, medicareAfter]), 'return.reasons');
  return g.def;
};

const determinePayers = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [
      d('coverages', COVERAGES, 'Reported Coverages', 'The coverages the report lists.'),
      p('pcr', PCR_TYPE, true),
      p('pcrNumber', 'string', true),
      p('patientName', 'string', true),
      p('facts', FACTS, true)
    ],
    outputs: [p('coverages', COVERAGES), p('notes', { list: 'string' })]
  });
  g.add('resolve', 'billing.resolve-payers', { label: 'Match Payer Directory' });
  g.add('facts', 'billing.encounter-facts.break');
  g.add('documentation', 'billing.documentation.break');
  g.add('msp', 'billing.medicare-secondary-payer', { label: 'Medicare Secondary Payer' });
  g.add('order', 'billing.coordination-order', { label: 'Coordination Order' });
  g.add('agency', 'billing.agency-payers', { label: 'Agency Payer Rules' });
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
  g.wire('order.coverages', 'agency.coverages');
  g.wire('entry.pcr', 'agency.pcr');
  g.wire('agency.coverages', 'done.coverages');
  g.wire('resolve.notes', 'done.notes');
  return g.def;
};

const tripContext = (g: Builder, id: string, trip: Port) =>
  makeObject(g, id, 'Trip Context', { trip: [{ object: {} }, trip] });

const buildClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['saved', 'voided'],
    inputs: [
      p('claimId', { id: 'claim' }),
      p('report', BLOB, true),
      p('pcr', PCR_TYPE),
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
  g.add('primary', 'std.list.first', { label: 'Primary Payer' });
  g.add('primaryPayer', 'billing.coverage.break');
  g.add('charges', 'billing.assign-charges', { label: 'Assign Charges' });
  g.add('claim', 'billing.map-claim', { label: 'Assign Claim Properties' });
  g.add('agencyClaim', 'billing.agency-claim', { label: 'Agency Claim Rules' });
  g.add('save', 'billing.save-claim', { label: 'Save Draft Claim' });
  g.add('eligibilityInputs', 'std.object.make', {
    label: 'Eligibility Inputs',
    config: { fields: [{ name: 'claimId', type: { id: 'claim' } }] }
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
  g.wire('claim.claim', 'agencyClaim.claim');
  g.wire('entry.pcr', 'agencyClaim.pcr');
  g.wire('agencyClaim.claim', 'save.claim');
  g.wire('entry.claimId', 'save.claimId', 'eligibilityInputs.claimId');
  g.wire('eligibilityInputs.object', 'eligibility.inputs');
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
    label: 'Classification',
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
  const claimContext = tripContext(g, 'claimContext', 'trip.trip');
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
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
  g.wire('entry.pcr', 'review.pcr', 'trip.pcr', 'subject.pcr', 'build.pcr');
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

  g.wire('reviewed.then', 'build.exec');
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
  g.add('findings', 'billing.read-findings', { label: 'Narrative Findings' });
  g.add('patient', 'billing.claim-patient', { label: 'Claim Patient' });
  g.add('patientName', 'std.text.template', {
    label: 'Patient Name',
    config: { template: '{demographics.firstName} {demographics.lastName}' }
  });
  g.add('payers', 'billing.determine-payers', { label: 'Determine Payers' });
  g.add('bill', 'billing.bill-claim', { label: 'Bill the Claim' });
  g.ret('skipped', 'skipped');
  g.ret('claimed', 'claimed');
  g.ret('voided', 'voided');

  g.wire('entry.exec', 'facts.exec');
  g.wire('entry.pcr', 'facts.pcr', 'decide.pcr', 'payers.pcr', 'bill.pcr');
  g.wire('facts.then', 'decide.exec');
  g.wire('facts.facts', 'parts.facts', 'decide.facts', 'bill.facts');
  g.wire('parts.trip', 'trip.trip');
  g.wire('parts.clinical', 'clinical.clinical');
  g.wire('decide.skip', 'skip.exec');
  g.wire('entry.claimId', 'skip.claimId', 'patient.claimId', 'bill.claimId');
  g.wire('skip.then', 'skipped.exec');
  g.wire('decide.classification', 'skipped.classification', 'bill.classification');
  g.wire('decide.reason', 'bill.reason');
  g.wire('decide.claim', 'findings.exec');
  g.wire('clinical.narrative', 'findings.narrative');
  g.wire('findings.then', 'patient.exec');
  g.wire('parts.patient', 'patient.demographics', 'patientName.demographics');
  g.wire('trip.pcrNumber', 'patient.pcrNumber', 'payers.pcrNumber');
  g.wire('patient.then', 'payers.exec');
  g.wire('parts.coverages', 'payers.coverages');
  g.wire('facts.facts', 'payers.facts');
  g.wire('patientName.text', 'payers.patientName');
  g.wire('payers.then', 'bill.exec');
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
  slot(
    'billing.agency-payers',
    'Agency Payer Rules',
    'An agency rule after payers are resolved and ordered: reorder, add or drop coverages before the claim is billed. Passes the coverages through unchanged until an agency overrides it.',
    {
      execIn: [],
      execOut: [],
      inputs: [
        d(
          'coverages',
          COVERAGES,
          'Coverages',
          'The payers resolved from the report, in billing order.'
        ),
        P.pcr(true)
      ],
      outputs: [d('coverages', COVERAGES, 'Coverages', 'The payers to bill, in order.')]
    }
  ),
  asRule(
    'billing.patient-details',
    'Patient Details',
    'Writes a patient for a biller: name, birth date, sex (Sex Labels table) and address.',
    patientDetails()
  ),
  asRule(
    'billing.patient-match-context',
    'Patient Match Context',
    'What a biller sees when matching a report to a patient: why, the reported patient with the PCR number, and the details of each candidate.',
    patientMatchContext()
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
    'Writes a reported payer name in small letters, so the same name in any case is asked about once.',
    payerNameKey()
  ),
  asRule(
    'billing.payer-has-name',
    'Payer Has Name',
    'Says whether a reported payer has a name, in any case.',
    payerHasName()
  ),
  asRule(
    'billing.payer-name-task',
    'Payer Name Task',
    'Gathers the unlinked payers with one name into one task: the first of them, with the coverage keys of all.',
    payerNameTask()
  ),
  asRule(
    'billing.is-suggested-payer',
    'Is Suggested Payer',
    'Says whether a directory choice is the payer suggested for a name.',
    isSuggestedPayer()
  ),
  asRule(
    'billing.coverage-details',
    'Coverage Details',
    'Writes a payer for a biller: the name reported, its directory payer or that it is not linked, member ID and group ID.',
    coverageDetails()
  ),
  asRule(
    'billing.medication-text',
    'Medication Text',
    'Writes a medication the narrative documents as its name and route, with the doses when more than one.',
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
    'Warns the PCR reviewer about what could not be read or decided: no classification reason, no signature, no certification for a scheduled trip, no vital signs, a death before loading, non-covered miles, several patients, and the narrative and payer notes.',
    reviewWarnings()
  ),
  asRule(
    'billing.report-revision-facts',
    'Report Revision Facts',
    'The billing details of a report version that a revision compares: patient, times, places, impressions, care, response, odometers, payers and narrative length.',
    reportRevisionFacts()
  ),
  asRule(
    'billing.revision-change',
    'Revision Change',
    'Gives a field with its earlier and new values when a newer report changed it, or nothing.',
    revisionChange()
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
    'Ranks a payer for billing order: its reported priority (Coverage Priority table), after the other payers when it is Medicare and another payer pays first.',
    coverageBillingRank()
  ),
  asStage(
    'billing.review-patient-match',
    'Review Patient Match',
    'Asks a biller to pick the patient among likely matches for report demographics, or to create a new patient from the report.',
    reviewPatientMatch()
  ),
  asStage(
    'billing.resolve-patient',
    'Resolve Patient',
    'Matches report demographics to a patient, creates one when nothing is close, asks a biller to pick among likely matches or create a new one, and asks for a missing or invalid name or birth date (prefilled with what was entered before), then matches the completed details the same way.',
    resolvePatient()
  ),
  asStage(
    'billing.resolve-payers',
    'Match Payer Directory',
    'Links report payers to the payer directory and asks a biller about every other name: link it (remembered for later reports), leave it unlisted, or remove it when it is not insurance. Outputs what limited the matching.',
    resolvePayers()
  ),
  asRule(
    'billing.medicare-secondary-payer',
    'Medicare Secondary Payer',
    'Decides from the MSP answers (employer plan, ESRD, disability, accident or work injury) whether another payer pays before Medicare, with the MSP type the 837P names (Medicare Secondary Payer table).',
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
    'Determines the payers to bill from the reported coverages: Match Payer Directory, Medicare Secondary Payer from the MSP answers the report gives, Coordination Order, then the Agency Payer Rules.',
    determinePayers()
  ),
  asRule(
    'billing.pcr-subject',
    'PCR Subject',
    'Names a report in task lists: its PCR number and the patient name.',
    pcrSubject()
  ),
  asRule(
    'billing.trip-summary',
    'Trip Summary',
    'Describes a trip for billers: PCR number, classification and why, call time, response, care, impressions, pickup and destination.',
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
    'Resolves the patient from the report demographics, keeps their current address and assigns them to the draft claim.',
    claimPatient()
  ),
  asStage(
    'billing.review-pcr',
    'Review PCR',
    'Coding review: asks a biller to confirm the classification, level of service and loaded miles, prefilled with earlier answers or the suggestion and showing every reason. Held reports wait for release or void.',
    reviewPcr()
  ),
  asStage(
    'billing.build-claim',
    'Build Claim',
    'Assigns the charges for the confirmed service, priced for the primary payer, assigns the claim properties from the encounter facts, applies the Agency Claim Rules and saves the draft, then checks the payers eligibility; or voids.',
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
    'Starts Encounter to Claim again for a claim from its report.',
    reworkClaim()
  ),
  asStage(
    'billing.review-revision',
    'Review Updated PCR',
    'Shows a biller what a newer report changed on an existing claim, and works the claim again from it, keeps the claim as it is, or voids it.',
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
    'Turns one patient care report into a claim: opens a draft claim (or works an existing one again), maps the encounter facts, classifies the trip, reads the narrative when the model is up, resolves the patient and payers, determines the service, has a biller confirm it, assigns and prices the charges and claim properties, saves the draft, checks and fixes it and starts its payer cycle. Reports already billed become revisions of their claim, shown with what changed.',
    encounterToClaim()
  ),
  asWorkflow(
    'billing.recover-draft',
    'Recover Draft Claim',
    'Asks a biller what to do with a draft claim whose workflow stopped: work it again from its report, or void it.',
    recoverDraft()
  )
];
