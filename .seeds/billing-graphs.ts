import {
  billingTypes,
  CLAIM_FIX_FIELDS,
  CLAIM_SIGNAL,
  HCPCS_LABELS,
  LEVEL_FIELD,
  LOADED_MILES_FIELD,
  NO_TRANSPORT_CODE,
  TRIP_TYPE_FIELD,
  UNREAD_FINDINGS
} from '@ugula/billing';
import type { GraphDef, Json, PinSpec, ValueType } from '@ugula/graph';
import { PCR_TYPE } from '@ugula/nemsis';
import { graph } from './builder.ts';
import type { SeedGraph } from './graphs.ts';

const {
  blob: BLOB,
  demographics: DEMOGRAPHICS,
  patient: PATIENT,
  location: LOCATION,
  coverages: COVERAGES,
  service: SERVICE,
  findings: FINDINGS,
  lines: LINES,
  documentation: DOCUMENTATION,
  claim: CLAIM,
  submission: SUBMISSION,
  x837: X837
} = billingTypes;

const ADDRESS_PINS = ['addressLine', 'city', 'state', 'postalCode'];

const CHARGE_LINES: ValueType = { list: { object: { code: 'string', units: 'number' } } };

const p = (name: string, type: ValueType, optional = false): PinSpec => ({
  name,
  type,
  ...(optional ? { optional: true } : {})
});

const pure = (inputs: PinSpec[], outputs: PinSpec[]) =>
  graph({ execIn: [], execOut: [], inputs, outputs });

const action = (inputs: PinSpec[], outputs: PinSpec[], execOut = ['then']) =>
  graph({ execIn: ['exec'], execOut, inputs, outputs });

type Builder = ReturnType<typeof graph>;

type Rule = { label: string; when?: Record<string, Json>; set?: Record<string, Json> };

const field = (name: string, type: ValueType, label: string) => ({ name, type, label });

const table = (
  inputs: ReturnType<typeof field>[],
  outputs: ReturnType<typeof field>[],
  rules: Rule[],
  otherwise: Record<string, Json> = {}
) => ({
  inputs,
  outputs,
  rules: rules.map((r) => ({ label: r.label, when: r.when ?? {}, set: r.set ?? {} })),
  otherwise
});

const is = (value: Json) => ({ op: 'is', value });
const oneOf = (...value: string[]) => ({ op: 'oneOf', value });
const notOneOf = (...value: string[]) => ({ op: 'notOneOf', value });
const atLeast = (value: number) => ({ op: 'gte', value });
const startsWith = (...value: string[]) => ({ op: 'startsWith', value });

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

const classifyTrip = (): GraphDef => {
  const g = pure([p('pcr', PCR_TYPE)], [p('tripType', 'string'), p('reason', 'string', true)]);
  g.add('pcr', 'nemsis.pcr.break');
  g.add('disposition', 'nemsis.disposition.break');
  g.add('response', 'nemsis.response.break');
  g.add('trip', 'std.table.decide', {
    label: 'Trip Type',
    config: table(
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
  });
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.disposition', 'disposition.disposition');
  g.wire('pcr.response', 'response.response');
  for (const pin of [
    'incidentDisposition',
    'unitDisposition',
    'patientEvaluation',
    'transportDisposition'
  ]) {
    g.wire(`disposition.${pin}`, `trip.${pin}`);
  }
  g.wire('response.serviceType', 'trip.serviceType');
  g.wire('trip.tripType', 'return.tripType');
  g.wire('trip.rule', 'return.reason');
  return g.def;
};

const loadedMiles = (): GraphDef => {
  const g = pure(
    [p('sceneOdometer', 'number', true), p('destinationOdometer', 'number', true)],
    [p('loadedMiles', 'number', true)]
  );
  g.add('scene', 'std.logic.coalesce', { label: 'Scene Odometer or 0', values: { fallback: 0 } });
  g.add('destination', 'std.logic.coalesce', {
    label: 'Destination Odometer or 0',
    values: { fallback: 0 }
  });
  g.add('distance', 'std.math.subtract', { label: 'Destination minus Scene' });
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

const levelOfService = (): GraphDef => {
  const g = pure([p('pcr', PCR_TYPE), p('findings', FINDINGS, true)], [p('service', SERVICE)]);
  g.add('pcr', 'nemsis.pcr.break');
  g.add('disposition', 'nemsis.disposition.break');
  g.add('payment', 'nemsis.payment.break');
  g.add('response', 'nemsis.response.break');
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
    config: table(
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
  });
  g.add('emergency', 'std.table.decide', {
    label: 'Emergency Response',
    config: table(
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
          label: 'Crew reported an emergency level',
          when: { cmsServiceLevel: oneOf('2650003', '2650009') },
          set: { emergency: true }
        }
      ],
      { emergency: false }
    )
  });
  g.add('miles', 'billing.loaded-miles', { label: 'Loaded Miles' });
  g.add('service', 'billing.service.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('entry.findings', 'findings.findings');
  g.wire('pcr.disposition', 'disposition.disposition');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('pcr.response', 'response.response');
  g.wire('pcr.medications', 'ivMedications.list');
  g.wire('findings.procedures', 'procedures.value');
  g.wire('procedures.result', 'procedureCount.list');
  g.wire('disposition.levelOfCare', 'level.levelOfCare');
  g.wire('payment.cmsServiceLevel', 'level.cmsServiceLevel', 'emergency.cmsServiceLevel');
  g.wire('response.serviceType', 'level.serviceType');
  g.wire('ivMedications.list', 'ivDrugs.list');
  g.wire('ivDrugs.count', 'level.codedIvMedications');
  g.wire('findings.ivDoses', 'level.narrativeIvDoses');
  g.wire('procedureCount.length', 'level.narrativeProcedures');
  g.wire('pcr.procedures', 'codedProcedures.list');
  g.wire('codedProcedures.count', 'level.codedProcedures');
  g.wire('payment.alsAssessment', 'level.alsAssessment');
  g.wire('response.responseMode', 'emergency.responseMode');
  g.wire('response.sceneOdometer', 'miles.sceneOdometer');
  g.wire('response.destinationOdometer', 'miles.destinationOdometer');
  g.wire('level.level', 'service.level');
  g.wire('level.rules', 'service.basis');
  g.wire('emergency.emergency', 'service.emergency');
  g.wire('miles.loadedMiles', 'service.loadedMiles');
  g.wire('service.service', 'return.service');
  return g.def;
};

const tripService = (fixed: Record<string, Json>): GraphDef => {
  const g = pure([p('pcr', PCR_TYPE), p('findings', FINDINGS, true)], [p('service', SERVICE)]);
  g.add('suggested', 'billing.level-of-service', { label: 'Level of Service' });
  g.ret('return');
  g.wire('entry.pcr', 'suggested.pcr');
  g.wire('entry.findings', 'suggested.findings');
  if (!Object.keys(fixed).length) {
    g.wire('suggested.service', 'return.service');
    return g.def;
  }
  g.add('parts', 'billing.service.break');
  g.add('service', 'billing.service.make', { values: fixed });
  g.wire('suggested.service', 'parts.service');
  for (const pin of ['level', 'emergency', 'loadedMiles', 'basis'].filter((x) => !(x in fixed))) {
    g.wire(`parts.${pin}`, `service.${pin}`);
  }
  g.wire('service.service', 'return.service');
  return g.def;
};

const suggestService = (): GraphDef => {
  const g = action(
    [p('tripType', 'string'), p('pcr', PCR_TYPE), p('findings', FINDINGS, true)],
    [p('service', SERVICE)]
  );
  const trips = [
    ['scheduled', 'billing.trip-scheduled'],
    ['treatNoTransport', 'billing.trip-treat-no-transport'],
    ['refusal', 'billing.trip-refusal'],
    ['default', 'billing.trip-emergency']
  ] as const;
  g.add('switch', 'std.flow.switch', {
    label: 'By Trip Type',
    config: { cases: trips.filter(([c]) => c !== 'default').map(([c]) => c) }
  });
  g.wire('entry.exec', 'switch.exec');
  g.wire('entry.tripType', 'switch.value');
  for (const [pin, type] of trips) {
    const id = pin === 'default' ? 'emergency' : pin;
    g.add(id, type);
    g.ret(`${id}Done`);
    g.wire(`switch.${pin}`, `${id}Done.exec`);
    g.wire('entry.pcr', `${id}.pcr`);
    g.wire('entry.findings', `${id}.findings`);
    g.wire(`${id}.service`, `${id}Done.service`);
  }
  return g.def;
};

const mapCharges = (): GraphDef => {
  const g = pure([p('tripType', 'string'), p('service', SERVICE)], [p('lines', CHARGE_LINES)]);
  g.add('service', 'billing.service.break');
  g.add('base', 'std.table.decide', {
    label: 'Base Rate',
    config: table(
      [
        field('tripType', 'string', 'Trip type'),
        field('level', 'string', 'Level of service'),
        field('emergency', 'boolean', 'Emergency')
      ],
      [field('code', 'string', 'HCPCS code')],
      [
        {
          label: 'Treated without transport',
          when: { tripType: oneOf('treatNoTransport', 'refusal') },
          set: { code: NO_TRANSPORT_CODE }
        },
        { label: 'Specialty care transport', when: { level: is('SCT') }, set: { code: 'A0434' } },
        { label: 'ALS2', when: { level: is('ALS2') }, set: { code: 'A0433' } },
        {
          label: 'ALS1 emergency',
          when: { level: is('ALS1'), emergency: is(true) },
          set: { code: 'A0427' }
        },
        { label: 'ALS1 non-emergency', when: { level: is('ALS1') }, set: { code: 'A0426' } },
        { label: 'BLS emergency', when: { emergency: is(true) }, set: { code: 'A0429' } }
      ],
      { code: 'A0428' }
    )
  });
  g.add('baseLine', 'billing.line.make', { label: 'Base Rate Line', values: { units: 1 } });
  g.add('mileage', 'std.table.decide', {
    label: 'Mileage',
    config: table(
      [field('tripType', 'string', 'Trip type'), field('loadedMiles', 'number', 'Loaded miles')],
      [field('code', 'string', 'HCPCS code')],
      [
        {
          label: 'Loaded miles transported',
          when: {
            tripType: { op: 'notOneOf', value: ['treatNoTransport', 'refusal'] },
            loadedMiles: { op: 'gt', value: 0 }
          },
          set: { code: 'A0425' }
        }
      ]
    )
  });
  g.add('miles', 'std.logic.coalesce', { label: 'Loaded Miles or 0', values: { fallback: 0 } });
  g.add('mileageLine', 'billing.line.make', { label: 'Mileage Line' });
  g.add('keepMileage', 'std.logic.select', { label: 'Only When Miles Are Billed' });
  g.add('lines', 'std.list.make', { config: { count: 2 } });
  g.ret('return');
  g.wire('entry.service', 'service.service');
  g.wire('entry.tripType', 'base.tripType', 'mileage.tripType');
  g.wire('service.level', 'base.level');
  g.wire('service.emergency', 'base.emergency');
  g.wire('service.loadedMiles', 'mileage.loadedMiles', 'miles.value');
  g.wire('base.code', 'baseLine.code');
  g.wire('mileage.code', 'mileageLine.code');
  g.wire('miles.result', 'mileageLine.units');
  g.wire('mileage.matched', 'keepMileage.condition');
  g.wire('mileageLine.line', 'keepMileage.whenTrue');
  g.wire('baseLine.line', 'lines.item1');
  g.wire('keepMileage.result', 'lines.item2');
  g.wire('lines.list', 'return.lines');
  return g.def;
};

const demographicsFromPcr = (): GraphDef => {
  const g = pure([p('pcr', PCR_TYPE)], [p('demographics', DEMOGRAPHICS)]);
  g.add('pcr', 'nemsis.pcr.break');
  g.add('patient', 'nemsis.patient.break');
  g.add('sex', 'std.logic.coalesce', { label: 'Sex, else Gender' });
  g.add('demographics', 'billing.demographics.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.patient', 'patient.patient');
  g.wire('patient.sex', 'sex.value');
  g.wire('patient.gender', 'sex.fallback');
  g.wire('sex.result', 'demographics.gender');
  for (const pin of ['firstName', 'lastName', 'birthDate', ...ADDRESS_PINS]) {
    g.wire(`patient.${pin}`, `demographics.${pin}`);
  }
  g.wire('demographics.demographics', 'return.demographics');
  return g.def;
};

const coveragesFromPcr = (): GraphDef => {
  const g = pure([p('pcr', PCR_TYPE)], [p('coverages', COVERAGES)]);
  g.add('pcr', 'nemsis.pcr.break');
  g.add('payment', 'nemsis.payment.break');
  g.add('insurances', 'std.list.reshape', {
    label: 'Insurances as Coverages',
    config: {
      fields: [
        { name: 'payer', type: 'string', from: 'companyName' },
        { name: 'payerCode', type: 'string', from: 'companyId' },
        { name: 'priority', type: 'string', from: 'priority' },
        { name: 'memberId', type: 'string', from: 'policyId' },
        { name: 'groupId', type: 'string', from: 'groupId' },
        { name: 'relationship', type: 'string', from: 'relationship' },
        { name: 'insuredFirstName', type: 'string', from: 'insuredFirstName' },
        { name: 'insuredLastName', type: 'string', from: 'insuredLastName' }
      ]
    }
  });
  g.add('method', 'std.table.lookup', {
    label: 'Payer Named by the Payment Method',
    config: {
      type: 'string',
      rows: [
        { key: '2601005', value: 'Medicare' },
        { key: '2601003', value: 'Medicaid' }
      ]
    }
  });
  g.add('fallback', 'billing.coverage.make', {
    label: 'Coverage From the Payment Method',
    values: { priority: '2611003' }
  });
  g.add('fallbackList', 'std.list.make', { config: { count: 1 } });
  g.add('count', 'std.list.length', { label: 'How Many Insurances' });
  g.add('none', 'std.logic.equal', { label: 'No Insurances', values: { b: 0 } });
  g.add('useMethod', 'std.logic.and', { label: 'No Insurances, but a Known Method' });
  g.add('coverages', 'std.logic.select', { label: 'Coverages' });
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.insurances', 'insurances.list', 'count.list');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('payment.method', 'method.key');
  g.wire('method.value', 'fallback.payer');
  g.wire('fallback.coverage', 'fallbackList.item1');
  g.wire('count.length', 'none.a');
  g.wire('none.result', 'useMethod.a');
  g.wire('method.found', 'useMethod.b');
  g.wire('useMethod.result', 'coverages.condition');
  g.wire('fallbackList.list', 'coverages.whenTrue');
  g.wire('insurances.list', 'coverages.whenFalse');
  g.wire('coverages.result', 'return.coverages');
  return g.def;
};

const tripDetails = (): GraphDef => {
  const g = pure(
    [p('pcr', PCR_TYPE)],
    [
      p('serviceDate', 'string', true),
      p('pickup', LOCATION),
      p('destination', LOCATION),
      p('diagnoses', { list: 'string' }),
      p('originDestination', 'string', true)
    ]
  );
  g.add('pcr', 'nemsis.pcr.break');
  g.add('times', 'nemsis.times.break');
  g.add('scene', 'nemsis.scene.break');
  g.add('disposition', 'nemsis.disposition.break');
  g.add('situation', 'nemsis.situation.break');
  g.add('response', 'nemsis.response.break');
  g.add('called', 'std.logic.coalesce', { label: 'Call Time, else Dispatch Time' });
  g.add('when', 'std.logic.coalesce', { label: 'Or Nothing', values: { fallback: '' } });
  g.add('serviceDate', 'std.text.substring', { label: 'Date Part', values: { end: 10 } });
  g.add('pickup', 'billing.location.make', { label: 'Pickup' });
  g.add('destination', 'billing.location.make', { label: 'Destination' });
  g.add('primary', 'std.list.make', { label: 'Primary Impression', config: { count: 1 } });
  g.add('diagnoses', 'std.list.concat', { label: 'With Secondary Impressions' });
  g.add('origin', 'std.table.decide', {
    label: 'Origin Modifier',
    config: table(
      [
        field('locationType', 'string', 'Incident location type · eScene.09'),
        field('serviceType', 'string', 'Type of service requested · eResponse.05')
      ],
      [field('code', 'string', 'Origin code')],
      [
        { label: 'Home', when: { locationType: startsWith('Y92.0') }, set: { code: 'R' } },
        {
          label: 'Nursing home or other residential institution',
          when: { locationType: startsWith('Y92.1') },
          set: { code: 'E' }
        },
        { label: 'Hospital', when: { locationType: startsWith('Y92.23') }, set: { code: 'H' } },
        {
          label: "Physician's office or clinic",
          when: { locationType: startsWith('Y92.53') },
          set: { code: 'P' }
        },
        {
          label: 'Leaving a hospital (interfacility)',
          when: { serviceType: oneOf('2205005', '2205015') },
          set: { code: 'H' }
        },
        {
          label: 'Leaving a care facility',
          when: { serviceType: oneOf('2205017', '2205019') },
          set: { code: 'E' }
        },
        {
          label: 'Emergency response to a scene',
          when: { serviceType: oneOf('2205001', '2205003', '2205009') },
          set: { code: 'S' }
        }
      ]
    )
  });
  g.add('destinationCode', 'std.table.lookup', {
    label: 'Destination Modifier',
    config: {
      type: 'string',
      rows: [
        { key: '4221001', value: 'R' },
        { key: '4221003', value: 'H' },
        { key: '4221005', value: 'H' },
        { key: '4221007', value: 'P' },
        { key: '4221011', value: 'E' },
        { key: '4221015', value: 'I' },
        { key: '4221021', value: 'P' },
        { key: '4221023', value: 'H' },
        { key: '4221025', value: 'J' },
        { key: '4221027', value: 'D' },
        { key: '4221029', value: 'E' },
        { key: '4221033', value: 'E' },
        { key: '4221041', value: 'N' }
      ]
    }
  });
  g.add('codes', 'std.list.make', { config: { count: 2 } });
  g.add('originDestination', 'std.text.join', { label: 'Origin Then Destination' });
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.times', 'times.times');
  g.wire('pcr.scene', 'scene.scene');
  g.wire('pcr.disposition', 'disposition.disposition');
  g.wire('pcr.situation', 'situation.situation');
  g.wire('pcr.response', 'response.response');
  g.wire('times.psapCall', 'called.value');
  g.wire('times.unitNotified', 'called.fallback');
  g.wire('called.result', 'when.value');
  g.wire('when.result', 'serviceDate.text');
  for (const pin of ADDRESS_PINS) {
    g.wire(`scene.${pin}`, `pickup.${pin}`);
    g.wire(`disposition.${pin}`, `destination.${pin}`);
  }
  g.wire('disposition.destinationName', 'destination.name');
  g.wire('situation.primaryImpression', 'primary.item1');
  g.wire('primary.list', 'diagnoses.list');
  g.wire('situation.secondaryImpressions', 'diagnoses.other');
  g.wire('scene.locationType', 'origin.locationType');
  g.wire('response.serviceType', 'origin.serviceType');
  g.wire('disposition.destinationType', 'destinationCode.key');
  g.wire('origin.code', 'codes.item1');
  g.wire('destinationCode.value', 'codes.item2');
  g.wire('codes.list', 'originDestination.items');
  g.wire('serviceDate.result', 'return.serviceDate');
  g.wire('pickup.location', 'return.pickup');
  g.wire('destination.location', 'return.destination');
  g.wire('diagnoses.list', 'return.diagnoses');
  g.wire('originDestination.text', 'return.originDestination');
  return g.def;
};

const DESTINATION_REASONS = [
  { key: '4220001', value: 'A' },
  { key: '4220003', value: 'A' },
  { key: '4220011', value: 'A' },
  { key: '4220019', value: 'A' },
  { key: '4220017', value: 'B' },
  { key: '4220005', value: 'C' },
  { key: '4220021', value: 'D' }
];

const documentationFromPcr = (): GraphDef => {
  const g = pure([p('pcr', PCR_TYPE)], [p('documentation', DOCUMENTATION)]);
  g.add('pcr', 'nemsis.pcr.break');
  g.add('payment', 'nemsis.payment.break');
  g.add('times', 'nemsis.times.break');
  g.add('exam', 'nemsis.exam.break');
  g.add('disposition', 'nemsis.disposition.break');
  g.add('signature', 'billing.read-signature', { label: 'Billing Signature' });
  g.add('pcs', 'std.table.lookup', {
    label: 'Physician Certification on File',
    config: {
      type: 'boolean',
      rows: [
        { key: '9922005', value: true },
        { key: '9922001', value: false }
      ]
    }
  });
  g.add('pcsDate', 'std.logic.coalesce', { label: 'Or Nothing', values: { fallback: '' } });
  g.add('pcsSignedOn', 'std.text.substring', { label: 'Date Part', values: { end: 10 } });
  g.add('firstReason', 'std.list.first', { label: 'Main Reason for the Destination' });
  g.add('reasonByDestination', 'std.table.lookup', {
    label: 'Transport Reason From the Destination Reason',
    config: { type: 'string', rows: DESTINATION_REASONS }
  });
  g.add('transportReason', 'std.logic.coalesce', { label: 'Reported, Else From the Destination' });
  g.add('documentation', 'billing.documentation.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('pcr.times', 'times.times');
  g.wire('pcr.exam', 'exam.exam');
  g.wire('pcr.disposition', 'disposition.disposition');
  g.wire('pcr.signatures', 'signature.signatures');
  g.wire('signature.signature', 'documentation.signature');
  g.wire('signature.signatureNote', 'documentation.signatureNote');
  g.wire('payment.certificationStatement', 'pcs.key');
  g.wire('pcs.value', 'documentation.pcsOnFile');
  g.wire('payment.certificationDate', 'pcsDate.value');
  g.wire('pcsDate.result', 'pcsSignedOn.text');
  g.wire('pcsSignedOn.result', 'documentation.pcsSignedOn');
  g.wire('disposition.destinationReasons', 'firstReason.list');
  g.wire('firstReason.item', 'reasonByDestination.key');
  g.wire('payment.transportReason', 'transportReason.value');
  g.wire('reasonByDestination.value', 'transportReason.fallback');
  g.wire('transportReason.result', 'documentation.transportReason');
  g.wire('payment.ambulanceConditions', 'documentation.conditionCodes');
  g.wire('payment.priorAuthorization', 'documentation.priorAuthorization');
  g.wire('exam.weightKg', 'documentation.weightKg');
  g.wire('times.arrivedOnScene', 'documentation.atScene');
  g.wire('times.leftScene', 'documentation.leftScene');
  g.wire('times.arrivedAtDestination', 'documentation.atDestination');
  g.wire('documentation.documentation', 'return.documentation');
  return g.def;
};

const mapClaim = (): GraphDef => {
  const g = pure(
    [
      p('pcr', PCR_TYPE),
      p('tripType', 'string'),
      p('patient', PATIENT),
      p('coverages', COVERAGES),
      p('service', SERVICE),
      p('lines', LINES),
      p('totalCents', 'integer'),
      p('report', BLOB, true)
    ],
    [p('claim', CLAIM)]
  );
  g.add('pcr', 'nemsis.pcr.break');
  g.add('trip', 'billing.trip-details', { label: 'Trip Details' });
  g.add('documentation', 'billing.documentation-from-pcr', { label: 'Documentation' });
  g.add('patient', 'billing.patient.break');
  g.add('service', 'billing.service.break');
  g.add('claim', 'billing.claim.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr', 'trip.pcr', 'documentation.pcr');
  g.wire('documentation.documentation', 'claim.documentation');
  g.wire('entry.patient', 'patient.patient');
  g.wire('entry.service', 'service.service');
  g.wire('pcr.pcrNumber', 'claim.pcrNumber');
  g.wire('patient.id', 'claim.patientId');
  for (const pin of ['serviceDate', 'pickup', 'destination', 'diagnoses', 'originDestination']) {
    g.wire(`trip.${pin}`, `claim.${pin}`);
  }
  for (const pin of ['level', 'emergency', 'loadedMiles']) g.wire(`service.${pin}`, `claim.${pin}`);
  for (const pin of ['tripType', 'coverages', 'lines', 'totalCents', 'report']) {
    g.wire(`entry.${pin}`, `claim.${pin}`);
  }
  g.wire('claim.claim', 'return.claim');
  return g.def;
};

const map837p = (): GraphDef => {
  const g = pure([p('claim', SUBMISSION)], [p('x837', X837)]);
  g.add('claim', 'billing.submission.break');
  g.add('payer', 'billing.submitted-payer.break');
  g.add('patient', 'billing.submitted-patient.break');
  g.add('details', 'billing.submitted-details.break');
  g.add('documentation', 'billing.documentation.break');
  g.add('documentedConditions', 'std.expr', {
    label: 'Documented Conditions, Else by Emergency',
    config: { expression: 'len(documented ?? []) > 0 ? documented : decided' }
  });
  g.add('weight', 'std.expr', {
    label: 'Weight in Pounds',
    config: { expression: 'weightKg == null ? null : round(weightKg * 2.20462)' }
  });
  g.add('subscriber', 'x837.subscriber.make');
  g.add('x12Patient', 'x837.patient.make');
  g.add('x12Payer', 'x837.payer.make');
  g.add('otherPayers', 'std.list.reshape', {
    label: 'Prior Payers as Other Payers',
    config: {
      fields: [
        { name: 'name', type: 'string', from: 'name' },
        { name: 'payerId', type: 'string', from: 'payerId' },
        { name: 'claimFiling', type: 'string', from: 'claimFiling' },
        { name: 'memberId', type: 'string', from: 'memberId' },
        { name: 'groupId', type: 'string', from: 'groupId' },
        { name: 'relationship', type: 'string', from: 'relationship' },
        { name: 'lastName', type: 'string', from: 'insuredLastName' },
        { name: 'firstName', type: 'string', from: 'insuredFirstName' },
        { name: 'paidCents', type: 'integer', from: 'paidCents' },
        { name: 'adjustedCents', type: 'integer', from: 'adjustedCents' },
        { name: 'paidOn', type: 'string', from: 'paidOn' },
        {
          name: 'adjustments',
          type: { list: { object: { group: 'string', reason: 'string', cents: 'integer' } } },
          from: 'adjustments'
        }
      ]
    }
  });
  g.add('original', 'std.logic.is-null', { label: 'No Claim to Replace' });

  g.add('frequency', 'std.logic.select', {
    label: 'Original or Replacement',
    values: { whenTrue: '1', whenFalse: '7' }
  });
  g.add('conditions', 'std.table.decide', {
    label: 'Ambulance Conditions',
    config: table(
      [field('emergency', 'boolean', 'Emergency')],
      [field('codes', { list: 'string' }, 'CRC condition codes')],
      [{ label: 'Emergency', when: { emergency: is(true) }, set: { codes: ['09', '06'] } }],
      { codes: ['09'] }
    )
  });
  g.add('codes', 'std.list.pluck', { label: 'Line Codes', values: { field: 'code' } });
  g.add('coverage', 'std.table.decide', {
    label: 'Coverage Modifier',
    config: table(
      [
        field('claimFiling', 'string', 'Claim filing indicator'),
        field('codes', { list: 'string' }, 'HCPCS codes')
      ],
      [field('modifier', 'string', 'Modifier')],
      [
        {
          label: 'Medicare does not cover treatment without transport',
          when: { claimFiling: oneOf('MA', 'MB'), codes: oneOf(NO_TRANSPORT_CODE) },
          set: { modifier: 'GY' }
        }
      ]
    )
  });
  g.add('modifiers', 'std.list.make', { label: 'Line Modifiers', config: { count: 2 } });
  g.add('shared', 'std.object.make', {
    label: 'Every Line',
    config: {
      fields: [
        { name: 'modifiers', type: { list: 'string' } },
        { name: 'serviceDate', type: 'string' }
      ]
    }
  });
  g.add('lines', 'std.list.reshape', {
    label: 'Service Lines',
    config: {
      fields: [
        { name: 'code', type: 'string', from: 'code' },
        { name: 'modifiers', type: { list: 'string' } },
        { name: 'chargeCents', type: 'integer', from: 'totalCents' },
        { name: 'units', type: 'number', from: 'units' },
        { name: 'serviceDate', type: 'string' }
      ]
    }
  });
  g.add('x837', 'x837.claim.make', { values: { placeOfService: '41' } });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.patient', 'patient.patient');
  g.wire('claim.details', 'details.details');
  g.wire('details.documentation', 'documentation.documentation');
  g.wire('documentation.conditionCodes', 'documentedConditions.documented');
  g.wire('documentation.weightKg', 'weight.weightKg');
  g.wire('documentation.transportReason', 'x837.transportReason');
  g.wire('documentation.priorAuthorization', 'x837.priorAuthorization');
  g.wire('weight.result', 'x837.weightPounds');
  for (const pin of ['firstName', 'lastName', 'birthDate', 'sex', ...ADDRESS_PINS]) {
    g.wire(`patient.${pin}`, `x12Patient.${pin}`);
  }
  for (const pin of ['relationship', 'memberId', 'groupId']) {
    g.wire(`payer.${pin}`, `subscriber.${pin}`);
  }
  g.wire('payer.insuredLastName', 'subscriber.lastName');
  g.wire('payer.insuredFirstName', 'subscriber.firstName');
  for (const pin of ['name', 'payerId', 'claimFiling']) g.wire(`payer.${pin}`, `x12Payer.${pin}`);
  g.wire('claim.priorPayers', 'otherPayers.list');
  g.wire('claim.payerClaimNumber', 'original.value', 'x837.payerClaimNumber');
  g.wire('original.result', 'frequency.condition');
  g.wire('frequency.result', 'x837.frequency');
  g.wire('claim.emergency', 'conditions.emergency');
  g.wire('details.originDestination', 'modifiers.item1');
  g.wire('claim.lines', 'codes.list');
  g.wire('payer.claimFiling', 'coverage.claimFiling');
  g.wire('codes.list', 'coverage.codes');
  g.wire('coverage.modifier', 'modifiers.item2');
  g.wire('modifiers.list', 'shared.modifiers');
  g.wire('details.serviceDate', 'shared.serviceDate');
  g.wire('claim.lines', 'lines.list');
  g.wire('shared.object', 'lines.shared');
  g.wire('claim.claimId', 'x837.claimId');
  g.wire('subscriber.subscriber', 'x837.subscriber');
  g.wire('x12Patient.patient', 'x837.patient');
  g.wire('x12Payer.payer', 'x837.payer');
  g.wire('otherPayers.list', 'x837.otherPayers');
  g.wire('claim.loadedMiles', 'x837.loadedMiles');
  g.wire('conditions.codes', 'documentedConditions.decided');
  g.wire('documentedConditions.result', 'x837.conditionCodes');
  g.wire('details.diagnoses', 'x837.diagnoses');
  g.wire('details.pickup', 'x837.pickup');
  g.wire('details.destination', 'x837.dropoff');
  g.wire('lines.list', 'x837.lines');
  g.wire('x837.x837', 'return.x837');
  return g.def;
};

const placeOf = (place: string) =>
  `join(filter([
    ${place}.addressLine,
    ${place}.city != null && !every(split(${place}.city, ''), d => contains('0123456789', d)) ? ${place}.city : null,
    ${place}.postalCode
  ], x => x != null && x != ''), ', ')`;

const nameOf = (person: string) =>
  `join(filter([${person}.firstName, ${person}.lastName], x => x != null), ' ')`;

const expr = (label: string, expression: string) => ({ label, config: { expression } });

const subject = (...parts: string[]) =>
  expr('Task Subject', `join(filter([${parts.join(', ')}], x => x != null && x != ''), ' · ')`);

const SEX = "{ F: 'Female', M: 'Male', U: 'Unknown' }";

const TRIP = `{
  pcrNumber: pcr.pcrNumber,
  tripType: tripType,
  classifiedBy: reason,
  calledAt: pcr.times.psapCall,
  response: {
    '2223001': 'Emergent',
    '2223003': 'Emergent, downgraded to non-emergent',
    '2223005': 'Non-emergent',
    '2223007': 'Non-emergent, upgraded to emergent'
  }[pcr.response.responseMode ?? ''] ?? pcr.response.responseMode,
  careProvided: {
    '4232001': 'BLS',
    '4232003': 'ALS',
    '4232005': 'ALS',
    '4232009': 'Critical care'
  }[pcr.disposition.levelOfCare ?? ''] ?? pcr.disposition.levelOfCare,
  primaryImpression: pcr.situation.primaryImpression,
  otherImpressions: pcr.situation.secondaryImpressions,
  pickup: ${placeOf('pcr.scene')},
  destination: join(filter([pcr.disposition.destinationName, ${placeOf('pcr.disposition')}], x => x != null && x != ''), ' · ')
}`;

const REVIEW_CONTEXT = `{
  patient: {
    name: ${nameOf('patient')},
    birthDate: patient.birthDate,
    sex: ${SEX}[patient.gender ?? ''] ?? null,
    address: ${placeOf('patient')}
  },
  trip: trip,
  coverage: map(coverages, c => {
    payer: c.payer,
    directory: c.directoryName ?? 'Not linked to the payer directory',
    memberId: c.memberId,
    groupId: c.groupId
  }),
  narrative: {
    medications: map(findings.medications, m =>
      m.medication + ' ' + m.route + (m.doses > 1 ? ' x' + text(m.doses) : '')),
    procedures: findings.procedures
  },
  condition: {
    complaint: pcr.situation.complaint,
    primarySymptom: pcr.situation.primarySymptom,
    vitals: map(pcr.vitals, v => join(filter([
      v.takenAt,
      v.systolic != null ? 'BP ' + text(v.systolic) + '/' + text(v.diastolic ?? '?') : null,
      v.heartRate != null ? 'HR ' + text(v.heartRate) : null,
      v.respiratoryRate != null ? 'RR ' + text(v.respiratoryRate) : null,
      v.pulseOximetry != null ? 'SpO2 ' + text(v.pulseOximetry) + '%' : null,
      v.bloodGlucose != null ? 'BGL ' + text(v.bloodGlucose) : null,
      v.glasgowComaScore != null ? 'GCS ' + text(v.glasgowComaScore) : null
    ], x => x != null && x != ''), ' · ')),
    proceduresCoded: map(pcr.procedures, x => x.procedure)
  },
  documentation: {
    signature: documentation.signature,
    signatureNote: documentation.signatureNote,
    physicianCertification: documentation.pcsOnFile,
    transportReason: documentation.transportReason,
    conditionCodes: documentation.conditionCodes
  },
  suggested: service,
  warnings: concat(
    reason == null ? ['No disposition or type of service is recorded, so the trip was classified as an emergency transport'] : [],
    documentation.signature == 'signed' ? [] : [documentation.signatureNote ?? 'No billing signature'],
    tripType == 'scheduled' && documentation.pcsOnFile != true ? ['This scheduled trip has no physician certification statement'] : [],
    len(pcr.vitals ?? []) == 0 ? ['No vital signs are recorded to support medical necessity'] : [],
    findings.notes,
    payerNotes
  )
}`;

const PATIENT_REVIEW_CONTEXT = `{
  reason: reason,
  report: {
    name: ${nameOf('demographics')},
    birthDate: demographics.birthDate,
    sex: ${SEX}[demographics.gender ?? ''] ?? null,
    address: ${placeOf('demographics')},
    pcrNumber: pcrNumber
  },
  candidates: map(candidates, c => {
    name: ${nameOf('c')},
    birthDate: c.birthDate,
    sex: ${SEX}[c.gender ?? ''] ?? null,
    address: ${placeOf('c')}
  })
}`;

const PATIENT_CHOICES = `{
  patientId: map(candidates, c => {
    value: c.id,
    label: c.lastName + ', ' + c.firstName + ' · born ' + c.birthDate +
      (c.postalCode ? ' · ' + c.postalCode : '')
  })
}`;

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
  g.add('choices', 'std.expr', expr('Candidate Choices', PATIENT_CHOICES));
  g.add('pick', 'std.expr', expr('Likeliest Candidate', '{ patientId: candidates[0].id }'));
  g.add('context', 'std.expr', expr('Review Context', PATIENT_REVIEW_CONTEXT));
  g.add('subject', 'std.expr', subject('pcrNumber', nameOf('demographics')));
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
          type: 'string',
          label: 'Candidate patient',
          required: ['useSelected']
        }
      ],
      outcomes: ['useSelected', 'createNew']
    }
  });
  g.add('createNew', 'billing.create-patient', { label: 'Create New Patient' });
  g.add('find', 'billing.find-patient');
  g.ret('reviewed');
  g.ret('linked');
  g.wire('entry.exec', 'confirm.exec');
  g.wire('entry.candidates', 'choices.candidates', 'pick.candidates', 'context.candidates');
  g.wire('entry.reason', 'context.reason');
  g.wire('entry.demographics', 'context.demographics', 'subject.demographics');
  g.wire('entry.demographics', 'createNew.demographics');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
  g.wire('choices.result', 'confirm.options');
  g.wire('pick.result', 'confirm.defaults');
  g.wire('context.result', 'confirm.context');
  g.wire('subject.result', 'confirm.subject');
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
  g.add('context', 'std.expr', expr('Report Context', PATIENT_REVIEW_CONTEXT));
  g.add('subject', 'std.expr', subject('pcrNumber', nameOf('demographics')));
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
      outcomes: ['savePatient']
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
  g.wire('entry.demographics', 'subject.demographics');
  g.wire('entry.pcrNumber', 'review.pcrNumber', 'reviewCompleted.pcrNumber');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
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
  g.wire('context.result', 'complete.context');
  g.wire('subject.result', 'complete.subject');
  g.wire('entered.value', 'prefill.value');
  g.wire('match.demographics', 'prefill.fallback', 'reported.demographics');
  g.wire('prefill.result', 'complete.defaults');
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
  g.add('each', 'std.flow.for-each', { label: 'Each Unlinked Payer' });
  g.add(
    'choices',
    'std.expr',
    expr('Directory Choices', 'len(item.candidates) > 0 ? { payerId: item.candidates } : null')
  );
  g.add('suggestion', 'std.expr', expr('Suggested Payer', '{ payerId: item.suggested }'));
  g.add(
    'context',
    'std.expr',
    expr(
      'Payer Context',
      '{ reportedPayer: item.payer, memberId: item.memberId, patient: patientName, pcrNumber: pcrNumber, notes: item.notes }'
    )
  );
  g.add('confirm', 'std.human.task', {
    label: 'Match Payer',
    config: {
      title: 'Match payer',
      queue: 'billing-payers',
      instructions:
        'The report names a payer that is not in the payer directory by that name. Choose the directory payer it means, and later reports with this name link automatically; similar payers come first with how close they are. Mark it unlisted when the payer is real but not in the directory yet, or remove it when it is not insurance (self pay, unknown).',
      fields: [{ name: 'payerId', type: 'string', label: 'Directory payer', required: ['link'] }],
      outcomes: ['link', 'unlisted', 'remove']
    }
  });
  g.add('reported', 'std.object.get', { label: 'Reported Name', values: { path: 'payer' } });
  g.add('key', 'std.object.get', { label: 'Coverage Key', values: { path: 'key' } });
  g.add('subject', 'std.expr', subject('pcrNumber', 'item.payer'));
  g.add('link', 'billing.link-payer', { label: 'Remember Payer Name' });
  g.add('remove', 'std.var.append', {
    label: 'Leave Out This Coverage',
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
  g.wire('match.unmatched', 'each.list');
  g.wire('each.body', 'confirm.exec');
  g.wire('each.item', 'choices.item', 'suggestion.item', 'context.item', 'subject.item');
  g.wire('each.item', 'reported.object', 'key.object');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
  g.wire('entry.patientName', 'context.patientName');
  g.wire('choices.result', 'confirm.options');
  g.wire('suggestion.result', 'confirm.defaults');
  g.wire('context.result', 'confirm.context');
  g.wire('subject.result', 'confirm.subject');
  g.wire('confirm.link', 'link.exec');
  g.wire('reported.value', 'link.name');
  g.wire('confirm.payerId', 'link.payerId');
  g.wire('link.invalid', 'confirm.exec');
  g.wire('confirm.remove', 'remove.exec');
  g.wire('key.value', 'remove.item');
  g.wire('removed.value', 'rematch.exclude');
  g.wire('each.completed', 'rematch.exec');
  g.wire('rematch.matched', 'reviewed.exec');
  g.wire('rematch.review', 'reviewed.exec');
  g.wire('rematch.coverages', 'reviewed.coverages');
  g.wire('match.notes', 'reviewed.notes');
  return g.def;
};

const SET_CHARGE_CONTEXT = `{
  codes: map(missing, c => c + ' · ' + (labels[c] ?? 'Ambulance service')),
  primaryPayer: payerId == null ? 'No directory payer, so the default fee schedule' : payerId,
  claim: context
}`;

const priceCharges = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['priced', 'voided'],
      inputs: [
        p('lines', CHARGE_LINES),
        p('payerId', 'string', true),
        p('subject', 'string', true),
        p('context', 'any', true)
      ],
      outputs: [p('lines', LINES, true), p('totalCents', 'integer', true)]
    },
    [{ name: 'fees', type: { object: {} }, default: {} }]
  );
  g.add('fees', 'std.var.get', { label: 'Prices Set Here', config: { name: 'fees' } });
  g.add('price', 'billing.price-claim');
  g.add('setContext', 'std.expr', {
    ...expr('Missing Fees', SET_CHARGE_CONTEXT),
    values: { labels: HCPCS_LABELS }
  });
  g.add('codeChoices', 'std.expr', expr('Codes Without a Fee', '{ code: missing }'));
  g.add('firstCode', 'std.expr', expr('First Code', '{ code: missing[0] }'));
  g.add('setCharge', 'std.human.task', {
    label: 'Set Charge',
    config: {
      title: 'Set charge',
      queue: 'billing-review',
      instructions:
        "No fee schedule has a price for a code on this claim. Enter the unit price to bill it at, and save it to the agency's default fee schedule so later claims are priced too, or void the claim.",
      fields: [
        { name: 'code', type: 'string', label: 'HCPCS code', required: ['price'] },
        {
          name: 'unitPrice',
          type: 'number',
          label: 'Unit price (dollars)',
          min: 0,
          required: ['price']
        },
        { name: 'saveToSchedule', type: 'boolean', label: 'Save to the default fee schedule' }
      ],
      outcomes: ['price', 'void']
    }
  });
  g.add('setFee', 'billing.set-fee');
  g.add('keep', 'std.var.set', { label: 'Keep the Price', config: { name: 'fees' } });
  g.ret('pricedDone', 'priced');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'price.exec');
  g.wire('entry.lines', 'price.lines');
  g.wire('entry.payerId', 'price.payerId', 'setContext.payerId');
  g.wire('fees.value', 'price.fees', 'setFee.fees');
  g.wire('price.priced', 'pricedDone.exec');
  g.wire('price.lines', 'pricedDone.lines');
  g.wire('price.totalCents', 'pricedDone.totalCents');
  g.wire('price.unpriced', 'setCharge.exec');
  g.wire('price.missing', 'setContext.missing', 'codeChoices.missing', 'firstCode.missing');
  g.wire('entry.context', 'setContext.context');
  g.wire('setContext.result', 'setCharge.context');
  g.wire('codeChoices.result', 'setCharge.options');
  g.wire('firstCode.result', 'setCharge.defaults');
  g.wire('entry.subject', 'setCharge.subject');
  g.wire('setCharge.price', 'setFee.exec');
  g.wire('setCharge.code', 'setFee.code');
  g.wire('setCharge.unitPrice', 'setFee.unitPrice');
  g.wire('setCharge.saveToSchedule', 'setFee.saveToSchedule');
  g.wire('setFee.then', 'keep.exec');
  g.wire('setFee.fees', 'keep.value');
  g.wire('keep.then', 'price.exec');
  g.wire('setCharge.void', 'voidedDone.exec');
  return g.def;
};

const repriceClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['repriced', 'voided'],
    inputs: [
      p('claimId', 'string'),
      p('tripType', 'string'),
      p('service', SERVICE),
      p('payerId', 'string', true),
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: []
  });
  g.add('charges', 'billing.map-charges', { label: 'Charges' });
  g.add('price', 'billing.price-charges', { label: 'Price Charges' });
  g.add('save', 'billing.patch-claim', { label: 'Save the Repriced Lines' });
  g.ret('repricedDone', 'repriced');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'price.exec');
  g.wire('entry.tripType', 'charges.tripType');
  g.wire('entry.service', 'charges.service');
  g.wire('charges.lines', 'price.lines');
  g.wire('entry.payerId', 'price.payerId');
  g.wire('entry.subject', 'price.subject');
  g.wire('entry.context', 'price.context');
  g.wire('price.priced', 'save.exec');
  g.wire('price.lines', 'save.lines');
  g.wire('entry.claimId', 'save.claimId');
  g.wire('save.patched', 'repricedDone.exec');
  g.wire('save.reprice', 'repricedDone.exec');
  g.wire('price.voided', 'voidedDone.exec');
  return g.def;
};

const fixClaim = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['fixed', 'voided', 'backToReview'],
      inputs: [
        p('claimId', 'string'),
        p('all', 'boolean', true),
        p('subject', 'string', true),
        p('context', 'any', true)
      ],
      outputs: []
    },
    [{ name: 'askAll', type: 'boolean', default: false }]
  );
  g.add('ask', 'std.var.set', { label: 'Ask Every Field First?', config: { name: 'askAll' } });
  g.add('askAll', 'std.var.get', { config: { name: 'askAll' } });
  g.add('validate', 'billing.validate-claim', { label: 'Check the Claim' });
  g.add('asked', 'std.flow.branch', { label: 'Asked to Fix Anyway?' });
  g.add('fixContext', 'std.expr', expr('Fix Context', '{ issues: issues, claim: context }'));
  g.add('fix', 'std.human.task', {
    label: 'Fix Claim Data',
    config: {
      title: 'Fix claim data',
      queue: 'billing-review',
      instructions:
        'The claim is missing something or has something wrong, listed with the field it is fixed in. Correct the fields below and save, and the claim is checked again; empty fields are left as they are. Charges are mapped and priced again when the trip type, service, miles or payers change. Void the claim if it should never be billed.',
      fields: CLAIM_FIX_FIELDS,
      outcomes: ['save', 'void', 'backToReview']
    }
  });
  g.add('stopAsking', 'std.var.set', {
    label: 'Ask Only About Issues Now',
    config: { name: 'askAll' },
    values: { value: false }
  });
  g.input('claimIdToPatch', 'claimId');
  g.input('subjectToReprice', 'subject');
  g.add('patch', 'billing.patch-claim', { label: 'Apply the Fixes' });
  g.add('reprice', 'billing.reprice-claim', { label: 'Reprice Changed Charges' });
  g.ret('fixedDone', 'fixed');
  g.ret('voidedDone', 'voided');
  g.ret('reviewDone', 'backToReview');
  g.wire('entry.exec', 'ask.exec');
  g.wire('entry.all', 'ask.value');
  g.wire('ask.then', 'validate.exec');
  g.wire('entry.claimId', 'validate.claimId');
  g.wire('claimIdToPatch.claimId', 'patch.claimId', 'reprice.claimId');
  g.wire('askAll.value', 'validate.all', 'asked.condition');
  g.wire('validate.invalid', 'fix.exec');
  g.wire('validate.valid', 'asked.exec');
  g.wire('asked.true', 'fix.exec');
  g.wire('asked.false', 'fixedDone.exec');
  g.wire('validate.issues', 'fixContext.issues');
  g.wire('entry.context', 'fixContext.context');
  g.wire('fixContext.result', 'fix.context');
  g.wire('validate.visible', 'fix.visible');
  g.wire('validate.defaults', 'fix.defaults');
  g.wire('validate.options', 'fix.options');
  g.wire('entry.subject', 'fix.subject');
  g.wire('subjectToReprice.subject', 'reprice.subject');
  g.wire('fix.save', 'stopAsking.exec');
  g.wire('stopAsking.then', 'patch.exec');
  for (const { name } of CLAIM_FIX_FIELDS) g.wire(`fix.${name}`, `patch.${name}`);
  g.wire('patch.patched', 'validate.exec');
  g.wire('patch.reprice', 'reprice.exec');
  g.wire('patch.tripType', 'reprice.tripType');
  g.wire('patch.service', 'reprice.service');
  g.wire('patch.payerId', 'reprice.payerId');
  g.wire('fixContext.result', 'reprice.context');
  g.wire('reprice.repriced', 'validate.exec');
  g.wire('reprice.voided', 'voidedDone.exec');
  g.wire('fix.void', 'voidedDone.exec');
  g.wire('fix.backToReview', 'reviewDone.exec');
  return g.def;
};

const REVIEW_FIELDS = [
  { ...TRIP_TYPE_FIELD, required: ['approve'] },
  { ...LEVEL_FIELD, required: ['approve'] },
  { name: 'emergency', type: 'boolean', label: 'Emergency response' },
  LOADED_MILES_FIELD,
  { name: 'note', type: 'string', label: 'Note' }
];

const REVISION_CONTEXT = `{
  claimId: claimId,
  status: status,
  canApply: some(['draft', 'needs_review', 'void'], s => s == status),
  patient: { name: ${nameOf('pcr.patient')}, birthDate: pcr.patient.birthDate },
  trip: trip,
  changes: previous == null ? null : filter([
    { field: 'Patient name', was: ${nameOf('previous.patient')}, now: ${nameOf('pcr.patient')} },
    { field: 'Birth date', was: previous.patient.birthDate, now: pcr.patient.birthDate },
    { field: 'Patient address', was: ${placeOf('previous.patient')}, now: ${placeOf('pcr.patient')} },
    { field: 'Call time', was: previous.times.psapCall, now: pcr.times.psapCall },
    { field: 'Pickup', was: ${placeOf('previous.scene')}, now: ${placeOf('pcr.scene')} },
    { field: 'Destination', was: ${placeOf('previous.disposition')}, now: ${placeOf('pcr.disposition')} },
    { field: 'Primary impression', was: previous.situation.primaryImpression, now: pcr.situation.primaryImpression },
    { field: 'Other impressions', was: join(previous.situation.secondaryImpressions ?? [], ', '), now: join(pcr.situation.secondaryImpressions ?? [], ', ') },
    { field: 'Level of care', was: previous.disposition.levelOfCare, now: pcr.disposition.levelOfCare },
    { field: 'Response mode', was: previous.response.responseMode, now: pcr.response.responseMode },
    { field: 'Scene odometer', was: previous.response.sceneOdometer, now: pcr.response.sceneOdometer },
    { field: 'Destination odometer', was: previous.response.destinationOdometer, now: pcr.response.destinationOdometer },
    { field: 'Payers', was: join(map(previous.insurances ?? [], i => i.companyName ?? ''), ', '), now: join(map(pcr.insurances ?? [], i => i.companyName ?? ''), ', ') },
    { field: 'Narrative', was: len(previous.narrative ?? ''), now: len(pcr.narrative ?? '') }
  ], d => d.was != d.now)
}`;

const pcrSubject = (): GraphDef => {
  const g = pure([p('pcr', PCR_TYPE)], [p('subject', 'string')]);
  g.add('subject', 'std.expr', subject('pcr.pcrNumber', nameOf('pcr.patient')));
  g.ret('return');
  g.wire('entry.pcr', 'subject.pcr');
  g.wire('subject.result', 'return.subject');
  return g.def;
};

const tripSummary = (): GraphDef => {
  const g = pure(
    [p('pcr', PCR_TYPE), p('tripType', 'string', true), p('reason', 'string', true)],
    [p('trip', { object: {} })]
  );
  g.add('trip', 'std.expr', expr('Trip Summary', TRIP));
  g.ret('return');
  g.wire('entry.pcr', 'trip.pcr');
  g.wire('entry.tripType', 'trip.tripType');
  g.wire('entry.reason', 'trip.reason');
  g.wire('trip.result', 'return.trip');
  return g.def;
};

const tripContext = (g: Builder, id: string) =>
  g.add(id, 'std.expr', expr('Trip Context', '{ trip: trip }'));

const decideClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['claim', 'skip'],
    inputs: [p('pcr', PCR_TYPE)],
    outputs: [p('tripType', 'string'), p('reason', 'string', true)]
  });
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('needed', 'std.flow.switch', {
    label: 'Claim Needed?',
    config: { cases: ['noClaim'] }
  });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  tripContext(g, 'context');
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('noClaim', 'std.human.task', {
    label: 'Confirm No Claim',
    config: {
      title: 'Confirm no claim',
      queue: 'billing-review',
      instructions:
        'This report looks like a cancelled call or a trip without patient contact, so no claim would be made. Skip it, or choose the trip type that was billed and make a claim if care was given.',
      fields: [{ ...TRIP_TYPE_FIELD, required: ['claim'] }],
      outcomes: ['skip', 'claim']
    }
  });
  g.ret('classified', 'claim');
  g.ret('confirmed', 'claim');
  g.ret('skipped', 'skip');
  g.wire('entry.exec', 'needed.exec');
  g.wire('entry.pcr', 'classify.pcr', 'trip.pcr', 'subject.pcr');
  g.wire('classify.tripType', 'needed.value', 'trip.tripType');
  g.wire('classify.tripType', 'classified.tripType', 'skipped.tripType');
  g.wire('classify.reason', 'trip.reason', 'classified.reason');
  g.wire('classify.reason', 'confirmed.reason', 'skipped.reason');
  g.wire('trip.trip', 'context.trip');
  g.wire('needed.default', 'classified.exec');
  g.wire('needed.noClaim', 'noClaim.exec');
  g.wire('context.result', 'noClaim.context');
  g.wire('subject.subject', 'noClaim.subject');
  g.wire('noClaim.claim', 'confirmed.exec');
  g.wire('noClaim.tripType', 'confirmed.tripType');
  g.wire('noClaim.skip', 'skipped.exec');
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
  g.add('try', 'std.flow.try', { label: 'Read the Narrative if the Model Is Up' });
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
    [p('demographics', DEMOGRAPHICS), p('pcrNumber', 'string', true), p('claimId', 'string')],
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

const REVIEW_ANSWERS = ['tripType', 'level', 'emergency', 'loadedMiles', 'note'];

const reviewPcr = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['approved', 'voided'],
      inputs: [
        p('pcr', PCR_TYPE),
        p('tripType', 'string'),
        p('reason', 'string', true),
        p('patient', PATIENT),
        p('coverages', COVERAGES),
        p('payerNotes', { list: 'string' }),
        p('findings', FINDINGS),
        p('service', SERVICE),
        p('answers', { object: {} }, true)
      ],
      outputs: [
        p('tripType', 'string', true),
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
  g.add('documentation', 'billing.documentation-from-pcr', { label: 'Documentation' });
  g.add('context', 'std.expr', expr('Review Context', REVIEW_CONTEXT));
  g.add(
    'defaults',
    'std.expr',
    expr(
      'Answers Before, Else the Suggestion',
      'merge(service, { tripType: tripType }, fromEntries(filter(entries(answers ?? {}), e => e.value != null)))'
    )
  );
  g.add('review', 'std.human.task', {
    label: 'Review PCR',
    config: {
      title: 'Review PCR',
      queue: 'billing-review',
      instructions:
        'Check the patient, payers and impression codes, and confirm the trip type, level of service and loaded miles before this claim is priced. The suggestion lists what supports it, including what the narrative documents; warnings say what could not be read or decided.',
      fields: REVIEW_FIELDS,
      outcomes: ['approve', 'hold']
    }
  });
  g.add('given', 'std.object.make', {
    label: 'Answers',
    config: {
      fields: [
        { name: 'tripType', type: 'string' },
        { name: 'level', type: 'string' },
        { name: 'emergency', type: 'boolean' },
        { name: 'loadedMiles', type: 'number' },
        { name: 'note', type: 'string' }
      ]
    }
  });
  g.add('remember', 'std.var.set', { label: 'Remember the Answers', config: { name: 'answers' } });
  g.add(
    'holdContext',
    'std.expr',
    expr('Hold Context', `{ note: note, patient: ${nameOf('patient')}, trip: trip }`)
  );
  g.add('held', 'std.human.task', {
    label: 'Held PCR',
    config: {
      title: 'Held PCR',
      queue: 'billing-holds',
      instructions:
        'A reviewer held this PCR. Release it back to review once the report is sorted out, or void it so it is never billed.',
      outcomes: ['release', 'void']
    }
  });
  g.add('suggested', 'billing.service.break', { label: 'Suggested Service' });
  g.add('level', 'std.logic.coalesce', { label: 'Confirmed Level' });
  g.add('emergency', 'std.logic.coalesce', { label: 'Confirmed Emergency' });
  g.add('confirmed', 'billing.service.make', { label: 'Confirmed Service' });
  g.ret('approvedDone', 'approved');
  g.ret('voidedDone', 'voided');

  g.wire('entry.exec', 'start.exec');
  g.wire('entry.answers', 'start.value');
  g.wire('start.then', 'review.exec');
  g.wire('entry.pcr', 'trip.pcr', 'subject.pcr', 'documentation.pcr', 'context.pcr');
  g.wire('documentation.documentation', 'context.documentation');
  g.wire('entry.tripType', 'trip.tripType', 'defaults.tripType', 'context.tripType');
  g.wire('entry.reason', 'trip.reason', 'context.reason');
  g.wire('trip.trip', 'context.trip', 'holdContext.trip');
  g.wire('entry.patient', 'context.patient', 'holdContext.patient');
  g.wire('entry.coverages', 'context.coverages');
  g.wire('entry.payerNotes', 'context.payerNotes');
  g.wire('entry.findings', 'context.findings');
  g.wire('entry.service', 'context.service', 'defaults.service', 'suggested.service');
  g.wire('answers.value', 'defaults.answers');
  g.wire('defaults.result', 'review.defaults');
  g.wire('context.result', 'review.context');
  g.wire('subject.subject', 'review.subject', 'held.subject');
  for (const pin of REVIEW_ANSWERS) g.wire(`review.${pin}`, `given.${pin}`);

  g.wire('review.hold', 'remember.exec');
  g.wire('given.object', 'remember.value', 'approvedDone.answers');
  g.wire('remember.then', 'held.exec');
  g.wire('review.note', 'holdContext.note');
  g.wire('holdContext.result', 'held.context');
  g.wire('held.release', 'review.exec');
  g.wire('held.void', 'voidedDone.exec');

  g.wire('review.approve', 'approvedDone.exec');
  g.wire('review.tripType', 'approvedDone.tripType');
  g.wire('review.level', 'level.value');
  g.wire('suggested.level', 'level.fallback');
  g.wire('review.emergency', 'emergency.value');
  g.wire('suggested.emergency', 'emergency.fallback');
  g.wire('level.result', 'confirmed.level');
  g.wire('emergency.result', 'confirmed.emergency');
  g.wire('review.loadedMiles', 'confirmed.loadedMiles');
  g.wire('suggested.basis', 'confirmed.basis');
  g.wire('confirmed.service', 'approvedDone.service');
  return g.def;
};

const buildClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['saved', 'voided'],
    inputs: [
      p('claimId', 'string'),
      p('report', BLOB, true),
      p('pcr', PCR_TYPE),
      p('tripType', 'string'),
      p('patient', PATIENT),
      p('coverages', COVERAGES),
      p('service', SERVICE),
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: []
  });
  g.add('charges', 'billing.map-charges', { label: 'Charges' });
  g.add('primary', 'std.list.first', { label: 'Primary Payer' });
  g.add('primaryPayer', 'billing.coverage.break');
  g.add('price', 'billing.price-charges', { label: 'Price Charges' });
  for (const pin of ['report', 'pcr', 'tripType', 'patient', 'coverages', 'service', 'claimId']) {
    g.input(`${pin}ForClaim`, pin);
  }
  g.add('claim', 'billing.map-claim', { label: 'Map Claim' });
  g.add('save', 'billing.save-claim', { label: 'Save Draft Claim' });
  g.ret('savedDone', 'saved');
  g.ret('voidedDone', 'voided');
  g.wire('entry.exec', 'price.exec');
  g.wire('entry.tripType', 'charges.tripType');
  g.wire('entry.service', 'charges.service');
  g.wire('charges.lines', 'price.lines');
  g.wire('entry.coverages', 'primary.list');
  g.wire('primary.item', 'primaryPayer.coverage');
  g.wire('primaryPayer.payerId', 'price.payerId');
  g.wire('entry.subject', 'price.subject');
  g.wire('entry.context', 'price.context');
  g.wire('price.voided', 'voidedDone.exec');
  g.wire('price.priced', 'save.exec');
  g.wire('price.lines', 'claim.lines');
  g.wire('price.totalCents', 'claim.totalCents');
  for (const pin of ['report', 'pcr', 'tripType', 'patient', 'coverages', 'service']) {
    g.wire(`${pin}ForClaim.${pin}`, `claim.${pin}`);
  }
  g.wire('claim.claim', 'save.claim');
  g.wire('claimIdForClaim.claimId', 'save.claimId');
  g.wire('save.then', 'savedDone.exec');
  return g.def;
};

const startCycle = (): GraphDef => {
  const g = action([p('claimId', 'string')], [p('runId', 'string')]);
  g.add('inputs', 'std.object.make', {
    label: 'Cycle Inputs',
    config: { fields: [{ name: 'claimId', type: 'string' }] }
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
  const g = action([p('report', BLOB, true), p('claimId', 'string')], [p('runId', 'string')]);
  g.add('inputs', 'std.object.make', {
    label: 'Run Inputs',
    config: {
      fields: [
        { name: 'report', type: BLOB },
        { name: 'claimId', type: 'string' }
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
      inputs: [p('report', BLOB), p('claimId', 'string'), p('pcr', PCR_TYPE)],
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
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('context', 'std.expr', expr('Revision Context', REVISION_CONTEXT));
  g.add('canApply', 'std.object.get', { label: 'Can Apply', values: { path: 'canApply' } });
  g.add('revision', 'std.human.task', {
    label: 'Review Updated PCR',
    config: {
      title: 'Review updated PCR',
      queue: 'billing-review',
      instructions:
        'A newer version of this patient care report arrived after its claim was opened, so it was not billed again; the changes list what differs from the report the claim came from. Apply works the claim again from the new report while it is a draft, needs review or is void; a claim already on its way to payers is corrected on its claim page. Acknowledge keeps the claim as it is, or void it.',
      outcomes: ['apply', 'acknowledge', 'void']
    }
  });
  g.add('applies', 'std.flow.branch', { label: 'Can It Be Worked Again?' });
  g.input('report', 'report');
  g.input('claimId', 'claimId');
  g.add('rework', 'billing.rework-claim', { label: 'Work the Claim From the New Report' });
  g.add('void', 'billing.close-claim', {
    label: 'Void Revised Claim',
    values: { status: 'void' }
  });
  g.ret('done');
  g.wire('entry.exec', 'note.exec');
  g.wire('entry.report', 'note.report');
  g.wire('entry.claimId', 'note.claimId');
  g.wire('note.restartable', 'first.exec');
  g.wire('note.billed', 'first.exec');
  g.wire('note.previous', 'hasPrevious.value', 'readPrevious.report');
  g.wire('note.status', 'context.status');
  g.wire('hasPrevious.result', 'first.condition');
  g.wire('first.true', 'revision.exec');
  g.wire('first.false', 'readPrevious.exec');
  g.wire('readPrevious.then', 'keep.exec');
  g.wire('readPrevious.pcr', 'keep.value');
  g.wire('keep.then', 'revision.exec');
  g.wire('previous.value', 'context.previous');
  g.wire('pcr.pcr', 'classify.pcr', 'trip.pcr', 'subject.pcr', 'context.pcr');
  g.wire('classify.tripType', 'trip.tripType');
  g.wire('classify.reason', 'trip.reason');
  g.wire('trip.trip', 'context.trip');
  g.wire('contextClaimId.claimId', 'context.claimId');
  g.wire('subject.subject', 'revision.subject');
  g.wire('context.result', 'revision.context', 'canApply.object');
  g.wire('revision.apply', 'applies.exec');
  g.wire('canApply.value', 'applies.condition');
  g.wire('applies.true', 'rework.exec');
  g.wire('applies.false', 'revision.exec');
  g.wire('report.report', 'rework.report');
  g.wire('claimId.claimId', 'rework.claimId', 'void.claimId');
  g.wire('rework.then', 'done.exec');
  g.wire('revision.acknowledge', 'done.exec');
  g.wire('revision.void', 'void.exec');
  g.wire('void.then', 'done.exec');
  return g.def;
};

const billClaim = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: ['claimed', 'voided'],
      inputs: [
        p('claimId', 'string'),
        p('report', BLOB, true),
        p('pcr', PCR_TYPE),
        p('tripType', 'string'),
        p('reason', 'string', true),
        p('patient', PATIENT),
        p('coverages', COVERAGES),
        p('payerNotes', { list: 'string' }),
        p('findings', FINDINGS)
      ],
      outputs: [p('tripType', 'string', true)]
    },
    [
      { name: 'tripType', type: 'string', default: null },
      { name: 'answers', type: { object: {} }, default: null }
    ]
  );
  g.add('classified', 'std.var.set', { label: 'Trip Type to Bill', config: { name: 'tripType' } });
  for (const pin of ['pcr', 'findings']) g.input(`${pin}ToSuggest`, pin);
  g.add('tripType', 'std.var.get', { label: 'Trip Type', config: { name: 'tripType' } });
  g.add('suggest', 'billing.suggest-service', { label: 'Suggest Service for the Trip Type' });
  for (const pin of ['reason', 'patient', 'coverages', 'payerNotes'])
    g.input(`${pin}ToReview`, pin);
  g.add('answers', 'std.var.get', { label: 'Answers Given Before', config: { name: 'answers' } });
  g.add('review', 'billing.review-pcr', { label: 'Review PCR' });
  g.add('remember', 'std.var.set', {
    label: 'Remember the Approved Answers',
    config: { name: 'answers' }
  });
  g.add('reviewed', 'std.var.set', { label: 'Reviewed Trip Type', config: { name: 'tripType' } });
  for (const pin of ['claimId', 'report', 'pcr', 'reason', 'patient', 'coverages']) {
    g.input(`${pin}ToBuild`, pin);
  }
  g.add('billedTrip', 'std.var.get', { label: 'Trip Type', config: { name: 'tripType' } });
  g.add('trip', 'billing.trip-summary', { label: 'Trip Summary' });
  tripContext(g, 'claimContext');
  g.add('subject', 'billing.pcr-subject', { label: 'Task Subject' });
  g.add('build', 'billing.build-claim', { label: 'Build Claim' });
  g.add('fix', 'billing.fix-claim', { label: 'Validate and Fix Claim', values: { all: false } });
  g.add('cycle', 'billing.start-cycle', { label: 'Start Payer Cycle' });
  g.add('finalTrip', 'std.var.get', { label: 'Trip Type', config: { name: 'tripType' } });
  g.ret('claimed', 'claimed');
  g.input('voidClaimId', 'claimId');
  g.add('void', 'billing.close-claim', { label: 'Void Draft Claim', values: { status: 'void' } });
  g.ret('voided', 'voided');

  g.wire('entry.exec', 'classified.exec');
  g.wire('entry.tripType', 'classified.value');
  g.wire('classified.then', 'suggest.exec');
  g.wire('pcrToSuggest.pcr', 'suggest.pcr', 'review.pcr');
  g.wire('findingsToSuggest.findings', 'suggest.findings', 'review.findings');
  g.wire('tripType.value', 'suggest.tripType', 'review.tripType');
  g.wire('suggest.then', 'review.exec');
  g.wire('suggest.service', 'review.service');
  for (const pin of ['reason', 'patient', 'coverages', 'payerNotes']) {
    g.wire(`${pin}ToReview.${pin}`, `review.${pin}`);
  }
  g.wire('answers.value', 'review.answers');
  g.wire('review.approved', 'remember.exec');
  g.wire('review.answers', 'remember.value');
  g.wire('remember.then', 'reviewed.exec');
  g.wire('review.tripType', 'reviewed.value');
  g.wire('review.voided', 'void.exec');

  g.wire('reviewed.then', 'build.exec');
  g.wire('pcrToBuild.pcr', 'trip.pcr', 'subject.pcr', 'build.pcr');
  g.wire('reasonToBuild.reason', 'trip.reason');
  g.wire('billedTrip.value', 'trip.tripType', 'build.tripType');
  g.wire('trip.trip', 'claimContext.trip');
  for (const pin of ['claimId', 'report', 'patient', 'coverages']) {
    g.wire(`${pin}ToBuild.${pin}`, `build.${pin}`);
  }
  g.wire('review.service', 'build.service');
  g.wire('subject.subject', 'build.subject', 'fix.subject');
  g.wire('claimContext.result', 'build.context', 'fix.context');
  g.wire('claimIdToBuild.claimId', 'fix.claimId', 'cycle.claimId');
  g.wire('build.saved', 'fix.exec');
  g.wire('build.voided', 'void.exec');
  g.wire('fix.fixed', 'cycle.exec');
  g.wire('fix.backToReview', 'review.exec');
  g.wire('fix.voided', 'void.exec');
  g.wire('cycle.then', 'claimed.exec');
  g.wire('finalTrip.value', 'claimed.tripType');
  g.wire('voidClaimId.claimId', 'void.claimId');
  g.wire('void.then', 'voided.exec');
  return g.def;
};

const workDraftClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: ['claimed', 'skipped', 'voided'],
    inputs: [p('report', BLOB, true), p('pcr', PCR_TYPE), p('claimId', 'string')],
    outputs: [p('tripType', 'string', true), p('patient', PATIENT, true)]
  });
  g.add('decide', 'billing.decide-claim', { label: 'Is a Claim Needed?' });
  g.add('skip', 'billing.close-claim', {
    label: 'Void Skipped Claim',
    values: { status: 'void' }
  });
  g.ret('skipped', 'skipped');
  g.input('pcrToRead', 'pcr');
  g.add('report', 'nemsis.pcr.break');
  g.add('findings', 'billing.read-findings', { label: 'Narrative Findings' });
  g.add('demographics', 'billing.demographics-from-pcr', { label: 'Patient Demographics' });
  g.input('claimIdToAssign', 'claimId');
  g.add('patient', 'billing.claim-patient', { label: 'Claim Patient' });
  g.add('reported', 'billing.coverages-from-pcr', { label: 'Reported Coverages' });
  g.add('patientName', 'std.text.template', {
    label: 'Patient Name',
    config: { template: '{{ demographics.firstName }} {{ demographics.lastName }}' }
  });
  g.add('payers', 'billing.resolve-payers', { label: 'Resolve Payers' });
  for (const pin of ['claimId', 'report', 'pcr']) g.input(`${pin}ToBill`, pin);
  g.add('bill', 'billing.bill-claim', { label: 'Bill the Claim' });
  g.ret('claimed', 'claimed');
  g.ret('voided', 'voided');

  g.wire('entry.exec', 'decide.exec');
  g.wire('entry.pcr', 'decide.pcr');
  g.wire('decide.skip', 'skip.exec');
  g.wire('entry.claimId', 'skip.claimId');
  g.wire('skip.then', 'skipped.exec');
  g.wire('decide.tripType', 'skipped.tripType', 'bill.tripType');
  g.wire('decide.reason', 'bill.reason');
  g.wire('decide.claim', 'findings.exec');
  g.wire('pcrToRead.pcr', 'report.pcr', 'demographics.pcr', 'reported.pcr');
  g.wire('report.narrative', 'findings.narrative');
  g.wire('findings.then', 'patient.exec');
  g.wire('demographics.demographics', 'patient.demographics', 'patientName.demographics');
  g.wire('report.pcrNumber', 'patient.pcrNumber', 'payers.pcrNumber');
  g.wire('claimIdToAssign.claimId', 'patient.claimId');
  g.wire('patient.then', 'payers.exec');
  g.wire('reported.coverages', 'payers.coverages');
  g.wire('patientName.text', 'payers.patientName');
  g.wire('payers.then', 'bill.exec');
  for (const pin of ['claimId', 'report', 'pcr']) g.wire(`${pin}ToBill.${pin}`, `bill.${pin}`);
  g.wire('patient.patient', 'bill.patient', 'claimed.patient', 'voided.patient');
  g.wire('payers.coverages', 'bill.coverages');
  g.wire('payers.notes', 'bill.payerNotes');
  g.wire('findings.findings', 'bill.findings');
  g.wire('bill.claimed', 'claimed.exec');
  g.wire('bill.tripType', 'claimed.tripType');
  g.wire('bill.voided', 'voided.exec');
  return g.def;
};

const encounterToClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('report', BLOB), p('claimId', 'string', true)],
    outputs: [
      p('tripType', 'string', true),
      p('patient', PATIENT, true),
      p('claimId', 'string', true)
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
  g.wire('work.tripType', 'done.tripType');
  g.wire('work.patient', 'done.patient');
  g.wire('revision.then', 'revised.exec');
  return g.def;
};

const recoverDraft = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('claimId', 'string'), p('report', BLOB, true), p('reason', 'string', true)],
    outputs: []
  });
  g.add('context', 'std.object.make', {
    label: 'Orphan Context',
    config: {
      fields: [
        { name: 'claimId', type: 'string' },
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
      outcomes: ['restart', 'void']
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
  g.wire('orphan.restart', 'rework.exec');
  g.wire('rework.then', 'done.exec');
  g.wire('orphan.void', 'void.exec');
  g.wire('void.then', 'done.exec');
  return g.def;
};

const CLAIM_CONTEXT = `{
  claimId: claimId,
  coverageId: coverageId,
  payer: payer,
  balanceCents: balanceCents,
  issues: issues,
  claim: claim
}`;

const FILING_CONTEXT = `{
  claimId: claimId,
  coverageId: coverageId,
  payer: payer,
  balanceCents: balanceCents,
  whyNotFiled: reason,
  claim: claim
}`;

const PATIENT_ADDRESS_FIELDS = ['AddressLine', 'City', 'State', 'PostalCode'].map((part) => ({
  name: `patient${part}`,
  type: 'string',
  label: `Patient ${part === 'AddressLine' ? 'street address' : part === 'PostalCode' ? 'ZIP code' : part.toLowerCase()}`,
  required: ['save']
}));

const recordEvent = (g: Builder, id: string, kind: string, label: string) =>
  g.add(id, 'billing.record-claim-event', { label, values: { kind } });

const claimStep = (execOut: string[], about: PinSpec[] = [p('coverageId', 'string', true)]) =>
  graph({
    execIn: ['exec'],
    execOut,
    inputs: [
      p('claimId', 'string'),
      ...about,
      p('subject', 'string', true),
      p('context', 'any', true)
    ],
    outputs: []
  });

const reviewClaim = (): GraphDef => {
  const g = claimStep(['done', 'void']);
  g.add('review', 'std.human.task', {
    label: 'Review Claim',
    config: {
      title: 'Review claim',
      queue: 'billing-review',
      instructions:
        'Check the claim before it goes to this payer, or before the patient is billed when no payer is left: patient, member ID, service, charges, diagnoses and trip details, with any warnings. Approve it to make it ready, fix its data, skip this payer, or void the claim.',
      outcomes: ['approve', 'fixData', 'skipPayer', 'void']
    }
  });
  recordEvent(g, 'approve', 'approved', 'Approve');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to Next Payer');
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data on Request', values: { all: true } });
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'review.exec');
  g.wire('entry.subject', 'review.subject', 'fix.subject');
  g.wire('entry.context', 'review.context', 'fix.context');
  g.wire('entry.claimId', 'approve.claimId', 'skip.claimId', 'fix.claimId');
  g.wire('entry.coverageId', 'approve.coverageId', 'skip.coverageId');
  g.wire('review.approve', 'approve.exec');
  g.wire('review.fixData', 'fix.exec');
  g.wire('review.skipPayer', 'skip.exec');
  g.wire('review.void', 'voidReturn.exec');
  for (const done of ['approve.then', 'skip.then', 'fix.fixed', 'fix.backToReview'] as const) {
    g.wire(done, 'doneReturn.exec');
  }
  g.wire('fix.voided', 'voidReturn.exec');
  return g.def;
};

const CONFIRM_PAYER_PINS = [
  'payerId',
  'memberId',
  'relationship',
  'insuredFirstName',
  'insuredLastName'
];

const confirmPayers = (): GraphDef => {
  const g = claimStep(['done', 'void']);
  g.add('choices', 'billing.validate-claim', { label: 'Directory Choices', values: { all: true } });
  g.add('directory', 'std.object.pick', {
    label: 'Directory Payers',
    values: { keys: ['payerId'] }
  });
  g.add('confirm', 'std.human.task', {
    label: 'Confirm Payers',
    config: {
      title: 'Confirm payers',
      queue: 'billing-review',
      instructions:
        'The report named no payer the claim can be billed to. Add the payer from the directory with the member ID, or confirm the patient pays themselves.',
      fields: CLAIM_FIX_FIELDS.filter((f) => CONFIRM_PAYER_PINS.includes(f.name)).map((f) =>
        f.name === 'payerId' || f.name === 'memberId' ? { ...f, required: ['save'] } : f
      ),
      outcomes: ['save', 'selfPay']
    }
  });
  for (const pin of ['claimId', 'subject', 'context']) g.input(`${pin}ToReprice`, pin);
  g.add('addPayer', 'billing.patch-claim', { label: 'Add the Payer' });
  g.add('reprice', 'billing.reprice-claim', { label: 'Price for the New Payer' });
  recordEvent(g, 'selfPay', 'approved', 'Bill the Patient');
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'choices.exec');
  g.wire('entry.claimId', 'choices.claimId', 'addPayer.claimId', 'selfPay.claimId');
  g.wire('claimIdToReprice.claimId', 'reprice.claimId');
  g.wire('entry.coverageId', 'selfPay.coverageId');
  g.wire('entry.subject', 'confirm.subject');
  g.wire('entry.context', 'confirm.context');
  g.wire('subjectToReprice.subject', 'reprice.subject');
  g.wire('contextToReprice.context', 'reprice.context');
  g.wire('choices.valid', 'confirm.exec');
  g.wire('choices.invalid', 'confirm.exec');
  g.wire('choices.options', 'directory.object');
  g.wire('directory.object', 'confirm.options');
  g.wire('confirm.save', 'addPayer.exec');
  for (const pin of CONFIRM_PAYER_PINS) g.wire(`confirm.${pin}`, `addPayer.${pin}`);
  g.wire('confirm.selfPay', 'selfPay.exec');
  g.wire('addPayer.reprice', 'reprice.exec');
  g.wire('addPayer.tripType', 'reprice.tripType');
  g.wire('addPayer.service', 'reprice.service');
  g.wire('addPayer.payerId', 'reprice.payerId');
  for (const done of ['addPayer.patched', 'reprice.repriced', 'selfPay.then'] as const) {
    g.wire(done, 'doneReturn.exec');
  }
  g.wire('reprice.voided', 'voidReturn.exec');
  return g.def;
};

const submitClaim = (): GraphDef => {
  const g = claimStep(['done', 'void']);
  g.add('submit', 'std.human.task', {
    label: 'Claim Could Not Be Filed',
    config: {
      title: 'Claim could not be filed',
      queue: 'billing-review',
      instructions:
        'This claim was approved, but its 837P file could not be created for the reason in the details. Fix what it names (the billing profile is in Settings) and try again, fix the claim data (it is reviewed again), skip this payer, or mark it submitted if it went out another way.',
      outcomes: ['tryAgain', 'fixData', 'skipPayer', 'submitted']
    }
  });
  recordEvent(g, 'submitted', 'submitted', 'Submitted Outside the App');
  recordEvent(g, 'skip', 'payer_skipped', 'Move to Next Payer');
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data on Request', values: { all: true } });
  g.ret('doneReturn', 'done');
  g.ret('voidReturn', 'void');
  g.wire('entry.exec', 'submit.exec');
  g.wire('entry.subject', 'submit.subject', 'fix.subject');
  g.wire('entry.context', 'submit.context', 'fix.context');
  g.wire('entry.claimId', 'submitted.claimId', 'skip.claimId', 'fix.claimId');
  g.wire('entry.coverageId', 'submitted.coverageId', 'skip.coverageId');
  g.wire('submit.submitted', 'submitted.exec');
  g.wire('submit.fixData', 'fix.exec');
  g.wire('submit.skipPayer', 'skip.exec');
  for (const done of [
    'submit.tryAgain',
    'submitted.then',
    'skip.then',
    'fix.fixed',
    'fix.backToReview'
  ] as const) {
    g.wire(done, 'doneReturn.exec');
  }
  g.wire('fix.voided', 'voidReturn.exec');
  return g.def;
};

const reconcilePayment = (): GraphDef => {
  const g = claimStep(['done', 'writeOff']);
  g.add('reconcile', 'std.human.task', {
    label: 'Reconcile Payment',
    config: {
      title: 'Reconcile payment',
      queue: 'billing-reconcile',
      instructions:
        'The payer answered and a balance remains. Check what they paid and adjusted, with their reason codes, against the claim, and record anything missing. Continue to the next payer or the patient, write off the rest, or correct the claim and resubmit it to this payer as a replacement of their claim.',
      outcomes: ['continue', 'writeOff', 'resubmitCorrected']
    }
  });
  recordEvent(g, 'reconciled', 'reconciled', 'Mark the Response Reconciled');
  recordEvent(g, 'correct', 'resubmit_queued', 'Resubmit as a Corrected Claim');
  g.ret('doneReturn', 'done');
  g.ret('writeOffReturn', 'writeOff');
  g.wire('entry.exec', 'reconcile.exec');
  g.wire('entry.subject', 'reconcile.subject');
  g.wire('entry.context', 'reconcile.context');
  g.wire('entry.claimId', 'reconciled.claimId', 'correct.claimId');
  g.wire('entry.coverageId', 'reconciled.coverageId', 'correct.coverageId');
  g.wire('reconcile.continue', 'reconciled.exec');
  g.wire('reconcile.resubmitCorrected', 'correct.exec');
  g.wire('reconcile.writeOff', 'writeOffReturn.exec');
  g.wire('reconciled.then', 'doneReturn.exec');
  g.wire('correct.then', 'doneReturn.exec');
  return g.def;
};

const FOLLOW_UPS = [
  ['resubmit', 'resubmit_queued', 'Queue for the Next Batch'],
  ['keepWaiting', 'follow_up', 'Keep Waiting on Payer'],
  ['nextPayer', 'payer_skipped', 'Move On From the Payer']
] as const;

const followUpPayer = (): GraphDef => {
  const g = claimStep(['done']);
  g.add('followUp', 'std.human.task', {
    label: 'Follow Up with Payer',
    config: {
      title: 'Follow up on claim',
      queue: 'billing-followup',
      instructions:
        'The payer has not responded in time. Resubmit in the next 837P batch, keep waiting, or move on to the next payer. When the payer has the claim on file, enter its claim number so the resubmission replaces it.',
      fields: [{ name: 'payerClaimNumber', type: 'string', label: 'Payer claim number' }],
      outcomes: FOLLOW_UPS.map(([outcome]) => outcome)
    }
  });
  g.ret('doneReturn');
  g.wire('entry.exec', 'followUp.exec');
  g.wire('entry.subject', 'followUp.subject');
  g.wire('entry.context', 'followUp.context');
  for (const [outcome, kind, label] of FOLLOW_UPS) {
    recordEvent(g, outcome, kind, label);
    g.wire(`followUp.${outcome}`, `${outcome}.exec`);
    g.wire('entry.claimId', `${outcome}.claimId`);
    g.wire('entry.coverageId', `${outcome}.coverageId`);
    g.wire('followUp.payerClaimNumber', `${outcome}.payerClaimNumber`);
    g.wire(`${outcome}.then`, 'doneReturn.exec');
  }
  return g.def;
};

const sendStatement = (): GraphDef => {
  const g = claimStep(
    ['done', 'writeOff'],
    [p('statementNumber', 'integer'), p('statementCount', 'integer')]
  );
  g.add('statement', 'billing.issue-statement', { label: 'Send Patient Statement' });
  g.add('missing', 'std.flow.switch', {
    label: 'What the Statement Needs',
    config: { cases: ['profile', 'patientAddress'] }
  });
  g.add('profileNeeded', 'std.human.task', {
    label: 'Billing Profile Needed',
    config: {
      title: 'Billing profile needed',
      queue: 'billing-review',
      instructions:
        "Patient statements carry the agency's name, address, phone and time zone from the billing profile, and there is none. Add it in Settings, then continue.",
      outcomes: ['continue']
    }
  });
  g.add('addressNeeded', 'std.human.task', {
    label: 'Patient Address Needed',
    config: {
      title: 'Patient address needed',
      queue: 'billing-review',
      instructions:
        "The patient's mailing address is incomplete, so a statement cannot be sent. Enter it and save, or write off the balance.",
      fields: PATIENT_ADDRESS_FIELDS,
      outcomes: ['save', 'writeOff']
    }
  });
  g.add('addAddress', 'billing.patch-claim', { label: 'Save the Patient Address' });
  g.ret('doneReturn', 'done');
  g.ret('writeOffReturn', 'writeOff');
  g.wire('entry.exec', 'statement.exec');
  g.wire('entry.claimId', 'statement.claimId', 'addAddress.claimId');
  g.wire('entry.statementNumber', 'statement.statementNumber');
  g.wire('entry.statementCount', 'statement.statementCount');
  g.wire('entry.subject', 'profileNeeded.subject', 'addressNeeded.subject');
  g.wire('entry.context', 'profileNeeded.context', 'addressNeeded.context');
  g.wire('statement.issued', 'doneReturn.exec');
  g.wire('statement.missing', 'missing.exec');
  g.wire('statement.need', 'missing.value');
  g.wire('missing.profile', 'profileNeeded.exec');
  g.wire('missing.patientAddress', 'addressNeeded.exec');
  g.wire('missing.default', 'doneReturn.exec');
  g.wire('profileNeeded.continue', 'doneReturn.exec');
  g.wire('addressNeeded.save', 'addAddress.exec');
  for (const { name } of PATIENT_ADDRESS_FIELDS) {
    g.wire(`addressNeeded.${name}`, `addAddress.${name}`);
  }
  g.wire('addressNeeded.writeOff', 'writeOffReturn.exec');
  g.wire('addAddress.patched', 'doneReturn.exec');
  g.wire('addAddress.reprice', 'doneReturn.exec');
  return g.def;
};

const CLOSINGS = [
  ['closeWrittenOff', 'written_off', 'Close as Written Off'],
  ['closeCollections', 'collections', 'Close as Sent to Collections'],
  ['closePaid', 'paid', 'Close as Paid'],
  ['closeVoid', 'void', 'Close as Void']
] as const;

const cycleClaim = (): GraphDef => {
  const g = graph(
    { execIn: ['exec'], execOut: [], inputs: [p('claimId', 'string')], outputs: [] },
    [{ name: 'active', type: 'boolean', default: true }]
  );
  g.add('active', 'std.var.get', { config: { name: 'active' } });
  g.add('loop', 'std.flow.while', { label: 'Until the Claim Closes' });
  g.input('claimId', 'claimId');
  g.add('step', 'billing.claim-step', {
    label: 'Next Step',
    values: { payerWaitDays: 30, statementCount: 3, statementIntervalDays: 30 }
  });
  g.add('payerSubject', 'std.expr', subject('reference', 'payer'));
  g.add('claimSubject', 'std.expr', subject('reference'));
  g.add('claimContext', 'std.expr', expr('Claim Context', CLAIM_CONTEXT));
  g.input('stepClaimId', 'claimId');
  g.add('wait', 'std.flow.wait-signal', {
    label: 'Await a Claim Change or Deadline',
    values: { name: CLAIM_SIGNAL }
  });
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data', values: { all: false } });
  g.add('review', 'billing.review-claim', { label: 'Review Claim' });
  g.add('confirmPayers', 'billing.confirm-payers', { label: 'Confirm Payers' });
  g.add('prepare', 'billing.prepare-837p', { label: 'Prepare 837P Claim' });
  g.add('map', 'billing.map-837p', { label: 'Map 837P Claim' });
  g.add('file', 'billing.file-837p', { label: 'File 837P Claim' });
  g.add('send', 'billing.send-837p', { label: 'Send 837P to Clearinghouse' });
  g.add('filingContext', 'std.expr', expr('Filing Context', FILING_CONTEXT));
  g.add('submit', 'billing.submit-claim', { label: 'Claim Could Not Be Filed' });
  g.add('reconcile', 'billing.reconcile-payment', { label: 'Reconcile Payment' });
  g.add('overpaid', 'std.human.task', {
    label: 'Refund Overpayment',
    config: {
      title: 'Refund overpayment',
      queue: 'billing-reconcile',
      instructions:
        'More has been paid than the claim charges. Refund the difference and record the refund on the claim page, or keep the credit and close the claim as paid.',
      outcomes: ['refunded', 'keepCredit']
    }
  });
  g.add('followUp', 'billing.follow-up-payer', { label: 'Follow Up with Payer' });
  g.add('statement', 'billing.send-statement', { label: 'Send Patient Statement' });
  g.add('collections', 'std.human.task', {
    label: 'Collections Review',
    config: {
      title: 'Review unpaid balance',
      queue: 'billing-collections',
      instructions:
        'Every payer and patient statement is done and a balance remains. Write it off or send it to collections. If it has been paid in the meantime, either choice closes it as paid.',
      outcomes: ['writeOff', 'sendToCollections']
    }
  });
  g.input('closingClaimId', 'claimId');
  for (const [id, status, label] of CLOSINGS) {
    g.add(id, 'billing.close-claim', { label, values: { status } });
  }
  g.add('stop', 'std.var.set', {
    label: 'Stop Cycling',
    config: { name: 'active' },
    values: { value: false }
  });
  g.ret('done');

  g.wire('entry.exec', 'loop.exec');
  g.wire('active.value', 'loop.condition');
  g.wire('loop.body', 'step.exec');
  g.wire('loop.completed', 'done.exec');
  g.wire('claimId.claimId', 'step.claimId', 'claimContext.claimId');
  for (const pin of ['coverageId', 'payer', 'balanceCents', 'issues', 'claim']) {
    g.wire(`step.${pin}`, `claimContext.${pin}`);
  }
  g.wire('step.payer', 'payerSubject.payer');
  g.wire('step.reference', 'payerSubject.reference', 'claimSubject.reference');

  g.wire('step.await', 'wait.exec');
  g.wire('step.awaitPatient', 'wait.exec');
  g.wire('stepClaimId.claimId', 'wait.key');
  g.wire('step.waitMs', 'wait.timeoutMs');
  g.wire('step.signalsSeen', 'wait.after');

  const steps = [
    ['fix', 'payer'],
    ['review', 'payer'],
    ['confirmPayers', 'claim'],
    ['submit', 'payer'],
    ['reconcile', 'payer'],
    ['followUp', 'payer'],
    ['statement', 'claim']
  ] as const;
  for (const [id, about] of steps) {
    g.wire('stepClaimId.claimId', `${id}.claimId`);
    g.wire(`${about}Subject.result`, `${id}.subject`);
    g.wire(id === 'submit' ? 'filingContext.result' : 'claimContext.result', `${id}.context`);
    if (id !== 'fix' && id !== 'statement') g.wire('step.coverageId', `${id}.coverageId`);
  }
  for (const id of ['overpaid', 'collections']) {
    g.wire('claimSubject.result', `${id}.subject`);
    g.wire('claimContext.result', `${id}.context`);
  }
  g.wire('step.fix', 'fix.exec');
  g.wire('step.review', 'review.exec');
  g.wire('step.reviewPatient', 'review.exec');
  g.wire('step.confirmPayers', 'confirmPayers.exec');
  g.wire('step.submit', 'prepare.exec');
  g.wire('stepClaimId.claimId', 'prepare.claimId', 'file.claimId', 'send.claimId');
  g.wire('file.filed', 'send.exec');
  g.wire('file.controlNumber', 'send.controlNumber');
  g.wire('step.coverageId', 'file.coverageId');
  g.wire('prepare.ready', 'file.exec');
  g.wire('prepare.claim', 'map.claim');
  g.wire('map.x837', 'file.x837');
  g.wire('file.blocked', 'submit.exec');
  g.wire('claimId.claimId', 'filingContext.claimId');
  for (const pin of ['coverageId', 'payer', 'balanceCents', 'claim']) {
    g.wire(`step.${pin}`, `filingContext.${pin}`);
  }
  g.wire('file.reason', 'filingContext.reason');
  g.wire('step.reconcile', 'reconcile.exec');
  g.wire('step.overpaid', 'overpaid.exec');
  g.wire('step.followUp', 'followUp.exec');
  g.wire('step.statement', 'statement.exec');
  g.wire('step.statementNumber', 'statement.statementNumber');
  g.wire('step.statementCount', 'statement.statementCount');
  g.wire('step.collections', 'collections.exec');
  g.wire('step.closed', 'closePaid.exec');

  for (const id of ['fix.voided', 'review.void', 'confirmPayers.void', 'submit.void'] as const) {
    g.wire(id, 'closeVoid.exec');
  }
  for (const id of ['reconcile.writeOff', 'statement.writeOff', 'collections.writeOff'] as const) {
    g.wire(id, 'closeWrittenOff.exec');
  }
  g.wire('collections.sendToCollections', 'closeCollections.exec');
  g.wire('overpaid.keepCredit', 'closePaid.exec');
  for (const [id] of CLOSINGS) {
    g.wire('closingClaimId.claimId', `${id}.claimId`);
    g.wire(`${id}.then`, 'stop.exec');
  }
  return g.def;
};

const ingestNemsis = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('file', BLOB)],
    outputs: [p('count', 'integer'), p('runIds', { list: 'string' })]
  });
  g.add('split', 'nemsis.split');
  g.add('items', 'std.list.reshape', {
    label: 'One Input per Report',
    config: { fields: [{ name: 'report', type: BLOB, from: '' }] }
  });
  g.add('spawn', 'std.flow.spawn-workflows', {
    label: 'Claim Each Encounter',
    config: { workflow: 'billing.encounter-to-claim', version: 1 }
  });
  g.ret('return');
  g.wire('entry.exec', 'split.exec');
  g.wire('entry.file', 'split.file');
  g.wire('split.then', 'spawn.exec');
  g.wire('split.reports', 'items.list');
  g.wire('items.list', 'spawn.items');
  g.wire('spawn.then', 'return.exec');
  g.wire('split.count', 'return.count');
  g.wire('spawn.runIds', 'return.runIds');
  return g.def;
};

const LINE_CONTEXT = `{
  claimNumber: reference,
  outcome: outcome,
  problem: message,
  fileName: fileName
}`;

const reviewPayerFileLine = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [
      p('fileName', 'string'),
      p('reference', 'string'),
      p('claimId', 'string', true),
      p('outcome', 'string'),
      p('message', 'string')
    ],
    outputs: []
  });
  g.add('noClaim', 'std.logic.is-null', { label: 'No Claim Matched' });
  g.add('matched', 'std.flow.branch', { label: 'Matched a Claim?' });
  g.add('follow', 'billing.follow-claim', { label: 'Show on the Claim' });
  g.add('subject', 'std.expr', subject('fileName', 'reference'));
  g.add('context', 'std.expr', expr('Line Context', LINE_CONTEXT));
  g.add('review', 'std.human.task', {
    label: 'Review Payer File Line',
    config: {
      title: 'Review payer file line',
      queue: 'billing-reconcile',
      instructions:
        'The clearinghouse sent a line that could not be applied on its own: a claim number that matches no claim, a reversal, a pending status, or a payer that is not on the claim. Post or correct it on the claim by hand (or check the claim number with the clearinghouse), then mark it resolved.',
      outcomes: ['resolved']
    }
  });
  g.ret('done');
  g.wire('entry.exec', 'matched.exec');
  g.wire('entry.claimId', 'noClaim.value', 'follow.claimId');
  g.wire('noClaim.result', 'matched.condition');
  g.wire('matched.false', 'follow.exec');
  g.wire('matched.true', 'review.exec');
  g.wire('follow.then', 'review.exec');
  g.wire('entry.fileName', 'subject.fileName', 'context.fileName');
  g.wire('entry.reference', 'subject.reference', 'context.reference');
  g.wire('entry.outcome', 'context.outcome');
  g.wire('entry.message', 'context.message');
  g.wire('subject.result', 'review.subject');
  g.wire('context.result', 'review.context');
  g.wire('review.resolved', 'done.exec');
  return g.def;
};

const receivePayerFile = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('file', BLOB), p('fileName', 'string')],
    outputs: [p('fileId', 'string'), p('kind', 'string'), p('reviews', 'integer')]
  });
  g.add('apply', 'billing.apply-payer-file', { label: 'Apply to Claims' });
  g.add('lines', 'std.list.reshape', {
    label: 'One Review per Line',
    config: {
      fields: [
        { name: 'fileName', type: 'string' },
        { name: 'reference', type: 'string', from: 'reference' },
        { name: 'claimId', type: 'string', from: 'claimId' },
        { name: 'outcome', type: 'string', from: 'outcome' },
        { name: 'message', type: 'string', from: 'message' }
      ]
    }
  });
  g.add('spawn', 'std.flow.spawn-workflows', {
    label: 'Ask a Biller About Each Line',
    config: { workflow: 'billing.review-payer-file-line', version: 1 }
  });
  g.add('count', 'std.list.length', { label: 'Lines to Review' });
  g.add('shared', 'std.expr', expr('Same for Every Line', '{ fileName: fileName }'));
  g.add('unreadable', 'std.human.task', {
    label: 'Unreadable Clearinghouse File',
    config: {
      title: 'Unreadable clearinghouse file',
      queue: 'billing-reconcile',
      instructions:
        'The clearinghouse sent a file that is not a remittance (835), acknowledgment (999 or 277CA) or eligibility (271) file. Check it with the clearinghouse; nothing was applied.',
      outcomes: ['resolved']
    }
  });
  g.add('why', 'std.expr', expr('File Context', '{ fileName: fileName, problem: reason }'));
  g.ret('return');
  g.wire('entry.exec', 'apply.exec');
  g.wire('entry.file', 'apply.file');
  g.wire(
    'entry.fileName',
    'apply.fileName',
    'why.fileName',
    'unreadable.subject',
    'shared.fileName'
  );
  g.wire('shared.result', 'lines.shared');
  g.wire('apply.applied', 'spawn.exec');
  g.wire('apply.reviews', 'lines.list', 'count.list');
  g.wire('lines.list', 'spawn.items');
  g.wire('spawn.then', 'return.exec');
  g.wire('apply.duplicate', 'return.exec');
  g.wire('apply.unreadable', 'unreadable.exec');
  g.wire('apply.reason', 'why.reason');
  g.wire('why.result', 'unreadable.context');
  g.wire('unreadable.resolved', 'return.exec');
  g.wire('apply.fileId', 'return.fileId');
  g.wire('apply.kind', 'return.kind');
  g.wire('count.length', 'return.reviews');
  return g.def;
};

const node = (key: string, name: string, description: string, definition: GraphDef): SeedGraph => ({
  key,
  name,
  kind: 'node',
  description,
  version: 1,
  definition
});

const workflow = (
  key: string,
  name: string,
  description: string,
  definition: GraphDef
): SeedGraph => ({ key, name, kind: 'workflow', description, version: 1, definition });

export const billingGraphs: SeedGraph[] = [
  node(
    'billing.classify-trip',
    'Classify Trip',
    'Decides the trip type (emergency, scheduled, treatNoTransport, refusal or noClaim) from the report dispositions and type of service, with the rule that matched.',
    classifyTrip()
  ),
  node(
    'billing.loaded-miles',
    'Loaded Miles',
    'Destination minus scene odometer, or nothing when either is missing. Fractions are billed rounded up to the next tenth of a mile when the claim is priced.',
    loadedMiles()
  ),
  node(
    'billing.level-of-service',
    'Level of Service',
    'Suggests BLS, ALS1, ALS2 or SCT from the level of care, CMS service level, coded IV/IO medications and narrative findings, plus emergency status and loaded miles, with every reason that applied.',
    levelOfService()
  ),
  node(
    'billing.trip-emergency',
    'Emergency Trip',
    'The service an emergency transport is billed for.',
    tripService({})
  ),
  node(
    'billing.trip-scheduled',
    'Scheduled Trip',
    'The service a scheduled or interfacility transport is billed for: an emergency only when the unit responded immediately.',
    tripService({})
  ),
  node(
    'billing.trip-treat-no-transport',
    'Treat, No Transport',
    'The service a trip where the crew treated but did not transport is billed for: no loaded miles.',
    tripService({ loadedMiles: null })
  ),
  node(
    'billing.trip-refusal',
    'Refusal',
    'The service a trip where the patient refused care or transport is billed for: no loaded miles.',
    tripService({ loadedMiles: null })
  ),
  node(
    'billing.suggest-service',
    'Suggest Service',
    'Runs the service rules for the trip type.',
    suggestService()
  ),
  node(
    'billing.map-charges',
    'Map Charges',
    'Turns a confirmed service into HCPCS lines: a base rate by trip type, level and emergency, plus A0425 mileage for transports, priced in tenths of a mile rounded up.',
    mapCharges()
  ),
  node(
    'billing.demographics-from-pcr',
    'Demographics From PCR',
    'Maps the report patient to the demographics patients are matched and created by.',
    demographicsFromPcr()
  ),
  node(
    'billing.coverages-from-pcr',
    'Coverages From PCR',
    'Maps the report insurances to coverages with the insured and their relationship to the patient, or names Medicare or Medicaid from the payment method when there are none.',
    coveragesFromPcr()
  ),
  node(
    'billing.trip-details',
    'Trip Details',
    'Maps the report to the date of service, pickup, destination, diagnoses and origin/destination modifier.',
    tripDetails()
  ),
  node(
    'billing.documentation-from-pcr',
    'Documentation From PCR',
    'Maps what the report documents for billing: the release-for-billing signature, physician certification, CMS transport reason (reported, else from the reason for the destination), ambulance conditions, prior authorization, weight and trip times.',
    documentationFromPcr()
  ),
  node(
    'billing.map-claim',
    'Map Claim',
    'Builds the claim from the report, patient, payers, confirmed service and priced lines.',
    mapClaim()
  ),
  node(
    'billing.map-837p',
    'Map 837P Claim',
    'Maps a claim on its way to a payer onto an 837P claim: subscriber and patient, payer, prior payers for coordination of benefits, original or replacement frequency, ambulance conditions, origin/destination modifiers and service lines.',
    map837p()
  ),
  node(
    'billing.price-charges',
    'Price Charges',
    'Prices charge lines from the fee schedules, and asks a biller for the price of any code without a fee (optionally saving it to the default schedule) before going on, or voids.',
    priceCharges()
  ),
  node(
    'billing.reprice-claim',
    'Reprice Claim',
    'Maps the trip type and service to HCPCS lines, prices them for the payer (asking for any missing fee) and saves the new lines on the claim, or voids.',
    repriceClaim()
  ),
  node(
    'billing.fix-claim',
    'Fix Claim',
    'Checks a saved claim with the submission checks and, while anything blocks it (or always, with all), asks a biller to fix the fields the issues name, applies the fixes, reprices changed charges and checks again. Continues through fixed, voided or backToReview.',
    fixClaim()
  ),
  node(
    'billing.review-patient-match',
    'Review Patient Match',
    'Asks a biller to pick the patient among likely matches for report demographics, or to create a new patient from the report.',
    reviewPatientMatch()
  ),
  node(
    'billing.resolve-patient',
    'Resolve Patient',
    'Matches report demographics to a patient, creates one when nothing is close, asks a biller to pick among likely matches or create a new one, and asks for a missing or invalid name or birth date (prefilled with what was entered before), then matches the completed details the same way.',
    resolvePatient()
  ),
  node(
    'billing.resolve-payers',
    'Resolve Payers',
    'Links report payers to the payer directory and asks a biller about every other name: link it (remembered for later reports), leave it unlisted, or remove it when it is not insurance. Outputs what limited the matching.',
    resolvePayers()
  ),
  node(
    'billing.pcr-subject',
    'PCR Subject',
    'Names a report in task lists: its PCR number and the patient name.',
    pcrSubject()
  ),
  node(
    'billing.trip-summary',
    'Trip Summary',
    'Describes a trip for billers: PCR number, trip type and why, call time, response, care, impressions, pickup and destination.',
    tripSummary()
  ),
  node(
    'billing.decide-claim',
    'Decide Whether to Claim',
    'Classifies the trip and, when it looks like no claim is needed, asks a biller to skip the report or name the trip type to claim it as.',
    decideClaim()
  ),
  node(
    'billing.read-findings',
    'Read Narrative Findings',
    'Reads the medications and procedures the narrative documents with the local model, retrying while it is busy, or leaves the findings unread when it is down.',
    readFindings()
  ),
  node(
    'billing.claim-patient',
    'Claim Patient',
    'Resolves the patient from the report demographics, keeps their current address and assigns them to the draft claim.',
    claimPatient()
  ),
  node(
    'billing.review-pcr',
    'Review PCR',
    'Asks a biller to confirm the trip type, level of service and loaded miles, prefilled with earlier answers or the suggestion. Held reports wait for release or void.',
    reviewPcr()
  ),
  node(
    'billing.build-claim',
    'Build Claim',
    'Maps the confirmed service to charges, prices them for the primary payer, maps the claim from the report and saves it on the draft, or voids.',
    buildClaim()
  ),
  node(
    'billing.start-cycle',
    'Start Payer Cycle',
    'Starts the Cycle Claim workflow for a claim and links the claim to it.',
    startCycle()
  ),
  node(
    'billing.rework-claim',
    'Work the Claim Again',
    'Starts Encounter to Claim again for a claim from its report.',
    reworkClaim()
  ),
  node(
    'billing.review-revision',
    'Review Updated PCR',
    'Shows a biller what a newer report changed on an existing claim, and works the claim again from it, keeps the claim as it is, or voids it.',
    reviewRevision()
  ),
  node(
    'billing.bill-claim',
    'Bill the Claim',
    'Suggests the service for the trip type, has a biller review it, builds and fixes the claim and starts its payer cycle. A claim sent back to review is reviewed again with the answers given before.',
    billClaim()
  ),
  node(
    'billing.work-draft-claim',
    'Work Draft Claim',
    'Works a draft claim from its report: decides whether to claim, reads the narrative, resolves the patient and payers, then bills the claim.',
    workDraftClaim()
  ),
  node(
    'billing.review-claim',
    'Review Claim',
    'Asks a biller to approve the claim before it goes to a payer or the patient, fix its data, skip the payer or void it.',
    reviewClaim()
  ),
  node(
    'billing.confirm-payers',
    'Confirm Payers',
    'Asks a biller to add a directory payer to a claim without one, repricing it for that payer, or to bill the patient.',
    confirmPayers()
  ),
  node(
    'billing.submit-claim',
    'Claim Could Not Be Filed',
    'Asks a biller what to do about an approved claim whose 837P file could not be created: try again once the reason is fixed, fix its data, skip the payer, or mark it submitted elsewhere.',
    submitClaim()
  ),
  node(
    'billing.reconcile-payment',
    'Reconcile Payment',
    'Asks a biller to reconcile a payer response that leaves a balance: continue, resubmit a corrected claim, or write off the rest.',
    reconcilePayment()
  ),
  node(
    'billing.follow-up-payer',
    'Follow Up with Payer',
    'Asks a biller what to do about a payer that has not responded: resubmit, keep waiting, or move to the next payer.',
    followUpPayer()
  ),
  node(
    'billing.send-statement',
    'Send Patient Statement',
    'Sends the next patient statement, or asks for the billing profile or patient address it needs first.',
    sendStatement()
  ),
  workflow(
    'billing.cycle-claim',
    'Cycle Claim',
    'Bills each payer in claim order: fixes what blocks the claim, has it reviewed, files each approved claim as its own 837P (asking a biller when it cannot), follows up, reconciles responses (or resubmits a corrected claim), confirms payers when there are none, reviews before the first patient statement and asks for a missing billing profile or patient address, then sends statements before collections review. Sleeps until a claim change or a deadline.',
    cycleClaim()
  ),
  workflow(
    'billing.encounter-to-claim',
    'Encounter to Claim',
    'Turns one patient care report into a claim: opens a draft claim (or works an existing one again), classifies the trip, reads the narrative when the model is up, resolves the patient and payers, suggests the service for the trip type, has a biller confirm it, prices the charges, saves the draft, fixes what blocks it and starts its payer cycle. Reports already billed become revisions of their claim, shown with what changed.',
    encounterToClaim()
  ),
  workflow(
    'billing.recover-draft',
    'Recover Draft Claim',
    'Asks a biller what to do with a draft claim whose workflow stopped: work it again from its report, or void it.',
    recoverDraft()
  ),

  workflow(
    'billing.review-payer-file-line',
    'Review Payer File Line',
    'Shows a clearinghouse file line that could not be applied on its own on its claim, and asks a biller to resolve it.',
    reviewPayerFileLine()
  ),
  workflow(
    'billing.receive-payer-file',
    'Receive Payer File',
    'Applies a file the clearinghouse sent (835 remittance, 999 or 277CA acknowledgment, 271 eligibility) to its claims, and asks a biller about each line that could not be applied on its own. Started for every file downloaded from the clearinghouse.',
    receivePayerFile()
  ),
  workflow(
    'billing.ingest-nemsis',
    'Ingest NEMSIS File',
    'Splits a NEMSIS export and starts one Encounter to Claim run per report, without waiting for them.',
    ingestNemsis()
  )
];
