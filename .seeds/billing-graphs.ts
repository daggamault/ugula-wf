import { type Edge, ENTRY_TYPE, type GraphDef, type NodeInstance, RETURN_TYPE } from '@ugula/graph';
import type { SeedGraph } from './graphs.ts';

const node = (
  id: string,
  type: string,
  extra: Partial<Omit<NodeInstance, 'id' | 'type'>> = {}
): NodeInstance => ({ id, type, version: 1, ...extra });

const edge = (from: string, fromPin: string, to: string, toPin: string): Edge => ({
  from,
  fromPin,
  to,
  toPin
});

const BLOB = { object: { bucket: 'string', key: 'string' } } as const;

const SUMMARY = `{
  pcrNumber: findKey(report, 'eRecord.01'),
  lastName: findKey(report, 'ePatient.02'),
  firstName: findKey(report, 'ePatient.03'),
  birthDate: findKey(report, 'ePatient.17'),
  gender: findKey(report, 'ePatient.25') ?? findKey(report, 'ePatient.13'),
  addressLine: findKey(report, 'ePatient.05'),
  city: findKey(report, 'ePatient.06'),
  state: findKey(report, 'ePatient.08'),
  postalCode: findKey(report, 'ePatient.09'),
  incidentAt: findKey(report, 'eTimes.01'),
  pickup: {
    addressLine: findKey(report, 'eScene.15'),
    city: findKey(report, 'eScene.17'),
    state: findKey(report, 'eScene.18'),
    postalCode: findKey(report, 'eScene.19')
  },
  destination: {
    name: findKey(report, 'eDisposition.01'),
    addressLine: findKey(report, 'eDisposition.03'),
    city: findKey(report, 'eDisposition.04'),
    state: findKey(report, 'eDisposition.05'),
    postalCode: findKey(report, 'eDisposition.07')
  },
  coverages: map(findKey(report, 'ePayment.InsuranceGroup') ?? [], g => {
    payer: g['ePayment.10'],
    payerCode: g['ePayment.09'],
    priority: g['ePayment.11'],
    memberId: g['ePayment.18'],
    groupId: g['ePayment.17']
  }),
  primaryImpression: findKey(report, 'eSituation.11'),
  secondaryImpressions: findKey(report, 'eSituation.12') ?? [],
  careLevel: findKey(report, 'eDisposition.32'),
  responseMode: findKey(report, 'eResponse.23'),
  sceneOdometer: findKey(report, 'eResponse.20'),
  destinationOdometer: findKey(report, 'eResponse.21'),
  ivMedicationCount: count(
    findKey(report, 'eMedications.MedicationGroup') ?? [],
    m => contains(['9927021', '9927023', '9927069'], m['eMedications.04'])
  ),
  payer: first(map(
    filter(findKey(report, 'ePayment.InsuranceGroup') ?? [], g => g['ePayment.11'] == '2611003'),
    g => g['ePayment.10']
  )) ?? (findKey(report, 'ePayment.01') == '2601005' ? 'Medicare'
    : findKey(report, 'ePayment.01') == '2601003' ? 'Medicaid'
    : null)
}`;

const LEVEL_RULES = `{
  level: summary.careLevel == '4232009' ? 'SCT'
    : contains(['4232003', '4232005'], summary.careLevel)
      ? ((summary.ivMedicationCount ?? 0) >= 3 ? 'ALS2' : 'ALS1')
      : 'BLS',
  emergency: contains(['2223001', '2223007'], summary.responseMode),
  loadedMiles: summary.sceneOdometer != null && summary.destinationOdometer != null
    ? max(0, round(number(summary.destinationOdometer) - number(summary.sceneOdometer), 1))
    : null
}`;

const CLAIM_LINES = `concat(
  [{
    code: service.level == 'SCT' ? 'A0434'
      : service.level == 'ALS2' ? 'A0433'
      : service.level == 'ALS1' ? (service.emergency ? 'A0427' : 'A0426')
      : (service.emergency ? 'A0429' : 'A0428'),
    units: 1
  }],
  (service.loadedMiles ?? 0) > 0
    ? [{ code: 'A0425', units: ceil(service.loadedMiles * 10) / 10 }]
    : []
)`;

const SERVICE = { object: { level: 'string', emergency: 'boolean' } } as const;

const LINES = { list: { object: { code: 'string', units: 'number' } } } as const;

// Task contexts are what reviewers read, so they spell out NEMSIS codes and leave out internal ids.
// Reports may carry a numeric GNIS code instead of a city name, and a FIPS code for the state.
const placeOf = (place: string, withState = false) =>
  `join(filter([
    ${place}.addressLine,
    ${place}.city != null && !every(split(${place}.city, ''), d => contains('0123456789', d)) ? ${place}.city : null,
    ${withState ? `${place}.state,` : ''}
    ${place}.postalCode
  ], x => x != null && x != ''), ', ')`;

// Repeated NEMSIS values can come with XML attributes, as { '#text': value, ... }.
const textOf = (value: string) => `get(${value}, '#text') ?? ${value}`;

const SEX = "{ F: 'Female', M: 'Male', U: 'Unknown' }";

const REVIEW_CONTEXT = `{
  patient: {
    name: patient.firstName + ' ' + patient.lastName,
    birthDate: patient.birthDate,
    sex: ${SEX}[patient.gender ?? ''] ?? null,
    address: ${placeOf('patient', true)}
  },
  trip: {
    pcrNumber: summary.pcrNumber,
    incidentAt: summary.incidentAt,
    response: {
      '2223001': 'Emergent',
      '2223003': 'Emergent, downgraded to non-emergent',
      '2223005': 'Non-emergent',
      '2223007': 'Non-emergent, upgraded to emergent'
    }[summary.responseMode ?? ''] ?? summary.responseMode,
    careProvided: {
      '4232001': 'BLS',
      '4232003': 'ALS',
      '4232005': 'ALS',
      '4232009': 'Critical care'
    }[summary.careLevel ?? ''] ?? summary.careLevel,
    primaryImpression: ${textOf('summary.primaryImpression')},
    otherImpressions: map(summary.secondaryImpressions, i => ${textOf('i')}),
    ivMedications: summary.ivMedicationCount,
    pickup: ${placeOf('summary.pickup')},
    destination: join(filter([summary.destination.name, ${placeOf('summary.destination')}], x => x != null && x != ''), ' · ')
  },
  coverage: map(sort(summary.coverages, c => c.priority ?? '9'), c => {
    order: { '2611003': 'Primary', '2611005': 'Secondary', '2611007': 'Tertiary' }[c.priority ?? ''] ?? 'Other',
    payer: c.payer,
    memberId: c.memberId,
    groupId: c.groupId
  }),
  suggested: service
}`;

const PATIENT_REVIEW_CONTEXT = `{
  reason: reason,
  report: {
    name: demographics.firstName + ' ' + demographics.lastName,
    birthDate: demographics.birthDate,
    sex: {
      '9906001': 'Female', '9906003': 'Male', '9906005': 'Unknown',
      '9919001': 'Female', '9919003': 'Male', '9919005': 'Unknown'
    }[demographics.gender ?? ''] ?? null,
    address: ${placeOf('demographics')},
    pcrNumber: demographics.pcrNumber
  },
  candidates: map(candidates, c => {
    name: c.firstName + ' ' + c.lastName,
    birthDate: c.birthDate,
    sex: ${SEX}[c.gender ?? ''] ?? null,
    address: ${placeOf('c', true)}
  })
}`;

const pureGraph = (
  input: { name: string; type: GraphDef['signature']['inputs'][number]['type'] },
  output: { name: string; type: GraphDef['signature']['outputs'][number]['type'] },
  label: string,
  expression: string
): GraphDef => ({
  signature: { execIn: [], execOut: [], inputs: [input], outputs: [output] },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('rules', 'std.expr', { label, config: { expression } }),
    node('return', RETURN_TYPE)
  ],
  edges: [
    edge('entry', input.name, 'rules', input.name),
    edge('rules', 'result', 'return', output.name)
  ]
});

const levelOfServiceGraph = pureGraph(
  { name: 'summary', type: { object: {} } },
  { name: 'service', type: SERVICE },
  'Level of service rules',
  LEVEL_RULES
);

const claimLinesGraph = pureGraph(
  { name: 'service', type: SERVICE },
  { name: 'lines', type: LINES },
  'HCPCS lines',
  CLAIM_LINES
);

const pcrSummaryGraph: GraphDef = {
  signature: {
    execIn: [],
    execOut: [],
    inputs: [{ name: 'report', type: { object: {} } }],
    outputs: [{ name: 'summary', type: { object: {} } }]
  },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('fields', 'std.expr', { label: 'Billing fields', config: { expression: SUMMARY } }),
    node('return', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'report', 'fields', 'report'),
    edge('fields', 'result', 'return', 'summary')
  ]
};

const PATIENT = {
  object: { id: 'string', firstName: 'string', lastName: 'string', birthDate: 'string' }
} as const;

const PATIENT_CHOICES = `len(candidates) > 0 ? {
  patientId: map(candidates, c => {
    value: c.id,
    label: c.lastName + ', ' + c.firstName + ' · born ' + c.birthDate +
      (c.postalCode ? ' · ' + c.postalCode : '')
  })
} : null`;

const resolvePatientGraph: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [{ name: 'demographics', type: { object: {} } }],
    outputs: [{ name: 'patient', type: PATIENT }]
  },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('match', 'billing.match-patient'),
    node('create', 'billing.create-patient', { inputs: { reuseMatch: { value: true } } }),
    node('choices', 'std.expr', {
      label: 'Candidate choices',
      config: { expression: PATIENT_CHOICES }
    }),
    node('context', 'std.expr', {
      label: 'Review context',
      config: { expression: PATIENT_REVIEW_CONTEXT }
    }),
    node('confirm', 'std.human.task', {
      label: 'Confirm patient',
      config: {
        title: 'Confirm patient',
        queue: 'billing-patients',
        instructions:
          'Link this report to one of the candidate patients, or correct the demographics and create a new patient when none of them is this person.',
        fields: [
          { name: 'patientId', type: 'string', label: 'Existing patient' },
          { name: 'firstName', type: 'string', label: 'First name' },
          { name: 'lastName', type: 'string', label: 'Last name' },
          { name: 'birthDate', type: 'string', label: 'Birth date (YYYY-MM-DD)' }
        ],
        outcomes: ['link', 'create']
      }
    }),
    node('corrected', 'std.expr', {
      label: 'Corrected demographics',
      config: {
        expression:
          'merge(demographics, { firstName: firstName, lastName: lastName, birthDate: birthDate })'
      }
    }),
    node('createReviewed', 'billing.create-patient', { label: 'Create reviewed patient' }),
    node('find', 'billing.find-patient'),
    node('matched', RETURN_TYPE),
    node('created', RETURN_TYPE),
    node('reviewed', RETURN_TYPE),
    node('linked', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'exec', 'match', 'exec'),
    edge('entry', 'demographics', 'match', 'demographics'),
    edge('entry', 'demographics', 'create', 'demographics'),
    edge('match', 'matched', 'matched', 'exec'),
    edge('match', 'patient', 'matched', 'patient'),
    edge('match', 'unmatched', 'create', 'exec'),
    edge('create', 'then', 'created', 'exec'),
    edge('create', 'patient', 'created', 'patient'),
    edge('match', 'review', 'confirm', 'exec'),
    edge('match', 'candidates', 'choices', 'candidates'),
    edge('choices', 'result', 'confirm', 'options'),
    edge('match', 'reason', 'context', 'reason'),
    edge('match', 'candidates', 'context', 'candidates'),
    edge('match', 'demographics', 'context', 'demographics'),
    edge('context', 'result', 'confirm', 'context'),
    edge('match', 'demographics', 'confirm', 'defaults'),
    edge('confirm', 'link', 'find', 'exec'),
    edge('confirm', 'patientId', 'find', 'patientId'),
    edge('confirm', 'create', 'createReviewed', 'exec'),
    edge('match', 'demographics', 'corrected', 'demographics'),
    edge('confirm', 'firstName', 'corrected', 'firstName'),
    edge('confirm', 'lastName', 'corrected', 'lastName'),
    edge('confirm', 'birthDate', 'corrected', 'birthDate'),
    edge('corrected', 'result', 'createReviewed', 'demographics'),
    edge('createReviewed', 'then', 'reviewed', 'exec'),
    edge('createReviewed', 'patient', 'reviewed', 'patient'),
    edge('find', 'then', 'linked', 'exec'),
    edge('find', 'patient', 'linked', 'patient')
  ]
};

const processPcrGraph: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'report', type: BLOB }],
    outputs: [
      { name: 'summary', type: { object: {} } },
      { name: 'patient', type: PATIENT },
      { name: 'charges', type: { object: {} } },
      { name: 'claimId', type: 'string' }
    ]
  },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('read', 'nemsis.read-report'),
    node('summary', 'billing.pcr-summary'),
    node('patient', 'billing.resolve-patient', { label: 'Resolve patient' }),
    node('service', 'billing.level-of-service', { label: 'Suggest level of service' }),
    node('claim', 'std.expr', {
      label: 'Claim context',
      config: { expression: REVIEW_CONTEXT }
    }),
    node('review', 'std.human.task', {
      label: 'Review PCR',
      config: {
        title: 'Review PCR',
        queue: 'billing-review',
        instructions:
          'Check the patient and impression codes, and confirm the level of service and loaded miles before this claim is priced.',
        fields: [
          {
            name: 'level',
            type: 'string',
            label: 'Level of service',
            options: [
              { value: 'BLS', label: 'BLS' },
              { value: 'ALS1', label: 'ALS1' },
              { value: 'ALS2', label: 'ALS2' },
              { value: 'SCT', label: 'Specialty care transport' }
            ]
          },
          { name: 'emergency', type: 'boolean', label: 'Emergency response' },
          { name: 'loadedMiles', type: 'number', label: 'Loaded miles' },
          { name: 'note', type: 'string', label: 'Note' }
        ],
        outcomes: ['approve', 'hold']
      }
    }),
    node('confirmed', 'std.expr', {
      label: 'Confirmed service',
      config: {
        expression:
          '{ level: level ?? service.level, emergency: emergency ?? service.emergency, loadedMiles: loadedMiles }'
      }
    }),
    node('lines', 'billing.claim-lines', { label: 'HCPCS lines' }),
    node('payer', 'std.expr', { label: 'Primary payer', config: { expression: 'summary.payer' } }),
    node('price', 'billing.price-claim'),
    node('charges', 'std.expr', {
      label: 'Charges',
      config: {
        expression: 'merge(service, { payer: payer, lines: lines, totalCents: totalCents })'
      }
    }),
    node('reason', 'std.text.template', { config: { template: 'Held by reviewer: {{ note }}' } }),
    node('hold', 'std.flow.fail', { label: 'Hold claim' }),
    node('open', 'billing.open-claim'),
    node('cycleInputs', 'std.expr', { config: { expression: '{ claimId: claimId }' } }),
    node('cycle', 'std.flow.start-workflow', {
      label: 'Start payer cycle',
      config: { workflow: 'billing.cycle-claim', version: 1 }
    }),
    node('attach', 'billing.attach-cycle', { label: 'Link claim to its cycle' }),
    node('approved', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'exec', 'read', 'exec'),
    edge('entry', 'report', 'read', 'report'),
    edge('read', 'then', 'patient', 'exec'),
    edge('read', 'data', 'summary', 'report'),
    edge('summary', 'summary', 'patient', 'demographics'),
    edge('summary', 'summary', 'service', 'summary'),
    edge('patient', 'then', 'review', 'exec'),
    edge('patient', 'patient', 'claim', 'patient'),
    edge('summary', 'summary', 'claim', 'summary'),
    edge('service', 'service', 'claim', 'service'),
    edge('claim', 'result', 'review', 'context'),
    edge('service', 'service', 'review', 'defaults'),
    edge('review', 'approve', 'price', 'exec'),
    edge('review', 'level', 'confirmed', 'level'),
    edge('review', 'emergency', 'confirmed', 'emergency'),
    edge('review', 'loadedMiles', 'confirmed', 'loadedMiles'),
    edge('service', 'service', 'confirmed', 'service'),
    edge('confirmed', 'result', 'lines', 'service'),
    edge('lines', 'lines', 'price', 'lines'),
    edge('summary', 'summary', 'payer', 'summary'),
    edge('payer', 'result', 'price', 'payer'),
    edge('payer', 'result', 'charges', 'payer'),
    edge('price', 'then', 'open', 'exec'),
    edge('patient', 'patient', 'open', 'patient'),
    edge('summary', 'summary', 'open', 'summary'),
    edge('charges', 'result', 'open', 'charges'),
    edge('entry', 'report', 'open', 'report'),
    edge('open', 'then', 'cycle', 'exec'),
    edge('open', 'claimId', 'cycleInputs', 'claimId'),
    edge('cycleInputs', 'result', 'cycle', 'inputs'),
    edge('cycle', 'then', 'attach', 'exec'),
    edge('open', 'claimId', 'attach', 'claimId'),
    edge('cycle', 'runId', 'attach', 'cycleRunId'),
    edge('attach', 'then', 'approved', 'exec'),
    edge('open', 'claimId', 'approved', 'claimId'),
    edge('confirmed', 'result', 'charges', 'service'),
    edge('price', 'lines', 'charges', 'lines'),
    edge('price', 'totalCents', 'charges', 'totalCents'),
    edge('charges', 'result', 'approved', 'charges'),
    edge('summary', 'summary', 'approved', 'summary'),
    edge('patient', 'patient', 'approved', 'patient'),
    edge('review', 'hold', 'hold', 'exec'),
    edge('review', 'note', 'reason', 'note'),
    edge('reason', 'text', 'hold', 'message')
  ]
};

const recordEvent = (id: string, kind: string, label: string) =>
  node(id, 'billing.record-claim-event', { label, inputs: { kind: { value: kind } } });

const closeClaim = (id: string, status: string, label: string) =>
  node(id, 'billing.close-claim', { label, inputs: { status: { value: status } } });

const waitForClaim = (id: string, label: string) =>
  node(id, 'std.flow.wait-signal', { label, inputs: { name: { value: 'claim' } } });

const cycleClaimGraph: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'claimId', type: 'string' }],
    outputs: []
  },
  variables: [{ name: 'active', type: 'boolean', default: true }],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('active', 'std.var.get', { config: { name: 'active' } }),
    node('loop', 'std.flow.while', { label: 'Until the claim closes' }),
    node('step', 'billing.claim-step', { label: 'Next step' }),
    waitForClaim('submit', 'Await 837P batch'),
    waitForClaim('awaitPayer', 'Await payer response'),
    node('followUpContext', 'std.expr', {
      label: 'Follow-up context',
      config: {
        expression:
          '{ claimId: claimId, coverageId: coverageId, payer: payer, balanceCents: balanceCents }'
      }
    }),
    node('followUp', 'std.human.task', {
      label: 'Follow up with payer',
      config: {
        title: 'Follow up on claim',
        queue: 'billing-followup',
        instructions:
          'The payer has not responded in 30 days. Resubmit in the next 837P batch, keep waiting another 30 days, or move on to the next payer.',
        outcomes: ['resubmit', 'keepWaiting', 'nextPayer']
      }
    }),
    recordEvent('resubmit', 'resubmit_queued', 'Queue for the next batch'),
    recordEvent('keepWaiting', 'follow_up', 'Keep waiting on payer'),
    recordEvent('skip', 'payer_skipped', 'Move to next payer'),
    node('statement', 'billing.issue-statement', { label: 'Send patient statement' }),
    waitForClaim('awaitPatient', 'Await patient payment'),
    node('collectionsContext', 'std.expr', {
      label: 'Collections context',
      config: { expression: '{ claimId: claimId, balanceCents: balanceCents }' }
    }),
    node('collections', 'std.human.task', {
      label: 'Collections review',
      config: {
        title: 'Review unpaid balance',
        queue: 'billing-collections',
        instructions:
          'Every payer and three patient statements are done and a balance remains. Write it off or send it to collections. If it has been paid in the meantime, either choice closes it as paid.',
        outcomes: ['writeOff', 'sendToCollections']
      }
    }),
    closeClaim('closeWrittenOff', 'written_off', 'Close as written off'),
    closeClaim('closeCollections', 'collections', 'Close as sent to collections'),
    closeClaim('closePaid', 'paid', 'Close as paid'),
    node('stop', 'std.var.set', {
      label: 'Stop cycling',
      config: { name: 'active' },
      inputs: { value: { value: false } }
    }),
    node('done', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'exec', 'loop', 'exec'),
    edge('active', 'value', 'loop', 'condition'),
    edge('loop', 'body', 'step', 'exec'),
    edge('loop', 'completed', 'done', 'exec'),
    edge('entry', 'claimId', 'step', 'claimId'),
    edge('step', 'submit', 'submit', 'exec'),
    edge('entry', 'claimId', 'submit', 'key'),
    edge('step', 'waitMs', 'submit', 'timeoutMs'),
    edge('step', 'await', 'awaitPayer', 'exec'),
    edge('entry', 'claimId', 'awaitPayer', 'key'),
    edge('step', 'waitMs', 'awaitPayer', 'timeoutMs'),
    edge('step', 'followUp', 'followUp', 'exec'),
    edge('entry', 'claimId', 'followUpContext', 'claimId'),
    edge('step', 'coverageId', 'followUpContext', 'coverageId'),
    edge('step', 'payer', 'followUpContext', 'payer'),
    edge('step', 'balanceCents', 'followUpContext', 'balanceCents'),
    edge('followUpContext', 'result', 'followUp', 'context'),
    edge('followUp', 'resubmit', 'resubmit', 'exec'),
    edge('entry', 'claimId', 'resubmit', 'claimId'),
    edge('step', 'coverageId', 'resubmit', 'coverageId'),
    edge('followUp', 'keepWaiting', 'keepWaiting', 'exec'),
    edge('entry', 'claimId', 'keepWaiting', 'claimId'),
    edge('step', 'coverageId', 'keepWaiting', 'coverageId'),
    edge('followUp', 'nextPayer', 'skip', 'exec'),
    edge('entry', 'claimId', 'skip', 'claimId'),
    edge('step', 'coverageId', 'skip', 'coverageId'),
    edge('step', 'statement', 'statement', 'exec'),
    edge('entry', 'claimId', 'statement', 'claimId'),
    edge('step', 'statementNumber', 'statement', 'statementNumber'),
    edge('step', 'awaitPatient', 'awaitPatient', 'exec'),
    edge('entry', 'claimId', 'awaitPatient', 'key'),
    edge('step', 'waitMs', 'awaitPatient', 'timeoutMs'),
    edge('step', 'collections', 'collections', 'exec'),
    edge('entry', 'claimId', 'collectionsContext', 'claimId'),
    edge('step', 'balanceCents', 'collectionsContext', 'balanceCents'),
    edge('collectionsContext', 'result', 'collections', 'context'),
    edge('collections', 'writeOff', 'closeWrittenOff', 'exec'),
    edge('collections', 'sendToCollections', 'closeCollections', 'exec'),
    edge('step', 'closed', 'closePaid', 'exec'),
    edge('entry', 'claimId', 'closeWrittenOff', 'claimId'),
    edge('entry', 'claimId', 'closeCollections', 'claimId'),
    edge('entry', 'claimId', 'closePaid', 'claimId'),
    edge('closeWrittenOff', 'then', 'stop', 'exec'),
    edge('closeCollections', 'then', 'stop', 'exec'),
    edge('closePaid', 'then', 'stop', 'exec')
  ]
};

const ingestNemsisGraph: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'file', type: BLOB }],
    outputs: [
      { name: 'count', type: 'integer' },
      { name: 'summaries', type: { list: { object: {} } } }
    ]
  },
  variables: [],
  nodes: [
    node('entry', ENTRY_TYPE),
    node('split', 'nemsis.split'),
    node('claims', 'std.list.map', { config: { expression: '{ report: item }' } }),
    node('each', 'std.flow.map-workflow', {
      label: 'Process each PCR',
      config: { workflow: 'billing.process-pcr', version: 1 }
    }),
    node('summaries', 'std.list.map', { config: { expression: 'item.summary' } }),
    node('return', RETURN_TYPE)
  ],
  edges: [
    edge('entry', 'exec', 'split', 'exec'),
    edge('entry', 'file', 'split', 'file'),
    edge('split', 'then', 'each', 'exec'),
    edge('split', 'reports', 'claims', 'list'),
    edge('claims', 'list', 'each', 'items'),
    edge('each', 'then', 'return', 'exec'),
    edge('each', 'results', 'summaries', 'list'),
    edge('split', 'count', 'return', 'count'),
    edge('summaries', 'list', 'return', 'summaries')
  ]
};

export const billingGraphs: SeedGraph[] = [
  {
    key: 'billing.pcr-summary',
    name: 'PCR Summary',
    kind: 'node',
    description: 'Pulls the billing fields out of a NEMSIS patient care report.',
    version: 1,
    definition: pcrSummaryGraph
  },
  {
    key: 'billing.resolve-patient',
    name: 'Resolve Patient',
    kind: 'node',
    description:
      'Matches report demographics to a patient, creates one when nothing is close, and asks a biller about near matches.',
    version: 1,
    definition: resolvePatientGraph
  },
  {
    key: 'billing.level-of-service',
    name: 'Level of Service',
    kind: 'node',
    description:
      'Suggests BLS, ALS1, ALS2 or SCT from the level of care provided (eDisposition.32) and IV/IO medications, emergency status from the response mode, and loaded miles from the scene and destination odometers.',
    version: 1,
    definition: levelOfServiceGraph
  },
  {
    key: 'billing.claim-lines',
    name: 'Claim Lines',
    kind: 'node',
    description:
      'Maps a confirmed level of service to its HCPCS base code (A0426–A0434) plus A0425 mileage in tenths of a mile.',
    version: 1,
    definition: claimLinesGraph
  },
  {
    key: 'billing.cycle-claim',
    name: 'Cycle Claim',
    kind: 'workflow',
    description:
      'Bills each payer in claim order with 30-day follow-ups, then sends three patient statements 30 days apart before collections review.',
    version: 1,
    definition: cycleClaimGraph
  },
  {
    key: 'billing.process-pcr',
    name: 'Process PCR',
    kind: 'workflow',
    description:
      'Summarizes one patient care report, resolves its patient, confirms the level of service with a biller, prices and opens the claim, and starts its payer cycle.',
    version: 1,
    definition: processPcrGraph
  },
  {
    key: 'billing.ingest-nemsis',
    name: 'Ingest NEMSIS File',
    kind: 'workflow',
    description: 'Splits a NEMSIS export and processes every report as its own claim run.',
    version: 1,
    definition: ingestNemsisGraph
  }
];
