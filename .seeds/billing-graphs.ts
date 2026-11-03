import { CLAIM_SIGNAL } from '@ugula/billing';
import type { GraphDef, Json, PinSpec, ValueType } from '@ugula/graph';
import { PCR_TYPE } from '@ugula/nemsis';
import { graph } from './builder.ts';
import type { SeedGraph } from './graphs.ts';

const obj = (fields: Record<string, ValueType>): ValueType => ({ object: fields });

const BLOB = obj({ bucket: 'string', key: 'string' });

const ADDRESS = { addressLine: 'string', city: 'string', state: 'string', postalCode: 'string' };

const DEMOGRAPHICS = obj({
  firstName: 'string',
  lastName: 'string',
  birthDate: 'string',
  gender: 'string',
  ...ADDRESS
} as Record<string, ValueType>);

const PATIENT = obj({
  id: 'string',
  firstName: 'string',
  lastName: 'string',
  birthDate: 'string',
  gender: 'string',
  ...ADDRESS
} as Record<string, ValueType>);

const LOCATION = obj({ name: 'string', ...ADDRESS } as Record<string, ValueType>);

const COVERAGES: ValueType = {
  list: obj({
    payer: 'string',
    payerId: 'string',
    directoryName: 'string',
    payerCode: 'string',
    priority: 'string',
    memberId: 'string',
    groupId: 'string'
  })
};

const SERVICE = obj({
  level: 'string',
  emergency: 'boolean',
  loadedMiles: 'number',
  basis: { list: 'string' }
});

const FINDINGS = obj({
  medications: { list: obj({ medication: 'string', route: 'string', doses: 'integer' }) },
  procedures: { list: 'string' },
  ivDoses: 'integer'
});

const LINE = obj({
  code: 'string',
  units: 'number',
  unitCents: 'integer',
  totalCents: 'integer'
});

const LINES: ValueType = { list: LINE };

const CLAIM = obj({
  pcrNumber: 'string',
  patientId: 'string',
  serviceDate: 'string',
  level: 'string',
  emergency: 'boolean',
  loadedMiles: 'number',
  lines: LINES,
  totalCents: 'integer',
  coverages: COVERAGES,
  pickup: LOCATION,
  destination: LOCATION,
  diagnoses: { list: 'string' },
  originDestination: 'string',
  report: BLOB
});

const SUBMISSION = obj({
  claimId: 'string',
  priorPayers: { list: 'string' },
  payer: obj({ name: 'string', payerId: 'string', claimFiling: 'string' }),
  memberId: 'string',
  groupId: 'string',
  patient: obj({
    firstName: 'string',
    lastName: 'string',
    birthDate: 'string',
    sex: 'string',
    ...ADDRESS
  } as Record<string, ValueType>),
  details: obj({
    serviceDate: 'string',
    pickup: LOCATION,
    destination: LOCATION,
    diagnoses: { list: 'string' },
    originDestination: 'string'
  }),
  emergency: 'boolean',
  loadedMiles: 'number',
  lines: LINES
});

const X837 = obj({
  claimId: 'string',
  placeOfService: 'string',
  frequency: 'string',
  subscriber: obj({
    relationship: 'string',
    lastName: 'string',
    firstName: 'string',
    memberId: 'string',
    groupId: 'string',
    ...ADDRESS,
    birthDate: 'string',
    sex: 'string'
  } as Record<string, ValueType>),
  payer: obj({
    responsibility: 'string',
    name: 'string',
    payerId: 'string',
    claimFiling: 'string'
  }),
  transportReason: 'string',
  loadedMiles: 'number',
  conditionCodes: { list: 'string' },
  diagnoses: { list: 'string' },
  pickup: LOCATION,
  dropoff: LOCATION,
  lines: {
    list: obj({
      code: 'string',
      modifiers: { list: 'string' },
      chargeCents: 'integer',
      units: 'number',
      serviceDate: 'string'
    })
  }
});

const p = (name: string, type: ValueType, optional = false): PinSpec => ({
  name,
  type,
  ...(optional ? { optional: true } : {})
});

const pure = (inputs: PinSpec[], outputs: PinSpec[]) =>
  graph({ execIn: [], execOut: [], inputs, outputs });

const action = (inputs: PinSpec[], outputs: PinSpec[], execOut = ['then']) =>
  graph({ execIn: ['exec'], execOut, inputs, outputs });

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
const atLeast = (value: number) => ({ op: 'gte', value });
const startsWith = (...value: string[]) => ({ op: 'startsWith', value });

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
          when: { serviceType: oneOf('2205005', '2205007', '2205015', '2205017', '2205019') },
          set: { tripType: 'scheduled' }
        },
        { label: 'Emergency transport', set: { tripType: 'emergency' } }
      ]
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
  g.add('rounded', 'std.math.round', { label: 'Tenths of a Mile', values: { digits: 1 } });
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
  g.add('findings', 'billing.findings.break');
  g.add('procedures', 'std.logic.coalesce', {
    label: 'Narrative Procedures',
    values: { fallback: [] }
  });
  g.add('procedureCount', 'std.list.length', { label: 'How Many ALS2 Procedures' });
  g.add('level', 'std.table.decide', {
    label: 'Level of Service',
    config: table(
      [
        field('levelOfCare', 'string', 'Level of care provided · eDisposition.32'),
        field('cmsServiceLevel', 'string', 'CMS service level · ePayment.50'),
        field('codedIvMedications', 'integer', 'IV/IO medications coded'),
        field('narrativeIvDoses', 'integer', 'IV/IO doses in the narrative'),
        field('narrativeProcedures', 'integer', 'ALS2 procedures in the narrative')
      ],
      [field('level', 'string', 'Level of service')],
      [
        {
          label: 'Critical care documented',
          when: { levelOfCare: is('4232009') },
          set: { level: 'SCT' }
        },
        {
          label: 'Crew reported specialty care transport',
          when: { cmsServiceLevel: is('2650015') },
          set: { level: 'SCT' }
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
          label: 'Emergent response to scene',
          when: { responseMode: oneOf('2223001', '2223007') },
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
  g.wire('ivMedications.count', 'level.codedIvMedications');
  g.wire('findings.ivDoses', 'level.narrativeIvDoses');
  g.wire('procedureCount.length', 'level.narrativeProcedures');
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
  const g = pure(
    [p('tripType', 'string'), p('service', SERVICE)],
    [p('lines', { list: obj({ code: 'string', units: 'number' }) })]
  );
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
          set: { code: 'A0998' }
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
  g.add('tenths', 'std.math.multiply', { label: 'In Tenths', values: { b: 10 } });
  g.add('roundUp', 'std.math.ceil', { label: 'Round Up' });
  g.add('units', 'std.math.divide', { label: 'Back to Miles', values: { b: 10 } });
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
  g.wire('miles.result', 'tenths.a');
  g.wire('tenths.result', 'roundUp.value');
  g.wire('roundUp.result', 'units.a');
  g.wire('mileage.code', 'mileageLine.code');
  g.wire('units.result', 'mileageLine.units');
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
  for (const pin of [
    'firstName',
    'lastName',
    'birthDate',
    'addressLine',
    'city',
    'state',
    'postalCode'
  ]) {
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
        { name: 'groupId', type: 'string', from: 'groupId' }
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
        { label: 'Home', when: { locationType: startsWith('Y92.0') }, set: { code: 'R' } },
        {
          label: 'Nursing home',
          when: { locationType: startsWith('Y92.12') },
          set: { code: 'E' }
        },
        { label: 'Hospital', when: { locationType: startsWith('Y92.23') }, set: { code: 'H' } },
        {
          label: "Physician's office or clinic",
          when: { locationType: startsWith('Y92.53') },
          set: { code: 'P' }
        }
      ],
      { code: 'S' }
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
  for (const pin of ['addressLine', 'city', 'state', 'postalCode']) {
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

const mapClaim = (): GraphDef => {
  const g = pure(
    [
      p('pcr', PCR_TYPE),
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
  g.add('patient', 'billing.patient.break');
  g.add('service', 'billing.service.break');
  g.add('claim', 'billing.claim.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr', 'trip.pcr');
  g.wire('entry.patient', 'patient.patient');
  g.wire('entry.service', 'service.service');
  g.wire('pcr.pcrNumber', 'claim.pcrNumber');
  g.wire('patient.id', 'claim.patientId');
  for (const pin of ['serviceDate', 'pickup', 'destination', 'diagnoses', 'originDestination']) {
    g.wire(`trip.${pin}`, `claim.${pin}`);
  }
  for (const pin of ['level', 'emergency', 'loadedMiles']) g.wire(`service.${pin}`, `claim.${pin}`);
  for (const pin of ['coverages', 'lines', 'totalCents', 'report']) {
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
  g.add('subscriber', 'x837.subscriber.make', { values: { relationship: '18' } });
  g.add('x12Payer', 'x837.payer.make', { values: { responsibility: 'P' } });
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
          when: { claimFiling: oneOf('MA', 'MB'), codes: oneOf('A0998') },
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
  g.add('x837', 'x837.claim.make', {
    values: { placeOfService: '41', frequency: '1', transportReason: 'A' }
  });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.patient', 'patient.patient');
  g.wire('claim.details', 'details.details');
  for (const pin of [
    'firstName',
    'lastName',
    'birthDate',
    'sex',
    'addressLine',
    'city',
    'state',
    'postalCode'
  ]) {
    g.wire(`patient.${pin}`, `subscriber.${pin}`);
  }
  g.wire('claim.memberId', 'subscriber.memberId');
  g.wire('claim.groupId', 'subscriber.groupId');
  for (const pin of ['name', 'payerId', 'claimFiling']) g.wire(`payer.${pin}`, `x12Payer.${pin}`);
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
  g.wire('x12Payer.payer', 'x837.payer');
  g.wire('claim.loadedMiles', 'x837.loadedMiles');
  g.wire('conditions.codes', 'x837.conditionCodes');
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
  trip: ${TRIP},
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
  suggested: service
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

const PATIENT_CHOICES = `len(candidates) > 0 ? {
  patientId: map(candidates, c => {
    value: c.id,
    label: c.lastName + ', ' + c.firstName + ' · born ' + c.birthDate +
      (c.postalCode ? ' · ' + c.postalCode : '')
  })
} : null`;

const resolvePatient = (): GraphDef => {
  const g = action(
    [p('demographics', DEMOGRAPHICS), p('pcrNumber', 'string', true)],
    [p('patient', PATIENT)]
  );
  g.add('match', 'billing.match-patient');
  g.add('create', 'billing.create-patient', { values: { reuseMatch: true } });
  g.add('choices', 'std.expr', expr('Candidate Choices', PATIENT_CHOICES));
  g.add('context', 'std.expr', expr('Review Context', PATIENT_REVIEW_CONTEXT));
  g.add('subject', 'std.expr', subject('pcrNumber', nameOf('demographics')));
  g.add('confirm', 'std.human.task', {
    label: 'Confirm Patient',
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
  });
  g.add('reported', 'billing.demographics.break', { label: 'Cleaned Demographics' });
  g.add('corrected', 'billing.demographics.make', { label: 'Corrected Demographics' });
  g.add('createReviewed', 'billing.create-patient', { label: 'Create Reviewed Patient' });
  g.add('find', 'billing.find-patient');
  for (const id of ['matched', 'created', 'reviewed', 'linked']) g.ret(id);
  g.wire('entry.exec', 'match.exec');
  g.wire('entry.demographics', 'match.demographics', 'create.demographics');
  g.wire('match.matched', 'matched.exec');
  g.wire('match.patient', 'matched.patient');
  g.wire('match.unmatched', 'create.exec');
  g.wire('create.then', 'created.exec');
  g.wire('create.patient', 'created.patient');
  g.wire('match.review', 'confirm.exec');
  g.wire('match.candidates', 'choices.candidates', 'context.candidates');
  g.wire('choices.result', 'confirm.options');
  g.wire('match.reason', 'context.reason');
  g.wire('match.demographics', 'context.demographics', 'confirm.defaults', 'reported.demographics');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
  g.wire('entry.demographics', 'subject.demographics');
  g.wire('context.result', 'confirm.context');
  g.wire('subject.result', 'confirm.subject');
  g.wire('confirm.link', 'find.exec');
  g.wire('confirm.patientId', 'find.patientId');
  g.wire('confirm.create', 'createReviewed.exec');
  for (const pin of ['gender', 'addressLine', 'city', 'state', 'postalCode']) {
    g.wire(`reported.${pin}`, `corrected.${pin}`);
  }
  for (const pin of ['firstName', 'lastName', 'birthDate']) {
    g.wire(`confirm.${pin}`, `corrected.${pin}`);
  }
  g.wire('corrected.demographics', 'createReviewed.demographics');
  g.wire('createReviewed.then', 'reviewed.exec');
  g.wire('createReviewed.patient', 'reviewed.patient');
  g.wire('find.then', 'linked.exec');
  g.wire('find.patient', 'linked.patient');
  return g.def;
};

const resolvePayers = (): GraphDef => {
  const g = action(
    [p('coverages', COVERAGES), p('pcrNumber', 'string', true), p('patientName', 'string', true)],
    [p('coverages', COVERAGES)]
  );
  g.add('match', 'billing.match-payers');
  g.add('each', 'std.flow.for-each', { label: 'Each Uncertain Payer' });
  g.add('choices', 'std.expr', expr('Directory Choices', '{ payerId: item.candidates }'));
  g.add('suggestion', 'std.expr', expr('Suggested Payer', '{ payerId: item.suggested }'));
  g.add(
    'context',
    'std.expr',
    expr(
      'Payer context',
      '{ reportedPayer: item.payer, memberId: item.memberId, patient: patientName, pcrNumber: pcrNumber }'
    )
  );
  g.add('confirm', 'std.human.task', {
    label: 'Match Payer',
    config: {
      title: 'Match payer',
      queue: 'billing-payers',
      instructions:
        'The report names a payer that is not in the payer directory by that name. Choose the directory payer it means, and later reports with this name link automatically, or mark it unlisted.',
      fields: [{ name: 'payerId', type: 'string', label: 'Directory payer' }],
      outcomes: ['link', 'unlisted']
    }
  });
  g.add('reported', 'std.object.get', { label: 'Reported Name', values: { path: 'payer' } });
  g.add('subject', 'std.expr', subject('pcrNumber', 'item.payer'));
  g.add('link', 'billing.link-payer', { label: 'Remember Payer Name' });
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
  g.wire('match.review', 'each.exec');
  g.wire('match.unmatched', 'each.list');
  g.wire('each.body', 'confirm.exec');
  g.wire('each.item', 'choices.item', 'suggestion.item', 'context.item', 'subject.item');
  g.wire('each.item', 'reported.object');
  g.wire('entry.pcrNumber', 'context.pcrNumber', 'subject.pcrNumber');
  g.wire('entry.patientName', 'context.patientName');
  g.wire('choices.result', 'confirm.options');
  g.wire('suggestion.result', 'confirm.defaults');
  g.wire('context.result', 'confirm.context');
  g.wire('subject.result', 'confirm.subject');
  g.wire('confirm.link', 'link.exec');
  g.wire('reported.value', 'link.name');
  g.wire('confirm.payerId', 'link.payerId');
  g.wire('each.completed', 'rematch.exec');
  g.wire('rematch.matched', 'reviewed.exec');
  g.wire('rematch.review', 'reviewed.exec');
  g.wire('rematch.coverages', 'reviewed.coverages');
  return g.def;
};

const REVIEW_FIELDS = [
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
];

const encounterToClaim = (): GraphDef => {
  const g = graph({
    execIn: ['exec'],
    execOut: [],
    inputs: [p('report', BLOB)],
    outputs: [
      p('tripType', 'string', true),
      p('patient', PATIENT, true),
      p('claimId', 'string', true)
    ]
  });
  g.add('read', 'nemsis.read-report');
  g.add('pcr', 'nemsis.pcr.break');
  g.add('open', 'billing.open-claim', { label: 'Open Draft Claim' });
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('tripSwitch', 'std.flow.switch', {
    label: 'Claim Needed?',
    config: { cases: ['noClaim'] }
  });
  g.add('tripContext', 'std.expr', expr('Trip Context', `{ trip: ${TRIP} }`));
  g.add('subject', 'std.expr', subject('pcr.pcrNumber', nameOf('pcr.patient')));
  g.add('noClaim', 'std.human.task', {
    label: 'Confirm No Claim',
    config: {
      title: 'Confirm no claim',
      queue: 'billing-review',
      instructions:
        'This report looks like a cancelled call or a trip without patient contact, so no claim would be made. Skip it, or make a claim if care was given.',
      outcomes: ['skip', 'claim']
    }
  });
  g.add('skip', 'billing.close-claim', {
    label: 'Void Skipped Claim',
    values: { status: 'void' }
  });
  g.ret('skipped');
  g.add('narrative', 'billing.read-narrative', {
    retry: { max: 3, delayMs: 30_000, factor: 4 }
  });
  g.add('demographics', 'billing.demographics-from-pcr', { label: 'Patient Demographics' });
  g.add('patient', 'billing.resolve-patient', { label: 'Resolve Patient' });
  g.add('assign', 'billing.assign-patient', { label: 'Assign Patient to Claim' });
  g.add('reported', 'billing.coverages-from-pcr', { label: 'Reported Coverages' });
  g.add('patientName', 'std.text.template', {
    label: 'Patient Name',
    config: { template: '{{ demographics.firstName }} {{ demographics.lastName }}' }
  });
  g.add('payers', 'billing.resolve-payers', { label: 'Resolve Payers' });
  g.add('suggest', 'billing.suggest-service', { label: 'Suggest Service for the Trip Type' });
  g.add('reviewContext', 'std.expr', expr('Review Context', REVIEW_CONTEXT));
  g.add('review', 'std.human.task', {
    label: 'Review PCR',
    config: {
      title: 'Review PCR',
      queue: 'billing-review',
      instructions:
        'Check the patient, payers and impression codes, and confirm the level of service and loaded miles before this claim is priced. The suggestion lists what supports it, including what the narrative documents.',
      fields: REVIEW_FIELDS,
      outcomes: ['approve', 'hold']
    }
  });
  g.add(
    'holdContext',
    'std.expr',
    expr('Hold Context', `{ note: note, patient: ${nameOf('patient')}, trip: ${TRIP} }`)
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
  g.ret('voided');
  g.add('suggested', 'billing.service.break', { label: 'Suggested Service' });
  g.add('level', 'std.logic.coalesce', { label: 'Confirmed Level' });
  g.add('emergency', 'std.logic.coalesce', { label: 'Confirmed Emergency' });
  g.add('confirmed', 'billing.service.make', { label: 'Confirmed Service' });
  g.add('charges', 'billing.map-charges', { label: 'Charges' });
  g.add('primary', 'std.list.first', { label: 'Primary Payer' });
  g.add('primaryPayer', 'billing.coverage.break');
  g.add('price', 'billing.price-claim');
  g.add('claim', 'billing.map-claim', { label: 'Map Claim' });
  g.add('validate', 'billing.validate-claim');
  g.add('fixContext', 'std.expr', expr('Problems', `{ issues: issues, trip: ${TRIP} }`));
  g.add('fix', 'std.human.task', {
    label: 'Claim Needs Attention',
    config: {
      title: 'Claim needs attention',
      queue: 'billing-review',
      instructions:
        'The claim is missing something it needs before it can be saved. Send it back to review to correct it, or void it.',
      outcomes: ['review', 'void']
    }
  });
  g.add('save', 'billing.save-claim', { label: 'Save Claim for Review' });
  g.add('void', 'billing.close-claim', { label: 'Void Draft Claim', values: { status: 'void' } });
  g.add('cycleInputs', 'std.object.make', {
    config: { fields: [{ name: 'claimId', type: 'string' }] }
  });
  g.add('cycle', 'std.flow.start-workflow', {
    label: 'Start Payer Cycle',
    config: { workflow: 'billing.cycle-claim', version: 1 }
  });
  g.add('attach', 'billing.attach-cycle', { label: 'Link Claim to Its Cycle' });
  g.ret('approved');
  g.add('noteRevision', 'billing.note-revision');
  g.add(
    'revisionContext',
    'std.expr',
    expr(
      'Revision Context',
      `{ claimId: claimId, patient: { name: ${nameOf('pcr.patient')}, birthDate: pcr.patient.birthDate }, trip: ${TRIP} }`
    )
  );
  g.add('revision', 'std.human.task', {
    label: 'Review Updated PCR',
    config: {
      title: 'Review updated PCR',
      queue: 'billing-review',
      instructions:
        'A newer version of this patient care report arrived after its claim was opened, so it was not billed again. Compare it with the claim and correct the claim if anything changed.',
      outcomes: ['acknowledge']
    }
  });
  g.ret('revised');

  g.wire('entry.exec', 'read.exec');
  g.wire('entry.report', 'read.report', 'noteRevision.report', 'claim.report');
  g.wire('read.pcr', 'pcr.pcr');
  g.wire('read.then', 'open.exec');
  g.wire('pcr.pcrNumber', 'open.pcrNumber');
  g.wire('entry.report', 'open.report');
  g.wire('open.claimId', 'skip.claimId', 'skipped.claimId', 'assign.claimId', 'save.claimId');
  g.wire('open.claimId', 'void.claimId', 'voided.claimId', 'cycleInputs.claimId', 'attach.claimId');
  g.wire('open.claimId', 'approved.claimId', 'noteRevision.claimId', 'revisionContext.claimId');
  g.wire('open.claimId', 'revised.claimId');

  const pcr = 'read.pcr';
  g.wire(pcr, 'classify.pcr', 'tripContext.pcr', 'subject.pcr', 'demographics.pcr', 'reported.pcr');
  g.wire(pcr, 'suggest.pcr', 'reviewContext.pcr', 'holdContext.pcr', 'claim.pcr');
  g.wire(pcr, 'fixContext.pcr', 'revisionContext.pcr');
  const tripType = 'classify.tripType';
  g.wire(
    tripType,
    'tripSwitch.value',
    'tripContext.tripType',
    'suggest.tripType',
    'charges.tripType'
  );
  g.wire(tripType, 'reviewContext.tripType', 'holdContext.tripType', 'fixContext.tripType');
  g.wire(tripType, 'revisionContext.tripType', 'skipped.tripType', 'approved.tripType');
  g.wire('classify.reason', 'tripContext.reason', 'reviewContext.reason', 'holdContext.reason');
  g.wire('classify.reason', 'fixContext.reason', 'revisionContext.reason');
  g.wire('subject.result', 'noClaim.subject', 'review.subject', 'held.subject');
  g.wire('subject.result', 'fix.subject', 'revision.subject');

  g.wire('open.opened', 'tripSwitch.exec');
  g.wire('tripSwitch.noClaim', 'noClaim.exec');
  g.wire('tripContext.result', 'noClaim.context');
  g.wire('noClaim.skip', 'skip.exec');
  g.wire('skip.then', 'skipped.exec');
  g.wire('noClaim.claim', 'narrative.exec');
  g.wire('tripSwitch.default', 'narrative.exec');

  g.wire('pcr.narrative', 'narrative.narrative');
  g.wire('narrative.then', 'patient.exec');
  g.wire('demographics.demographics', 'patient.demographics', 'patientName.demographics');
  g.wire('pcr.pcrNumber', 'patient.pcrNumber', 'payers.pcrNumber');
  g.wire('patient.then', 'assign.exec');
  g.wire('patient.patient', 'assign.patient');
  g.wire('assign.then', 'payers.exec');
  g.wire('reported.coverages', 'payers.coverages');
  g.wire('patientName.text', 'payers.patientName');
  g.wire('payers.then', 'suggest.exec');
  g.wire('narrative.findings', 'suggest.findings', 'reviewContext.findings');
  g.wire('suggest.then', 'review.exec');
  g.wire('patient.patient', 'reviewContext.patient', 'holdContext.patient', 'claim.patient');
  g.wire('payers.coverages', 'reviewContext.coverages', 'primary.list', 'claim.coverages');
  g.wire('suggest.service', 'reviewContext.service', 'review.defaults', 'suggested.service');
  g.wire('reviewContext.result', 'review.context');

  g.wire('review.hold', 'held.exec');
  g.wire('review.note', 'holdContext.note');
  g.wire('holdContext.result', 'held.context');
  g.wire('held.release', 'review.exec');
  g.wire('held.void', 'void.exec');
  g.wire('void.then', 'voided.exec');
  g.wire('patient.patient', 'voided.patient');
  g.wire(tripType, 'voided.tripType');

  g.wire('review.approve', 'price.exec');
  g.wire('review.level', 'level.value');
  g.wire('suggested.level', 'level.fallback');
  g.wire('review.emergency', 'emergency.value');
  g.wire('suggested.emergency', 'emergency.fallback');
  g.wire('level.result', 'confirmed.level');
  g.wire('emergency.result', 'confirmed.emergency');
  g.wire('review.loadedMiles', 'confirmed.loadedMiles');
  g.wire('suggested.basis', 'confirmed.basis');
  g.wire('confirmed.service', 'charges.service', 'claim.service');
  g.wire('charges.lines', 'price.lines');
  g.wire('primary.item', 'primaryPayer.coverage');
  g.wire('primaryPayer.payerId', 'price.payerId');
  g.wire('price.lines', 'claim.lines');
  g.wire('price.totalCents', 'claim.totalCents');
  g.wire('price.then', 'validate.exec');
  g.wire('claim.claim', 'validate.claim', 'save.claim');
  g.wire('validate.invalid', 'fix.exec');
  g.wire('validate.issues', 'fixContext.issues');
  g.wire('fixContext.result', 'fix.context');
  g.wire('fix.review', 'review.exec');
  g.wire('fix.void', 'void.exec');
  g.wire('validate.valid', 'save.exec');
  g.wire('save.then', 'cycle.exec');
  g.wire('cycleInputs.object', 'cycle.inputs');
  g.wire('cycle.then', 'attach.exec');
  g.wire('cycle.runId', 'attach.cycleRunId');
  g.wire('attach.then', 'approved.exec');
  g.wire('patient.patient', 'approved.patient');

  g.wire('open.duplicate', 'noteRevision.exec');
  g.wire('noteRevision.then', 'revision.exec');
  g.wire('revisionContext.result', 'revision.context');
  g.wire('revision.acknowledge', 'revised.exec');
  g.wire(tripType, 'revised.tripType');
  return g.def;
};

const cycleClaim = (): GraphDef => {
  const g = graph(
    { execIn: ['exec'], execOut: [], inputs: [p('claimId', 'string')], outputs: [] },
    [{ name: 'active', type: 'boolean', default: true }]
  );
  const waitForClaim = (id: string, label: string) =>
    g.add(id, 'std.flow.wait-signal', { label, values: { name: CLAIM_SIGNAL } });
  const recordEvent = (id: string, kind: string, label: string) =>
    g.add(id, 'billing.record-claim-event', { label, values: { kind } });
  const closeClaim = (id: string, status: string, label: string) =>
    g.add(id, 'billing.close-claim', { label, values: { status } });
  g.add('active', 'std.var.get', { config: { name: 'active' } });
  g.add('loop', 'std.flow.while', { label: 'Until the Claim Closes' });
  g.add('step', 'billing.claim-step', {
    label: 'Next Step',
    values: { payerWaitDays: 30, statementCount: 3, statementIntervalDays: 30 }
  });
  waitForClaim('submit', 'Await 837P Batch');
  waitForClaim('awaitPayer', 'Await Payer Response');
  waitForClaim('awaitPatient', 'Await Patient Payment');
  g.add('payerSubject', 'std.expr', subject('reference', 'payer'));
  g.add('collectionsSubject', 'std.expr', subject('reference'));
  g.add('payerContext', 'std.object.make', {
    label: 'Payer Context',
    config: {
      fields: [
        { name: 'claimId', type: 'string' },
        { name: 'coverageId', type: 'string' },
        { name: 'payer', type: 'string' },
        { name: 'balanceCents', type: 'integer' }
      ]
    }
  });
  g.add('review', 'std.human.task', {
    label: 'Review Claim',
    config: {
      title: 'Review claim',
      queue: 'billing-review',
      instructions:
        'Check the claim before it goes to this payer: patient, member ID, service, charges, diagnoses and trip details. Correct anything on the claim page, then approve it to make it ready to submit.',
      outcomes: ['approve']
    }
  });
  recordEvent('approve', 'approved', 'Approve for Submission');
  g.add('reconcile', 'std.human.task', {
    label: 'Reconcile Payment',
    config: {
      title: 'Reconcile payment',
      queue: 'billing-reconcile',
      instructions:
        'The payer answered and a balance remains. Check what they paid and adjusted against the claim, record anything missing, then continue to the next payer or the patient, or write off the rest.',
      outcomes: ['continue', 'writeOff']
    }
  });
  recordEvent('reconciled', 'reconciled', 'Mark the Response Reconciled');
  g.add('followUp', 'std.human.task', {
    label: 'Follow Up with Payer',
    config: {
      title: 'Follow up on claim',
      queue: 'billing-followup',
      instructions:
        'The payer has not responded in time. Resubmit in the next 837P batch, keep waiting, or move on to the next payer.',
      outcomes: ['resubmit', 'keepWaiting', 'nextPayer']
    }
  });
  recordEvent('resubmit', 'resubmit_queued', 'Queue for the Next Batch');
  recordEvent('keepWaiting', 'follow_up', 'Keep Waiting on Payer');
  recordEvent('skip', 'payer_skipped', 'Move to Next Payer');
  g.add('statement', 'billing.issue-statement', { label: 'Send Patient Statement' });
  g.add('collectionsContext', 'std.object.make', {
    label: 'Collections Context',
    config: {
      fields: [
        { name: 'claimId', type: 'string' },
        { name: 'balanceCents', type: 'integer' }
      ]
    }
  });
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
  closeClaim('closeWrittenOff', 'written_off', 'Close as Written Off');
  closeClaim('closeCollections', 'collections', 'Close as Sent to Collections');
  closeClaim('closePaid', 'paid', 'Close as Paid');
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
  g.wire('entry.claimId', 'step.claimId');
  for (const wait of ['submit', 'awaitPayer', 'awaitPatient']) {
    g.wire('entry.claimId', `${wait}.key`);
    g.wire('step.waitMs', `${wait}.timeoutMs`);
    g.wire('step.signalsSeen', `${wait}.after`);
  }
  g.wire('step.submit', 'submit.exec');
  g.wire('step.await', 'awaitPayer.exec');
  g.wire('step.awaitPatient', 'awaitPatient.exec');
  g.wire('step.followUp', 'followUp.exec');
  g.wire('step.review', 'review.exec');
  g.wire('step.reconcile', 'reconcile.exec');
  g.wire('entry.claimId', 'payerContext.claimId', 'collectionsContext.claimId');
  g.wire('step.coverageId', 'payerContext.coverageId');
  g.wire('step.payer', 'payerContext.payer', 'payerSubject.payer');
  g.wire('step.balanceCents', 'payerContext.balanceCents', 'collectionsContext.balanceCents');
  g.wire('payerContext.object', 'followUp.context', 'review.context', 'reconcile.context');
  g.wire('step.reference', 'payerSubject.reference', 'collectionsSubject.reference');
  g.wire('payerSubject.result', 'followUp.subject', 'review.subject', 'reconcile.subject');
  g.wire('review.approve', 'approve.exec');
  g.wire('reconcile.continue', 'reconciled.exec');
  g.wire('reconcile.writeOff', 'closeWrittenOff.exec');
  for (const id of ['approve', 'reconciled']) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire('step.coverageId', `${id}.coverageId`);
  }
  for (const [outcome, id] of [
    ['resubmit', 'resubmit'],
    ['keepWaiting', 'keepWaiting'],
    ['nextPayer', 'skip']
  ] as const) {
    g.wire(`followUp.${outcome}`, `${id}.exec`);
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire('step.coverageId', `${id}.coverageId`);
  }
  g.wire('step.statement', 'statement.exec');
  g.wire('entry.claimId', 'statement.claimId');
  g.wire('step.statementNumber', 'statement.statementNumber');
  g.wire('step.collections', 'collections.exec');
  g.wire('collectionsContext.object', 'collections.context');
  g.wire('collectionsSubject.result', 'collections.subject');
  g.wire('collections.writeOff', 'closeWrittenOff.exec');
  g.wire('collections.sendToCollections', 'closeCollections.exec');
  g.wire('step.closed', 'closePaid.exec');
  for (const id of ['closeWrittenOff', 'closeCollections', 'closePaid']) {
    g.wire('entry.claimId', `${id}.claimId`);
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
    'Destination minus scene odometer in tenths of a mile, or nothing when either is missing.',
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
    'The service a scheduled or interfacility transport is billed for: never an emergency.',
    tripService({ emergency: false })
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
    'Turns a confirmed service into HCPCS lines: a base rate by trip type, level and emergency, plus A0425 mileage in tenths of a mile for transports.',
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
    'Maps the report insurances to coverages, or names Medicare or Medicaid from the payment method when there are none.',
    coveragesFromPcr()
  ),
  node(
    'billing.trip-details',
    'Trip Details',
    'Maps the report to the date of service, pickup, destination, diagnoses and origin/destination modifier.',
    tripDetails()
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
    'Maps a claim on its way to a payer onto an 837P claim: subscriber, payer, ambulance conditions, origin/destination modifiers and service lines.',
    map837p()
  ),
  node(
    'billing.resolve-patient',
    'Resolve Patient',
    'Matches report demographics to a patient, creates one when nothing is close, and asks a biller about likely matches.',
    resolvePatient()
  ),
  node(
    'billing.resolve-payers',
    'Resolve Payers',
    'Links report payers to the payer directory, asks a biller about uncertain names and remembers the answers.',
    resolvePayers()
  ),
  workflow(
    'billing.cycle-claim',
    'Cycle Claim',
    'Bills each payer in claim order with follow-ups, then sends patient statements before collections review. Sleeps until a claim change or a deadline.',
    cycleClaim()
  ),
  workflow(
    'billing.encounter-to-claim',
    'Encounter to Claim',
    'Turns one patient care report into a claim: opens a draft claim, classifies the trip, resolves the patient and payers, suggests the service for the trip type, has a biller confirm it, maps and prices the claim, saves it and starts its payer cycle. Reports already billed become revisions of their claim.',
    encounterToClaim()
  ),
  workflow(
    'billing.ingest-nemsis',
    'Ingest NEMSIS File',
    'Splits a NEMSIS export and starts one Encounter to Claim run per report, without waiting for them.',
    ingestNemsis()
  )
];
