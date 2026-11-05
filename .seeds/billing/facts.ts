import type { GraphDef } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import { ADDRESS_PINS, asRule, asStage, d, exit, P, rule, shared, stage, T } from './shared.ts';

const PCR_IN = P.pcr();

const tripFacts = (): GraphDef => {
  const g = rule([PCR_IN], [d('trip', T.trip, 'Trip Facts', 'The trip as the report records it.')]);
  g.add('pcr', 'nemsis.pcr.break');
  g.add('times', 'nemsis.times.break');
  g.add('response', 'nemsis.response.break');
  g.add('disposition', 'nemsis.disposition.break');
  g.add('payment', 'nemsis.payment.break');
  g.add('called', 'std.logic.coalesce', { label: 'Call Time, Else Dispatch Time' });
  g.add('when', 'std.logic.coalesce', { label: 'Or Nothing', values: { fallback: '' } });
  g.add('serviceDate', 'std.text.substring', { label: 'Date Part', values: { end: 10 } });
  g.add('trip', 'billing.trip-facts.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.times', 'times.times');
  g.wire('pcr.response', 'response.response');
  g.wire('pcr.disposition', 'disposition.disposition');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('pcr.pcrNumber', 'trip.pcrNumber');
  g.wire('times.psapCall', 'called.value', 'trip.calledAt');
  g.wire('times.unitNotified', 'called.fallback');
  g.wire('called.result', 'when.value');
  g.wire('when.result', 'serviceDate.text');
  g.wire('serviceDate.result', 'trip.serviceDate');
  for (const pin of ['serviceType', 'responseMode', 'sceneOdometer', 'destinationOdometer']) {
    g.wire(`response.${pin}`, `trip.${pin}`);
  }
  for (const pin of [
    'incidentDisposition',
    'unitDisposition',
    'patientEvaluation',
    'transportDisposition',
    'levelOfCare'
  ]) {
    g.wire(`disposition.${pin}`, `trip.${pin}`);
  }
  g.wire('payment.cmsServiceLevel', 'trip.cmsServiceLevel');
  g.wire('payment.alsAssessment', 'trip.alsAssessment');
  g.wire('trip.trip', 'return.trip');
  return g.def;
};

const locationFacts = (): GraphDef => {
  const g = rule(
    [PCR_IN],
    [d('locations', T.locations, 'Location Facts', 'Pickup and destination, and their kinds.')]
  );
  g.add('pcr', 'nemsis.pcr.break');
  g.add('scene', 'nemsis.scene.break');
  g.add('disposition', 'nemsis.disposition.break');
  g.add('pickup', 'billing.location.make', { label: 'Pickup' });
  g.add('destination', 'billing.location.make', { label: 'Destination' });
  g.add('firstReason', 'std.list.first', { label: 'Main Reason for the Destination' });
  g.add('locations', 'billing.location-facts.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.scene', 'scene.scene');
  g.wire('pcr.disposition', 'disposition.disposition');
  for (const pin of ADDRESS_PINS) {
    g.wire(`scene.${pin}`, `pickup.${pin}`);
    g.wire(`disposition.${pin}`, `destination.${pin}`);
  }
  g.wire('disposition.destinationName', 'destination.name');
  g.wire('pickup.location', 'locations.pickup');
  g.wire('destination.location', 'locations.destination');
  g.wire('scene.locationType', 'locations.pickupType');
  g.wire('disposition.destinationType', 'locations.destinationType');
  g.wire('disposition.destinationReasons', 'firstReason.list');
  g.wire('firstReason.item', 'locations.destinationReason');
  g.wire('locations.locations', 'return.locations');
  return g.def;
};

const clinicalFacts = (): GraphDef => {
  const g = rule(
    [PCR_IN],
    [
      d(
        'clinical',
        T.clinical,
        'Clinical Facts',
        'Impressions, coded medications and procedures, and the narrative.'
      )
    ]
  );
  g.add('pcr', 'nemsis.pcr.break');
  g.add('situation', 'nemsis.situation.break');
  g.add('medications', 'std.list.reshape', {
    label: 'Medications and Routes',
    config: {
      fields: [
        { name: 'medication', type: 'string', from: 'medication' },
        { name: 'route', type: 'string', from: 'route' }
      ]
    }
  });
  g.add('procedures', 'std.list.reshape', {
    label: 'Procedure Codes',
    config: { fields: [{ name: 'procedure', type: 'string', from: 'procedure' }] }
  });
  g.add('clinical', 'billing.clinical-facts.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.situation', 'situation.situation');
  g.wire('situation.primaryImpression', 'clinical.primaryImpression');
  g.wire('situation.secondaryImpressions', 'clinical.secondaryImpressions');
  g.wire('pcr.medications', 'medications.list');
  g.wire('pcr.procedures', 'procedures.list');
  g.wire('medications.list', 'clinical.medications');
  g.wire('procedures.list', 'clinical.procedures');
  g.wire('pcr.narrative', 'clinical.narrative');
  g.wire('clinical.clinical', 'return.clinical');
  return g.def;
};

const documentationFacts = (): GraphDef => {
  const g = rule(
    [PCR_IN],
    [
      d(
        'documentation',
        T.documentation,
        'Documentation',
        'Signature, certification, reported transport reason, conditions, prior authorization, weight and trip times.'
      )
    ]
  );
  g.add('pcr', 'nemsis.pcr.break');
  g.add('payment', 'nemsis.payment.break');
  g.add('times', 'nemsis.times.break');
  g.add('exam', 'nemsis.exam.break');
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
  g.add('documentation', 'billing.documentation.make');
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('pcr.times', 'times.times');
  g.wire('pcr.exam', 'exam.exam');
  g.wire('pcr.signatures', 'signature.signatures');
  g.wire('signature.signature', 'documentation.signature');
  g.wire('signature.signatureNote', 'documentation.signatureNote');
  g.wire('payment.certificationStatement', 'pcs.key');
  g.wire('pcs.value', 'documentation.pcsOnFile');
  g.wire('payment.certificationDate', 'pcsDate.value');
  g.wire('pcsDate.result', 'pcsSignedOn.text');
  g.wire('pcsSignedOn.result', 'documentation.pcsSignedOn');
  g.wire('payment.transportReason', 'documentation.transportReason');
  g.wire('payment.ambulanceConditions', 'documentation.conditionCodes');
  g.wire('payment.priorAuthorization', 'documentation.priorAuthorization');
  g.wire('exam.weightKg', 'documentation.weightKg');
  g.wire('times.arrivedOnScene', 'documentation.atScene');
  g.wire('times.leftScene', 'documentation.leftScene');
  g.wire('times.arrivedAtDestination', 'documentation.atDestination');
  g.wire('documentation.documentation', 'return.documentation');
  return g.def;
};

const demographicsFromPcr = (): GraphDef => {
  const g = rule(
    [PCR_IN],
    [
      d(
        'demographics',
        T.demographics,
        'Demographics',
        'The name, birth date, sex and address the patient is matched and created by.'
      )
    ]
  );
  g.add('pcr', 'nemsis.pcr.break');
  g.add('patient', 'nemsis.patient.break');
  g.add('sex', 'std.logic.coalesce', { label: 'Sex, Else Gender' });
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
  const g = rule(
    [PCR_IN],
    [
      d(
        'coverages',
        T.coverages,
        'Coverages',
        'The insurances the report lists, or the payer its payment method names.'
      )
    ]
  );
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
    config: shared.lookup(
      'billing.payment-method-payer',
      'Payer by Payment Method',
      'Names the payer a report means by its primary method of payment (ePayment.01) when it lists no insurance.',
      {
        type: 'string',
        rows: [
          { key: '2601005', value: 'Medicare' },
          { key: '2601003', value: 'Medicaid' }
        ]
      }
    )
  });
  g.add('fallback', 'billing.coverage.make', {
    label: 'Coverage From the Payment Method',
    values: { priority: '2611003' }
  });
  g.add('fallbackList', 'std.list.make', { label: 'As a List', config: { count: 1 } });
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

const FACTS_OUT = d(
  'facts',
  T.facts,
  'Encounter Facts',
  'The report as one normalized snapshot every later rule reads.'
);

const mapEncounterFacts = (): GraphDef => {
  const g = stage(
    [PCR_IN],
    [FACTS_OUT],
    Object.fromEntries([['then', exit('Mapped', 'The encounter facts are ready.')]])
  );
  g.add('pcr', 'nemsis.pcr.break');
  g.add('payment', 'nemsis.payment.break');
  g.add('trip', 'billing.trip-facts', { label: 'Trip Facts' });
  g.add('locations', 'billing.location-facts', { label: 'Location Facts' });
  g.add('patient', 'billing.demographics-from-pcr', { label: 'Patient Facts' });
  g.add('clinical', 'billing.clinical-facts', { label: 'Clinical Facts' });
  g.add('documentation', 'billing.documentation-facts', { label: 'Documentation Facts' });
  g.add('coverages', 'billing.coverages-from-pcr', { label: 'Reported Coverages' });
  g.add('facts', 'billing.encounter-facts.make');
  g.add('agency', 'billing.agency-facts', { label: 'Agency Facts' });
  g.ret('done');
  g.wire('entry.exec', 'done.exec');
  g.wire(
    'entry.pcr',
    'pcr.pcr',
    'trip.pcr',
    'locations.pcr',
    'patient.pcr',
    'clinical.pcr',
    'documentation.pcr',
    'coverages.pcr',
    'agency.pcr'
  );
  g.wire('pcr.payment', 'payment.payment');
  g.wire('trip.trip', 'facts.trip');
  g.wire('locations.locations', 'facts.locations');
  g.wire('patient.demographics', 'facts.patient');
  g.wire('clinical.clinical', 'facts.clinical');
  g.wire('documentation.documentation', 'facts.documentation');
  g.wire('coverages.coverages', 'facts.coverages');
  g.wire('payment.method', 'facts.paymentMethod');
  g.wire('facts.facts', 'agency.facts');
  g.wire('agency.facts', 'done.facts');
  return g.def;
};

export const factGraphs: SeedGraph[] = [
  slot(
    'billing.agency-facts',
    'Agency Facts',
    'An agency rule after the encounter facts are mapped: correct or add facts from the report (a local code, a facility the agency knows) before any billing rule reads them. Passes the facts through unchanged until an agency overrides it.',
    {
      execIn: [],
      execOut: [],
      inputs: [
        d('facts', T.facts, 'Encounter Facts', 'The facts the base rules mapped.'),
        P.pcr(true)
      ],
      outputs: [d('facts', T.facts, 'Encounter Facts', 'The facts every billing rule reads.')]
    }
  ),
  asRule(
    'billing.trip-facts',
    'Trip Facts',
    'Maps the report to the trip facts: PCR number, date of service, call time, type of service, response mode, dispositions, level of care, CMS service level, ALS assessment and odometers.',
    tripFacts()
  ),
  asRule(
    'billing.location-facts',
    'Location Facts',
    'Maps the report to the pickup and destination with their addresses, the incident location type, the destination type and the main reason for the destination.',
    locationFacts()
  ),
  asRule(
    'billing.clinical-facts',
    'Clinical Facts',
    'Maps the report to its impressions, coded medications with routes, coded procedures and the narrative.',
    clinicalFacts()
  ),
  asRule(
    'billing.documentation-facts',
    'Documentation Facts',
    'Maps what the report documents for billing: the release-for-billing signature, physician certification, the transport reason as reported, ambulance conditions, prior authorization, weight and trip times.',
    documentationFacts()
  ),
  asRule(
    'billing.demographics-from-pcr',
    'Demographics From PCR',
    'Maps the report patient to the demographics patients are matched and created by.',
    demographicsFromPcr()
  ),
  asRule(
    'billing.coverages-from-pcr',
    'Coverages From PCR',
    'Maps the report insurances to coverages with the insured and their relationship to the patient, or names Medicare or Medicaid from the payment method (Payer by Payment Method table) when there are none.',
    coveragesFromPcr()
  ),
  asStage(
    'billing.map-encounter-facts',
    'Map Encounter Facts',
    'Builds the Encounter Facts every billing rule reads, once per report: trip, locations, patient, clinical, documentation and the coverages as reported, then the Agency Facts rule.',
    mapEncounterFacts()
  )
];
