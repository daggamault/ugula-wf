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
        {
          label: 'Emergency response',
          when: { serviceType: oneOf('2205001', '2205003', '2205009') },
          set: { tripType: 'emergency' }
        },
        {
          label: 'Patient treated and transported by this unit',
          when: { incidentDisposition: oneOf('4212033') },
          set: { tripType: 'emergency' }
        },
        {
          label: 'Patient transported by this unit',
          when: { transportDisposition: oneOf('4230001', '4230003') },
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
  g.add('x837', 'x837.claim.make', { values: { placeOfService: '41', transportReason: 'A' } });
  g.ret('return');
  g.wire('entry.claim', 'claim.claim');
  g.wire('claim.payer', 'payer.payer');
  g.wire('claim.patient', 'patient.patient');
  g.wire('claim.details', 'details.details');
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
  suggested: service,
  warnings: concat(
    reason == null ? ['No disposition or type of service is recorded, so the trip was classified as an emergency transport'] : [],
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
      'Payer context',
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
  g.add('patch', 'billing.patch-claim', { label: 'Apply the Fixes' });
  g.add('charges', 'billing.map-charges', { label: 'Charges' });
  g.add('price', 'billing.price-charges', { label: 'Price Charges' });
  g.add('repriced', 'billing.patch-claim', { label: 'Save the Repriced Lines' });
  g.ret('fixedDone', 'fixed');
  g.ret('voidedDone', 'voided');
  g.ret('reviewDone', 'backToReview');
  g.wire('entry.exec', 'ask.exec');
  g.wire('entry.all', 'ask.value');
  g.wire('ask.then', 'validate.exec');
  g.wire('entry.claimId', 'validate.claimId', 'patch.claimId', 'repriced.claimId');
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
  g.wire('entry.subject', 'fix.subject', 'price.subject');
  g.wire('fix.save', 'stopAsking.exec');
  g.wire('stopAsking.then', 'patch.exec');
  for (const { name } of CLAIM_FIX_FIELDS) g.wire(`fix.${name}`, `patch.${name}`);
  g.wire('patch.patched', 'validate.exec');
  g.wire('patch.reprice', 'price.exec');
  g.wire('patch.tripType', 'charges.tripType');
  g.wire('patch.service', 'charges.service');
  g.wire('charges.lines', 'price.lines');
  g.wire('patch.payerId', 'price.payerId');
  g.wire('fixContext.result', 'price.context');
  g.wire('price.priced', 'repriced.exec');
  g.wire('price.lines', 'repriced.lines');
  g.wire('price.voided', 'voidedDone.exec');
  g.wire('repriced.patched', 'validate.exec');
  g.wire('repriced.reprice', 'validate.exec');
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
  trip: ${TRIP},
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

const encounterToClaim = (): GraphDef => {
  const g = graph(
    {
      execIn: ['exec'],
      execOut: [],
      inputs: [p('report', BLOB), p('claimId', 'string', true)],
      outputs: [
        p('tripType', 'string', true),
        p('patient', PATIENT, true),
        p('claimId', 'string', true)
      ]
    },
    [
      { name: 'tripType', type: 'string', default: null },
      { name: 'findings', type: FINDINGS, default: UNREAD_FINDINGS },
      { name: 'answers', type: { object: {} }, default: null },
      { name: 'previous', type: PCR_TYPE, default: null }
    ]
  );
  g.add('read', 'nemsis.read-report');
  g.add('pcr', 'nemsis.pcr.break');
  g.add('open', 'billing.open-claim', { label: 'Open Draft Claim' });
  g.add('classify', 'billing.classify-trip', { label: 'Classify Trip' });
  g.add('classified', 'std.var.set', {
    label: 'Classified Trip Type',
    config: { name: 'tripType' }
  });
  g.add('tripType', 'std.var.get', { label: 'Trip Type', config: { name: 'tripType' } });
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
        'This report looks like a cancelled call or a trip without patient contact, so no claim would be made. Skip it, or choose the trip type that was billed and make a claim if care was given.',
      fields: [{ ...TRIP_TYPE_FIELD, required: ['claim'] }],
      outcomes: ['skip', 'claim']
    }
  });
  g.add('claimed', 'std.var.set', { label: 'Confirmed Trip Type', config: { name: 'tripType' } });
  g.add('skip', 'billing.close-claim', {
    label: 'Void Skipped Claim',
    values: { status: 'void' }
  });
  g.ret('skipped');
  g.add('tryNarrative', 'std.flow.try', { label: 'Read the Narrative if the Model Is Up' });
  g.add('narrative', 'billing.read-narrative', {
    retry: { max: 3, delayMs: 30_000, factor: 4 }
  });
  g.add('keepFindings', 'std.var.set', {
    label: 'Narrative Findings',
    config: { name: 'findings' }
  });
  g.add('findings', 'std.var.get', { label: 'Findings', config: { name: 'findings' } });
  g.add('demographics', 'billing.demographics-from-pcr', { label: 'Patient Demographics' });
  g.add('patient', 'billing.resolve-patient', { label: 'Resolve Patient' });
  g.add('address', 'billing.update-patient-address', { label: 'Current Patient Address' });
  g.add('assign', 'billing.assign-patient', { label: 'Assign Patient to Claim' });
  g.add('reported', 'billing.coverages-from-pcr', { label: 'Reported Coverages' });
  g.add('patientName', 'std.text.template', {
    label: 'Patient Name',
    config: { template: '{{ demographics.firstName }} {{ demographics.lastName }}' }
  });
  g.add('payers', 'billing.resolve-payers', { label: 'Resolve Payers' });
  g.add('suggest', 'billing.suggest-service', { label: 'Suggest Service for the Trip Type' });
  g.add('reviewContext', 'std.expr', expr('Review Context', REVIEW_CONTEXT));
  g.add('answers', 'std.var.get', { label: 'Answers Given Before', config: { name: 'answers' } });
  g.add(
    'reviewDefaults',
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
  g.add('rememberHeld', 'std.var.set', {
    label: 'Remember the Answers',
    config: { name: 'answers' }
  });
  g.add('rememberApproved', 'std.var.set', {
    label: 'Remember the Approved Answers',
    config: { name: 'answers' }
  });
  g.add('reviewedTrip', 'std.var.set', {
    label: 'Reviewed Trip Type',
    config: { name: 'tripType' }
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
  g.add('fixContext', 'std.expr', expr('Claim Context', `{ trip: ${TRIP} }`));
  g.add('price', 'billing.price-charges', { label: 'Price Charges' });
  g.add('claim', 'billing.map-claim', { label: 'Map Claim' });
  g.add('save', 'billing.save-claim', { label: 'Save Draft Claim' });
  g.add('fix', 'billing.fix-claim', { label: 'Validate and Fix Claim', values: { all: false } });
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
  g.add('hasPrevious', 'std.logic.is-null', { label: 'No Earlier Report' });
  g.add('firstReport', 'std.flow.branch', { label: 'Compare With the Earlier Report?' });
  g.add('readPrevious', 'nemsis.read-report', { label: 'Read the Earlier Report' });
  g.add('keepPrevious', 'std.var.set', { label: 'Earlier Report', config: { name: 'previous' } });
  g.add('previous', 'std.var.get', { label: 'Earlier PCR', config: { name: 'previous' } });
  g.add('revisionContext', 'std.expr', expr('Revision Context', REVISION_CONTEXT));
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
  g.add('restartInputs', 'std.object.make', {
    config: {
      fields: [
        { name: 'report', type: BLOB },
        { name: 'claimId', type: 'string' }
      ]
    }
  });
  g.add('restart', 'std.flow.start-workflow', {
    label: 'Work the Claim From the New Report',
    config: { workflow: 'billing.encounter-to-claim', version: 1 }
  });
  g.add('voidRevised', 'billing.close-claim', {
    label: 'Void Revised Claim',
    values: { status: 'void' }
  });
  g.ret('revised');

  g.wire('entry.exec', 'read.exec');
  g.wire('entry.report', 'read.report', 'noteRevision.report', 'claim.report');
  g.wire('entry.report', 'restartInputs.report');
  g.wire('read.pcr', 'pcr.pcr');
  g.wire('read.then', 'open.exec');
  g.wire('pcr.pcrNumber', 'open.pcrNumber');
  g.wire('entry.report', 'open.report');
  g.wire('entry.claimId', 'open.claimId');
  g.wire('open.claimId', 'skip.claimId', 'skipped.claimId', 'assign.claimId', 'save.claimId');
  g.wire('open.claimId', 'void.claimId', 'voided.claimId', 'cycleInputs.claimId', 'attach.claimId');
  g.wire('open.claimId', 'approved.claimId', 'noteRevision.claimId', 'revisionContext.claimId');
  g.wire('open.claimId', 'revised.claimId', 'fix.claimId', 'restartInputs.claimId');
  g.wire('open.claimId', 'voidRevised.claimId');

  const pcr = 'read.pcr';
  g.wire(pcr, 'classify.pcr', 'tripContext.pcr', 'subject.pcr', 'demographics.pcr', 'reported.pcr');
  g.wire(pcr, 'suggest.pcr', 'reviewContext.pcr', 'holdContext.pcr', 'claim.pcr');
  g.wire(pcr, 'fixContext.pcr', 'revisionContext.pcr');
  const tripType = 'tripType.value';
  g.wire('classify.tripType', 'classified.value', 'tripSwitch.value');
  g.wire(tripType, 'tripContext.tripType', 'suggest.tripType', 'charges.tripType');
  g.wire(tripType, 'reviewContext.tripType', 'holdContext.tripType', 'fixContext.tripType');
  g.wire(tripType, 'revisionContext.tripType', 'skipped.tripType', 'approved.tripType');
  g.wire(tripType, 'reviewDefaults.tripType', 'claim.tripType');
  g.wire('classify.reason', 'tripContext.reason', 'reviewContext.reason', 'holdContext.reason');
  g.wire('classify.reason', 'fixContext.reason', 'revisionContext.reason');
  g.wire('subject.result', 'noClaim.subject', 'review.subject', 'held.subject');
  g.wire('subject.result', 'fix.subject', 'revision.subject', 'price.subject');

  g.wire('open.opened', 'classified.exec');
  g.wire('classified.then', 'tripSwitch.exec');
  g.wire('tripSwitch.noClaim', 'noClaim.exec');
  g.wire('tripContext.result', 'noClaim.context');
  g.wire('noClaim.skip', 'skip.exec');
  g.wire('skip.then', 'skipped.exec');
  g.wire('noClaim.claim', 'claimed.exec');
  g.wire('noClaim.tripType', 'claimed.value');
  g.wire('claimed.then', 'tryNarrative.exec');
  g.wire('tripSwitch.default', 'tryNarrative.exec');

  g.wire('tryNarrative.try', 'narrative.exec');
  g.wire('pcr.narrative', 'narrative.narrative');
  g.wire('narrative.then', 'keepFindings.exec');
  g.wire('narrative.findings', 'keepFindings.value');
  g.wire('tryNarrative.then', 'patient.exec');
  g.wire('tryNarrative.catch', 'patient.exec');
  g.wire('demographics.demographics', 'patient.demographics', 'patientName.demographics');
  g.wire('demographics.demographics', 'address.demographics');
  g.wire('pcr.pcrNumber', 'patient.pcrNumber', 'payers.pcrNumber');
  g.wire('patient.then', 'address.exec');
  g.wire('patient.patient', 'address.patient');
  g.wire('address.then', 'assign.exec');
  const patient = 'address.patient';
  g.wire(patient, 'assign.patient', 'reviewContext.patient', 'holdContext.patient');
  g.wire(patient, 'claim.patient', 'voided.patient', 'approved.patient');
  g.wire('assign.then', 'payers.exec');
  g.wire('reported.coverages', 'payers.coverages');
  g.wire('patientName.text', 'payers.patientName');
  g.wire('payers.then', 'suggest.exec');
  g.wire('payers.notes', 'reviewContext.payerNotes');
  g.wire('findings.value', 'suggest.findings', 'reviewContext.findings');
  g.wire('suggest.then', 'review.exec');
  g.wire('payers.coverages', 'reviewContext.coverages', 'primary.list', 'claim.coverages');
  g.wire('suggest.service', 'reviewContext.service', 'reviewDefaults.service', 'suggested.service');
  g.wire('answers.value', 'reviewDefaults.answers');
  g.wire('reviewDefaults.result', 'review.defaults');
  g.wire('reviewContext.result', 'review.context');
  for (const pin of ['tripType', 'level', 'emergency', 'loadedMiles', 'note']) {
    g.wire(`review.${pin}`, `given.${pin}`);
  }
  g.wire('given.object', 'rememberHeld.value', 'rememberApproved.value');

  g.wire('review.hold', 'rememberHeld.exec');
  g.wire('rememberHeld.then', 'held.exec');
  g.wire('review.note', 'holdContext.note');
  g.wire('holdContext.result', 'held.context');
  g.wire('held.release', 'review.exec');
  g.wire('held.void', 'void.exec');
  g.wire('void.then', 'voided.exec');

  g.wire('review.approve', 'rememberApproved.exec');
  g.wire('rememberApproved.then', 'reviewedTrip.exec');
  g.wire('review.tripType', 'reviewedTrip.value');
  g.wire('reviewedTrip.then', 'price.exec');
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
  g.wire('fixContext.result', 'price.context', 'fix.context');
  g.wire('price.voided', 'void.exec');
  g.wire('price.priced', 'save.exec');
  g.wire('price.lines', 'claim.lines');
  g.wire('price.totalCents', 'claim.totalCents');
  g.wire('claim.claim', 'save.claim');
  g.wire('save.then', 'fix.exec');
  g.wire('fix.voided', 'void.exec');
  g.wire('fix.backToReview', 'review.exec');
  g.wire('fix.fixed', 'cycle.exec');
  g.wire('cycleInputs.object', 'cycle.inputs');
  g.wire('cycle.then', 'attach.exec');
  g.wire('cycle.runId', 'attach.cycleRunId');
  g.wire('attach.then', 'approved.exec');

  g.wire('open.duplicate', 'noteRevision.exec');
  g.wire('noteRevision.restartable', 'firstReport.exec');
  g.wire('noteRevision.billed', 'firstReport.exec');
  g.wire('noteRevision.previous', 'hasPrevious.value', 'readPrevious.report');
  g.wire('noteRevision.status', 'revisionContext.status');
  g.wire('hasPrevious.result', 'firstReport.condition');
  g.wire('firstReport.true', 'revision.exec');
  g.wire('firstReport.false', 'readPrevious.exec');
  g.wire('readPrevious.then', 'keepPrevious.exec');
  g.wire('readPrevious.pcr', 'keepPrevious.value');
  g.wire('keepPrevious.then', 'revision.exec');
  g.wire('previous.value', 'revisionContext.previous');
  g.wire('revisionContext.result', 'revision.context', 'canApply.object');
  g.wire('revision.apply', 'applies.exec');
  g.wire('canApply.value', 'applies.condition');
  g.wire('applies.true', 'restart.exec');
  g.wire('applies.false', 'revision.exec');
  g.wire('restartInputs.object', 'restart.inputs');
  g.wire('restart.then', 'revised.exec');
  g.wire('revision.acknowledge', 'revised.exec');
  g.wire('revision.void', 'voidRevised.exec');
  g.wire('voidRevised.then', 'revised.exec');
  g.wire(tripType, 'revised.tripType');
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
  g.add('inputs', 'std.object.make', {
    config: {
      fields: [
        { name: 'report', type: BLOB },
        { name: 'claimId', type: 'string' }
      ]
    }
  });
  g.add('restart', 'std.flow.start-workflow', {
    label: 'Work the Claim Again',
    config: { workflow: 'billing.encounter-to-claim', version: 1 }
  });
  g.add('void', 'billing.close-claim', {
    label: 'Void Orphaned Draft',
    values: { status: 'void' }
  });
  g.ret('done');
  g.wire('entry.exec', 'orphan.exec');
  g.wire('entry.claimId', 'context.claimId', 'inputs.claimId', 'void.claimId');
  g.wire('entry.reason', 'context.reason');
  g.wire('entry.report', 'inputs.report');
  g.wire('context.object', 'orphan.context');
  g.wire('orphan.restart', 'restart.exec');
  g.wire('inputs.object', 'restart.inputs');
  g.wire('restart.then', 'done.exec');
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

const PATIENT_ADDRESS_FIELDS = ['AddressLine', 'City', 'State', 'PostalCode'].map((part) => ({
  name: `patient${part}`,
  type: 'string',
  label: `Patient ${part === 'AddressLine' ? 'street address' : part === 'PostalCode' ? 'ZIP code' : part.toLowerCase()}`,
  required: ['save']
}));

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
  const task = (id: string, label: string, config: Record<string, Json>) =>
    g.add(id, 'std.human.task', { label, config });
  g.add('active', 'std.var.get', { config: { name: 'active' } });
  g.add('loop', 'std.flow.while', { label: 'Until the Claim Closes' });
  g.add('step', 'billing.claim-step', {
    label: 'Next Step',
    values: { payerWaitDays: 30, submitWaitDays: 3, statementCount: 3, statementIntervalDays: 30 }
  });
  waitForClaim('submit', 'Await Submission');
  waitForClaim('awaitPayer', 'Await Payer Response');
  waitForClaim('awaitPatient', 'Await Patient Payment');
  g.add('payerSubject', 'std.expr', subject('reference', 'payer'));
  g.add('claimSubject', 'std.expr', subject('reference'));
  g.add('claimContext', 'std.expr', expr('Claim Context', CLAIM_CONTEXT));
  g.add('fix', 'billing.fix-claim', { label: 'Fix Claim Data', values: { all: false } });
  g.add('fixData', 'billing.fix-claim', {
    label: 'Fix Claim Data on Request',
    values: { all: true }
  });
  task('review', 'Review Claim', {
    title: 'Review claim',
    queue: 'billing-review',
    instructions:
      'Check the claim before it goes to this payer, or before the patient is billed when no payer is left: patient, member ID, service, charges, diagnoses and trip details, with any warnings. Approve it to make it ready, fix its data, skip this payer, or void the claim.',
    outcomes: ['approve', 'fixData', 'skipPayer', 'void']
  });
  recordEvent('approve', 'approved', 'Approve');
  recordEvent('skip', 'payer_skipped', 'Move to Next Payer');
  task('confirmPayers', 'Confirm Payers', {
    title: 'Confirm payers',
    queue: 'billing-review',
    instructions:
      'The report named no payer the claim can be billed to. Add the payer from the directory with the member ID, or confirm the patient pays themselves.',
    fields: CLAIM_FIX_FIELDS.filter((f) =>
      ['payerId', 'memberId', 'relationship', 'insuredFirstName', 'insuredLastName'].includes(
        f.name
      )
    ).map((f) =>
      f.name === 'payerId' || f.name === 'memberId' ? { ...f, required: ['save'] } : f
    ),
    outcomes: ['save', 'selfPay']
  });
  g.add('payerChoices', 'billing.validate-claim', {
    label: 'Directory Choices',
    values: { all: true }
  });
  g.add('directory', 'std.object.pick', {
    label: 'Directory Payers',
    values: { keys: ['payerId'] }
  });
  g.add('addPayer', 'billing.patch-claim', { label: 'Add the Payer' });
  g.add('recharge', 'billing.map-charges', { label: 'Charges' });
  g.add('reprice', 'billing.price-charges', { label: 'Price for the New Payer' });
  g.add('relines', 'billing.patch-claim', { label: 'Save the Repriced Lines' });
  recordEvent('selfPay', 'approved', 'Bill the Patient');
  task('submitDue', 'Submit Claim', {
    title: 'Submit claim',
    queue: 'billing-review',
    instructions:
      'This claim was approved but has not gone out. Submit it from its claim page, or mark it submitted when it went out another way. Fix its data or skip this payer if it cannot be submitted.',
    outcomes: ['submitted', 'fixData', 'skipPayer']
  });
  recordEvent('submitted', 'submitted', 'Submitted Outside the App');
  task('reconcile', 'Reconcile Payment', {
    title: 'Reconcile payment',
    queue: 'billing-reconcile',
    instructions:
      'The payer answered and a balance remains. Check what they paid and adjusted, with their reason codes, against the claim, and record anything missing. Continue to the next payer or the patient, write off the rest, or correct the claim and resubmit it to this payer as a replacement of their claim.',
    outcomes: ['continue', 'writeOff', 'resubmitCorrected']
  });
  recordEvent('reconciled', 'reconciled', 'Mark the Response Reconciled');
  recordEvent('correct', 'resubmit_queued', 'Resubmit as a Corrected Claim');
  task('overpaid', 'Refund Overpayment', {
    title: 'Refund overpayment',
    queue: 'billing-reconcile',
    instructions:
      'More has been paid than the claim charges. Refund the difference and record the refund on the claim page, or keep the credit and close the claim as paid.',
    outcomes: ['refunded', 'keepCredit']
  });
  task('followUp', 'Follow Up with Payer', {
    title: 'Follow up on claim',
    queue: 'billing-followup',
    instructions:
      'The payer has not responded in time. Resubmit in the next 837P batch, keep waiting, or move on to the next payer. When the payer has the claim on file, enter its claim number so the resubmission replaces it.',
    fields: [{ name: 'payerClaimNumber', type: 'string', label: 'Payer claim number' }],
    outcomes: ['resubmit', 'keepWaiting', 'nextPayer']
  });
  recordEvent('resubmit', 'resubmit_queued', 'Queue for the Next Batch');
  recordEvent('keepWaiting', 'follow_up', 'Keep Waiting on Payer');
  recordEvent('followUpSkip', 'payer_skipped', 'Move On From the Payer');
  g.add('statement', 'billing.issue-statement', { label: 'Send Patient Statement' });
  g.add('missing', 'std.flow.switch', {
    label: 'What the Statement Needs',
    config: { cases: ['profile', 'patientAddress'] }
  });
  task('profileNeeded', 'Billing Profile Needed', {
    title: 'Billing profile needed',
    queue: 'billing-review',
    instructions:
      "Patient statements carry the agency's name, address, phone and time zone from the billing profile, and there is none. Add it in Settings, then continue.",
    outcomes: ['continue']
  });
  task('addressNeeded', 'Patient Address Needed', {
    title: 'Patient address needed',
    queue: 'billing-review',
    instructions:
      "The patient's mailing address is incomplete, so a statement cannot be sent. Enter it and save, or write off the balance.",
    fields: PATIENT_ADDRESS_FIELDS,
    outcomes: ['save', 'writeOff']
  });
  g.add('addAddress', 'billing.patch-claim', { label: 'Save the Patient Address' });
  task('collections', 'Collections Review', {
    title: 'Review unpaid balance',
    queue: 'billing-collections',
    instructions:
      'Every payer and patient statement is done and a balance remains. Write it off or send it to collections. If it has been paid in the meantime, either choice closes it as paid.',
    outcomes: ['writeOff', 'sendToCollections']
  });
  closeClaim('closeWrittenOff', 'written_off', 'Close as Written Off');
  closeClaim('closeCollections', 'collections', 'Close as Sent to Collections');
  closeClaim('closePaid', 'paid', 'Close as Paid');
  closeClaim('closeVoid', 'void', 'Close as Void');
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
  g.wire('entry.claimId', 'step.claimId', 'claimContext.claimId');
  for (const wait of ['submit', 'awaitPayer', 'awaitPatient']) {
    g.wire('entry.claimId', `${wait}.key`);
    g.wire('step.waitMs', `${wait}.timeoutMs`);
    g.wire('step.signalsSeen', `${wait}.after`);
  }
  g.wire('step.submit', 'submit.exec');
  g.wire('step.await', 'awaitPayer.exec');
  g.wire('step.awaitPatient', 'awaitPatient.exec');
  g.wire('step.coverageId', 'claimContext.coverageId');
  g.wire('step.payer', 'claimContext.payer', 'payerSubject.payer');
  g.wire('step.balanceCents', 'claimContext.balanceCents');
  g.wire('step.issues', 'claimContext.issues');
  g.wire('step.claim', 'claimContext.claim');
  g.wire('step.reference', 'payerSubject.reference', 'claimSubject.reference');
  const context = 'claimContext.result';
  g.wire(context, 'review.context', 'confirmPayers.context', 'submitDue.context');
  g.wire(context, 'reconcile.context', 'overpaid.context', 'followUp.context');
  g.wire(context, 'profileNeeded.context', 'addressNeeded.context', 'collections.context');
  g.wire(context, 'fix.context', 'fixData.context');
  const payerSubject = 'payerSubject.result';
  g.wire(payerSubject, 'review.subject', 'submitDue.subject', 'reconcile.subject');
  g.wire(payerSubject, 'followUp.subject', 'fix.subject', 'fixData.subject');
  const claimSubject = 'claimSubject.result';
  g.wire(claimSubject, 'confirmPayers.subject', 'overpaid.subject', 'profileNeeded.subject');
  g.wire(claimSubject, 'addressNeeded.subject', 'collections.subject');
  for (const id of [
    'fix',
    'fixData',
    'payerChoices',
    'addPayer',
    'relines',
    'addAddress',
    'statement'
  ]) {
    g.wire('entry.claimId', `${id}.claimId`);
  }

  g.wire('step.fix', 'fix.exec');
  for (const id of ['fix', 'fixData']) {
    g.wire(`${id}.voided`, 'closeVoid.exec');
  }

  g.wire('step.review', 'review.exec');
  g.wire('step.reviewPatient', 'review.exec');
  g.wire('review.approve', 'approve.exec');
  g.wire('review.fixData', 'fixData.exec');
  g.wire('review.skipPayer', 'skip.exec');
  g.wire('review.void', 'closeVoid.exec');

  g.wire('step.confirmPayers', 'payerChoices.exec');
  g.wire('payerChoices.valid', 'confirmPayers.exec');
  g.wire('payerChoices.invalid', 'confirmPayers.exec');
  g.wire('payerChoices.options', 'directory.object');
  g.wire('directory.object', 'confirmPayers.options');
  g.wire('confirmPayers.save', 'addPayer.exec');
  for (const pin of [
    'payerId',
    'memberId',
    'relationship',
    'insuredFirstName',
    'insuredLastName'
  ]) {
    g.wire(`confirmPayers.${pin}`, `addPayer.${pin}`);
  }
  g.wire('confirmPayers.selfPay', 'selfPay.exec');
  g.wire('addPayer.reprice', 'reprice.exec');
  g.wire('addPayer.tripType', 'recharge.tripType');
  g.wire('addPayer.service', 'recharge.service');
  g.wire('addPayer.payerId', 'reprice.payerId');
  g.wire('recharge.lines', 'reprice.lines');
  g.wire(claimSubject, 'reprice.subject');
  g.wire(context, 'reprice.context');
  g.wire('reprice.priced', 'relines.exec');
  g.wire('reprice.lines', 'relines.lines');
  g.wire('reprice.voided', 'closeVoid.exec');

  g.wire('step.submitDue', 'submitDue.exec');
  g.wire('submitDue.submitted', 'submitted.exec');
  g.wire('submitDue.fixData', 'fixData.exec');
  g.wire('submitDue.skipPayer', 'skip.exec');

  g.wire('step.reconcile', 'reconcile.exec');
  g.wire('reconcile.continue', 'reconciled.exec');
  g.wire('reconcile.writeOff', 'closeWrittenOff.exec');
  g.wire('reconcile.resubmitCorrected', 'correct.exec');
  g.wire('step.overpaid', 'overpaid.exec');
  g.wire('overpaid.keepCredit', 'closePaid.exec');

  for (const id of ['approve', 'skip', 'submitted', 'reconciled', 'correct', 'selfPay']) {
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire('step.coverageId', `${id}.coverageId`);
  }
  g.wire('step.followUp', 'followUp.exec');
  for (const [outcome, id] of [
    ['resubmit', 'resubmit'],
    ['keepWaiting', 'keepWaiting'],
    ['nextPayer', 'followUpSkip']
  ] as const) {
    g.wire(`followUp.${outcome}`, `${id}.exec`);
    g.wire('entry.claimId', `${id}.claimId`);
    g.wire('step.coverageId', `${id}.coverageId`);
    g.wire('followUp.payerClaimNumber', `${id}.payerClaimNumber`);
  }

  g.wire('step.statement', 'statement.exec');
  g.wire('step.statementNumber', 'statement.statementNumber');
  g.wire('step.statementCount', 'statement.statementCount');
  g.wire('statement.missing', 'missing.exec');
  g.wire('statement.need', 'missing.value');
  g.wire('missing.profile', 'profileNeeded.exec');
  g.wire('missing.patientAddress', 'addressNeeded.exec');
  g.wire('addressNeeded.save', 'addAddress.exec');
  for (const { name } of PATIENT_ADDRESS_FIELDS)
    g.wire(`addressNeeded.${name}`, `addAddress.${name}`);
  g.wire('addressNeeded.writeOff', 'closeWrittenOff.exec');

  g.wire('step.collections', 'collections.exec');
  g.wire('collections.writeOff', 'closeWrittenOff.exec');
  g.wire('collections.sendToCollections', 'closeCollections.exec');
  g.wire('step.closed', 'closePaid.exec');
  for (const id of ['closeWrittenOff', 'closeCollections', 'closePaid', 'closeVoid']) {
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
  workflow(
    'billing.cycle-claim',
    'Cycle Claim',
    'Bills each payer in claim order: fixes what blocks the claim, has it reviewed, asks for it to be submitted when it sits ready, follows up, reconciles responses (or resubmits a corrected claim), confirms payers when there are none, reviews before the first patient statement and asks for a missing billing profile or patient address, then sends statements before collections review. Sleeps until a claim change or a deadline.',
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
    'billing.ingest-nemsis',
    'Ingest NEMSIS File',
    'Splits a NEMSIS export and starts one Encounter to Claim run per report, without waiting for them.',
    ingestNemsis()
  )
];
