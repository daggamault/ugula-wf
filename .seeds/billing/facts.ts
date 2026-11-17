import type { GraphDef, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { thenExit } from './glossary.ts';
import {
  ADDRESS_PINS,
  asRule,
  asStage,
  type Builder,
  condition,
  d,
  exit,
  firstOf,
  fixed,
  getField,
  makeList,
  makeObject,
  orElse,
  P,
  type Port,
  rule,
  select,
  shared,
  stage,
  T,
  template
} from './shared.ts';

const PCR_IN = P.pcr();

const YES = '9922005';

const NO = '9922001';

const tripFacts = (): GraphDef => {
  const g = rule([PCR_IN], [d('trip', T.trip, 'Trip Facts', 'The trip as the report records it.')]);
  g.add('pcr', 'nemsis.pcr.break', { label: 'Report' });
  g.add('times', 'nemsis.times.break', { label: 'Times' });
  g.add('response', 'nemsis.response.break', { label: 'Response' });
  g.add('disposition', 'nemsis.disposition.break', { label: 'Disposition' });
  g.add('payment', 'nemsis.payment.break', { label: 'Payment' });
  g.add('arrest', 'nemsis.arrest.break', { label: 'Cardiac Arrest' });
  g.add('called', 'std.logic.coalesce', { label: 'Call Time, Else Dispatch Time' });
  g.add('when', 'std.logic.coalesce', { label: 'Call Time, Else Blank', values: { fallback: '' } });
  g.add('serviceDate', 'std.text.substring', { label: 'Date of Service', values: { end: 10 } });
  g.add('trip', 'billing.trip-facts.make', { label: 'Trip Facts' });
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.times', 'times.times');
  g.wire('pcr.response', 'response.response');
  g.wire('pcr.disposition', 'disposition.disposition');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('pcr.arrest', 'arrest.arrest');
  g.wire('arrest.outcome', 'trip.arrestOutcome');
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
  g.add('pcr', 'nemsis.pcr.break', { label: 'Report' });
  g.add('scene', 'nemsis.scene.break', { label: 'Scene' });
  g.add('disposition', 'nemsis.disposition.break', { label: 'Disposition' });
  g.add('pickup', 'billing.location.make', { label: 'Pickup' });
  g.add('destination', 'billing.location.make', { label: 'Destination' });
  g.add('firstReason', 'std.list.first', { label: 'Main Reason for the Destination' });
  g.add('locations', 'billing.location-facts.make', { label: 'Location Facts' });
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
  g.add('pcr', 'nemsis.pcr.break', { label: 'Report' });
  g.add('situation', 'nemsis.situation.break', { label: 'Situation' });
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
  g.add('clinical', 'billing.clinical-facts.make', { label: 'Clinical Facts' });
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

const TRANSPORT_ACCIDENTS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'];

const mspAccident = (g: Builder) =>
  firstOf(
    g,
    'msp',
    'MSP Accident Answer from the Report',
    'string',
    [
      {
        id: 'asWorkersComp',
        label: "Workers' Compensation When It Pays or the Injury Is Work Related",
        when: condition(
          g,
          'workersComp',
          "Workers' Compensation Pays or the Injury Is Work Related",
          {
            paymentMethod: ['string', 'payment.method'],
            workRelated: ['string', 'situation.workRelated']
          },
          [
            { field: 'paymentMethod', op: 'is', value: '2601013' },
            { field: 'workRelated', op: 'is', value: YES }
          ],
          'any'
        ),
        value: fixed('workersComp')
      },
      {
        id: 'asNoFault',
        label: 'No-Fault When a Transport Accident Caused the Injury',
        when: condition(
          g,
          'transportAccident',
          'A Transport Accident Caused the Injury',
          { injuryCauses: [{ list: 'string' }, 'injury.causes'] },
          [{ field: 'injuryCauses', op: 'startsWith', value: TRANSPORT_ACCIDENTS }]
        ),
        value: fixed('noFault')
      }
    ],
    fixed(null)
  );

const SIGNATURE = (T.pcr as { object: { signatures: { list: ValueType } } }).object.signatures.list;

const RELEASE: ValueType = { object: { signature: 'string', signatureNote: 'string' } };

const BILLING_RELEASE = '4513005';

const SIGNED = ['4515027', '4515031', '4515033'];

const REFUSED = ['4515019', '4515029'];

const COULD_NOT_SIGN = [
  { key: '4515003', value: 'the patient died' },
  { key: '4515005', value: 'the patient was in distress' },
  { key: '4515013', value: "the patient's mental status was impaired" },
  { key: '4515015', value: 'the patient is a minor' },
  { key: '4515017', value: "the patient's hands or arms were impaired" },
  { key: '4515023', value: 'the patient was unconscious' },
  { key: '4515025', value: 'the patient is visually impaired' },
  { key: '4515035', value: 'the patient cannot read' },
  { key: '4515037', value: 'the patient was restrained' },
  { key: '4515039', value: 'the patient was combative or uncooperative' }
];

const NOT_AN_EXCEPTION = [
  { key: '4515001', value: 'the crew was called out to another call' },
  { key: '4515007', value: 'of an equipment failure' },
  { key: '4515009', value: 'the patient was in law enforcement custody' },
  { key: '4515011', value: 'of a language barrier' },
  { key: '4515021', value: 'care was transferred before a signature could be obtained' }
];

const releaseSignature = (): GraphDef => {
  const g = rule(
    [
      d(
        'signature',
        SIGNATURE,
        'Signature',
        'One signature of the report given for the release for billing.'
      )
    ],
    [
      d(
        'release',
        RELEASE,
        'Release Signature',
        'Whether the signature counts as signed, an exception, refused or missing, with why.'
      )
    ]
  );
  g.add('parts', 'nemsis.signature.break', { label: 'Signature' });
  g.wire('entry.signature', 'parts.signature');
  const status: [ValueType, Port] = ['string', 'parts.status'];
  const signed = condition(g, 'signed', 'Signed', { status }, [
    { field: 'status', op: 'oneOf', value: SIGNED }
  ]);
  const representative = condition(
    g,
    'representative',
    'Signed by a Representative',
    { status, signer: ['string', 'parts.signer'] },
    [
      { field: 'status', op: 'is', value: '4515033' },
      { field: 'signer', op: 'is', value: '4512017' }
    ],
    'any'
  );
  const refused = condition(g, 'refused', 'Refused', { status }, [
    { field: 'status', op: 'oneOf', value: REFUSED }
  ]);
  g.add('couldNotSign', 'std.table.lookup', {
    label: 'Patient Could Not Sign',
    config: shared.lookup(
      'billing.signature-exceptions',
      'Signature Exceptions',
      'The signature statuses (eOther.15) that say why the patient could not sign, so the release counts as a signature exception, with the reason told to the biller.',
      { type: 'string', rows: COULD_NOT_SIGN }
    )
  });
  g.add('notAnException', 'std.table.lookup', {
    label: 'Not a Reason the Patient Could Not Sign',
    config: shared.lookup(
      'billing.signature-non-exceptions',
      'Not Signature Exceptions',
      'The signature statuses (eOther.15) that say why nobody signed without the patient being unable to, so the signature is still missing, with the reason told to the biller.',
      { type: 'string', rows: NOT_AN_EXCEPTION }
    )
  });
  g.wire('parts.status', 'couldNotSign.key', 'notAnException.key');
  const kind = firstOf(
    g,
    'kind',
    'Signed, Else Refused, Else an Exception, Else Missing',
    'string',
    [
      { id: 'isSigned', label: 'Name It Signed', when: signed, value: fixed('signed') },
      { id: 'isRefused', label: 'Name It Refused', when: refused, value: fixed('refused') },
      {
        id: 'isException',
        label: 'Name It an Exception',
        when: 'couldNotSign.found',
        value: fixed('exception')
      }
    ],
    fixed('missing')
  );
  g.add('note', 'std.logic.choose', {
    label: 'Signature Note',
    config: {
      mode: 'byCase',
      type: 'string',
      cases: [{ when: 'signed' }, { when: 'refused' }, { when: 'exception' }]
    },
    values: { case2: 'The patient refused to sign for billing' }
  });
  g.wire(kind, 'note.key');
  g.wire(
    select(
      g,
      'representativeNote',
      'Note a Representative',
      representative,
      fixed('Signed by a patient representative')
    ),
    'note.case1'
  );
  g.wire(
    template(g, 'exceptionNote', 'Why the Patient Could Not Sign', 'Not signed because {reason}', {
      reason: 'couldNotSign.value'
    }),
    'note.case3'
  );
  const other = template(
    g,
    'otherNote',
    'Why Nobody Signed',
    'Not signed because {reason}, which is not a reason the patient could not sign',
    { reason: 'notAnException.value' }
  );
  g.wire(
    select(
      g,
      'missingNote',
      'Why Nobody Signed, Else No Status',
      'notAnException.found',
      other,
      fixed('The billing signature has no status')
    ),
    'note.otherwise'
  );
  g.ret('return');
  g.wire(
    makeObject(g, 'release', 'Release Signature', {
      signature: ['string', kind],
      signatureNote: ['string', 'note.value']
    }),
    'return.release'
  );
  return g.def;
};

const RELEASE_KINDS = [
  ['signed', 'Signed Releases'],
  ['exception', 'Exceptions'],
  ['refused', 'Refusals'],
  ['missing', 'Missing Signatures']
] as const;

const billingSignature = (): GraphDef => {
  const g = rule(
    [
      d(
        'signatures',
        { list: SIGNATURE },
        'Signatures',
        'The signatures recorded on the patient care report.',
        true
      )
    ],
    [
      d(
        'signature',
        'string',
        'Signature',
        'Whether the release was signed, an exception, refused or missing.'
      ),
      d(
        'signatureNote',
        'string',
        'Signature Note',
        'Why the patient did not sign, or who signed for them.',
        true
      )
    ]
  );
  g.add('releases', 'std.list.where', {
    label: 'Signatures for the Release for Billing',
    config: { field: 'reasons', op: 'is', value: BILLING_RELEASE }
  });
  g.wire('entry.signatures', 'releases.list');
  g.add('each', 'std.list.map-rule', {
    label: 'Release Signature of Each',
    config: { rule: 'billing.release-signature', version: 1, item: 'signature' }
  });
  g.wire('releases.list', 'each.list');
  g.add('best', 'std.logic.choose', {
    label: 'Signed, Else an Exception, Else Refused, Else Missing',
    config: { mode: 'first', type: { list: RELEASE }, count: RELEASE_KINDS.length }
  });
  for (const [i, [kind, label]] of RELEASE_KINDS.entries()) {
    g.add(kind, 'std.list.where', {
      label,
      config: { field: 'signature', op: 'is', value: kind }
    });
    g.wire('each.release', `${kind}.list`);
    g.wire(`${kind}.list`, `best.option${i + 1}`);
  }
  g.add('first', 'std.list.first', { label: 'Best Release' });
  g.wire('best.value', 'first.list');
  const signature = getField(g, 'signature', 'Its Signature', RELEASE, 'signature', 'first.item');
  const note = getField(g, 'note', 'Its Note', RELEASE, 'signatureNote', 'first.item');
  const any = condition(
    g,
    'any',
    'Signed for the Release for Billing',
    { count: ['integer', 'releases.count'] },
    [{ field: 'count', op: 'gt', value: 0 }]
  );
  g.ret('return');
  g.wire(
    orElse(g, 'signatureOrMissing', 'Signature, Else Missing', signature, fixed('missing')),
    'return.signature'
  );
  g.wire(
    select(
      g,
      'noteOrNone',
      'Note, Else No Release Signature',
      any,
      note,
      fixed('The report has no signature for the release for billing')
    ),
    'return.signatureNote'
  );
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
        'Signature, certification, reported transport reason, conditions, prior authorization, weight, trip times, patients transported, the closest hospital and the MSP accident answer.'
      )
    ]
  );
  g.add('pcr', 'nemsis.pcr.break', { label: 'Report' });
  g.add('payment', 'nemsis.payment.break', { label: 'Payment' });
  g.add('times', 'nemsis.times.break', { label: 'Times' });
  g.add('exam', 'nemsis.exam.break', { label: 'Exam' });
  g.add('disposition', 'nemsis.disposition.break', { label: 'Disposition' });
  g.add('situation', 'nemsis.situation.break', { label: 'Situation' });
  g.add('injury', 'nemsis.injury.break', { label: 'Injury' });
  g.add('signature', 'billing.billing-signature', { label: 'Billing Signature' });
  const pcsAnswer: [ValueType, Port] = ['string', 'payment.certificationStatement'];
  const pcsYes = condition(g, 'pcsYes', 'Certification Answered Yes', { answer: pcsAnswer }, [
    { field: 'answer', op: 'is', value: YES }
  ]);
  const pcsAnswered = condition(
    g,
    'pcsAnswered',
    'Certification Answered Yes or No',
    { answer: pcsAnswer },
    [{ field: 'answer', op: 'oneOf', value: [YES, NO] }]
  );
  const pcs = select(g, 'pcs', 'Physician Certification on File', pcsAnswered, pcsYes);
  g.add('pcsDate', 'std.logic.coalesce', {
    label: 'Certification Date, Else Blank',
    values: { fallback: '' }
  });
  g.add('pcsSignedOn', 'std.text.substring', { label: 'Signed On', values: { end: 10 } });
  g.add('documentation', 'billing.documentation.make', { label: 'Documentation' });
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('pcr.times', 'times.times');
  g.wire('pcr.exam', 'exam.exam');
  g.wire('pcr.disposition', 'disposition.disposition');
  g.wire('pcr.situation', 'situation.situation');
  g.wire('pcr.injury', 'injury.injury');
  g.wire(mspAccident(g), 'documentation.mspAccident');
  g.wire('disposition.patientsTransported', 'documentation.patientCount');
  g.wire('payment.closestFacilityMiles', 'documentation.closestFacilityMiles');
  g.wire('pcr.signatures', 'signature.signatures');
  g.wire('signature.signature', 'documentation.signature');
  g.wire('signature.signatureNote', 'documentation.signatureNote');
  g.wire(pcs, 'documentation.pcsOnFile');
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
  g.add('pcr', 'nemsis.pcr.break', { label: 'Report' });
  g.add('patient', 'nemsis.patient.break', { label: 'Patient' });
  g.add('sex', 'std.logic.coalesce', { label: 'Sex, Else Gender' });
  g.add('demographics', 'billing.demographics.make', { label: 'Demographics' });
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
  g.add('pcr', 'nemsis.pcr.break', { label: 'Report' });
  g.add('payment', 'nemsis.payment.break', { label: 'Payment' });
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
    label: 'Coverage from the Payment Method',
    values: { priority: '2611003' }
  });
  const fallbackList = makeList(g, 'fallbackList', 'As a List', T.coverages.list, [
    'fallback.coverage'
  ]);
  const useMethod = condition(
    g,
    'useMethod',
    'No Insurances, but a Known Payment Method',
    {
      insurances: [{ list: { object: {} } }, 'pcr.insurances'],
      known: ['boolean', 'method.found']
    },
    [
      { field: 'insurances', op: 'empty' },
      { field: 'known', op: 'is', value: true }
    ]
  );
  const coverages = select(
    g,
    'coverages',
    'Payment Method Payer, Else the Insurances',
    useMethod,
    fallbackList,
    'insurances.list'
  );
  g.ret('return');
  g.wire('entry.pcr', 'pcr.pcr');
  g.wire('pcr.insurances', 'insurances.list');
  g.wire('pcr.payment', 'payment.payment');
  g.wire('payment.method', 'method.key');
  g.wire('method.value', 'fallback.payer');
  g.wire(coverages, 'return.coverages');
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
    thenExit(exit('Mapped', 'The encounter facts are ready.')),
    [{ name: 'destinationHospital', type: 'boolean', default: false }]
  );
  g.add('pcr', 'nemsis.pcr.break', { label: 'Report' });
  g.add('payment', 'nemsis.payment.break', { label: 'Payment' });
  g.add('trip', 'billing.trip-facts', { label: 'Trip Facts' });
  g.add('locations', 'billing.location-facts', { label: 'Location Facts' });
  g.add('patient', 'billing.demographics-from-pcr', { label: 'Demographics from PCR' });
  g.add('clinical', 'billing.clinical-facts', { label: 'Clinical Facts' });
  g.add('documentation', 'billing.documentation-facts', { label: 'Documentation Facts' });
  g.add('coverages', 'billing.coverages-from-pcr', { label: 'Reported Coverages' });
  g.add('places', 'billing.location-facts.break', { label: 'Pickup and Destination' });
  g.add('destination', 'billing.location.break', { label: 'Destination' });
  g.add('hospital', 'billing.find-hospital', { label: 'Find the Destination Hospital' });
  g.add('keepHospital', 'std.var.set', {
    label: 'Note the Destination Is a Hospital',
    config: { name: 'destinationHospital' },
    values: { value: true }
  });
  g.add('isHospital', 'std.var.get', {
    label: 'The Destination Is a Hospital',
    config: { name: 'destinationHospital' }
  });
  g.add('locationFacts', 'std.object.set-field', {
    label: 'Locations with the Hospital',
    config: { record: T.locations, path: 'destinationHospital' }
  });
  g.add('facts', 'billing.encounter-facts.make', { label: 'Encounter Facts' });
  g.ret('done');
  g.wire('entry.exec', 'hospital.exec');
  g.wire('hospital.found', 'keepHospital.exec');
  g.wire('hospital.notFound', 'done.exec');
  g.wire('keepHospital.then', 'done.exec');
  g.wire('locations.locations', 'places.locations', 'locationFacts.record');
  g.wire('places.destination', 'destination.location');
  g.wire('destination.name', 'hospital.name');
  g.wire('destination.state', 'hospital.state');
  g.wire('destination.postalCode', 'hospital.postalCode');
  g.wire('isHospital.value', 'locationFacts.value');
  g.wire(
    'entry.pcr',
    'pcr.pcr',
    'trip.pcr',
    'locations.pcr',
    'patient.pcr',
    'clinical.pcr',
    'documentation.pcr',
    'coverages.pcr'
  );
  g.wire('pcr.payment', 'payment.payment');
  g.wire('trip.trip', 'facts.trip');
  g.wire('locationFacts.record', 'facts.locations');
  g.wire('patient.demographics', 'facts.patient');
  g.wire('clinical.clinical', 'facts.clinical');
  g.wire('documentation.documentation', 'facts.documentation');
  g.wire('coverages.coverages', 'facts.coverages');
  g.wire('payment.method', 'facts.paymentMethod');
  g.wire('facts.facts', 'done.facts');
  return g.def;
};

export const factGraphs: SeedGraph[] = [
  asRule(
    'billing.trip-facts',
    'Trip Facts',
    'Maps the report to the trip facts: PCR number, date of service, call time, type of service, response mode, dispositions, level of care, cardiac arrest outcome, CMS service level, ALS assessment and odometers.',
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
    'billing.release-signature',
    'Release Signature',
    'Says whether one signature given for the release for billing counts as signed, an exception because the patient could not sign (Signature Exceptions table), refused or missing (Not Signature Exceptions table), and why.',
    releaseSignature()
  ),
  asRule(
    'billing.billing-signature',
    'Billing Signature',
    "Says whether the report's release for billing was signed by the patient or a representative, not signed because the patient could not sign (a CMS signature exception), refused or missing, with why: the best of its signatures for the release, signed first, then an exception, a refusal, and missing last.",
    billingSignature()
  ),
  asRule(
    'billing.documentation-facts',
    'Documentation Facts',
    'Maps what the report documents for billing: the release-for-billing signature, physician certification, the transport reason as reported, ambulance conditions, prior authorization, weight, trip times, patients transported, miles to the closest hospital, and the MSP accident answer: workers compensation when it pays or the injury is work related, else no-fault when a transport accident caused it.',
    documentationFacts()
  ),
  asRule(
    'billing.demographics-from-pcr',
    'Demographics from PCR',
    'Maps the report patient to the demographics patients are matched and created by.',
    demographicsFromPcr()
  ),
  asRule(
    'billing.coverages-from-pcr',
    'Coverages from PCR',
    'Maps the report insurances to coverages with the insured and their relationship to the patient, or names Medicare or Medicaid from the payment method (Payer by Payment Method table) when there are none.',
    coveragesFromPcr()
  ),
  asStage(
    'billing.map-encounter-facts',
    'Map Encounter Facts',
    'Builds the Encounter Facts every billing rule reads, once per report: trip, locations, patient, clinical, documentation and the coverages as reported.',
    mapEncounterFacts()
  )
];
