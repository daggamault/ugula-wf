import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
  anyOf,
  asRule,
  type Builder,
  breakRecord,
  CODE,
  type Criterion,
  code,
  codes,
  d,
  ENCOUNTER,
  fixed,
  greaterThan,
  isCode,
  isIn,
  isMissing,
  keepWhere,
  listOf,
  n,
  node,
  not,
  orZero,
  PAYMENT,
  type Port,
  reasonsOf,
  rule,
  SIGNATURE,
  startsWith,
  T,
  TRANSPORT_KINDS
} from './shared.ts';

const SIGNATURE_STATUS = 'signatureStatus';

const SIGNATURE_REASON = 'signatureReason';

const RELEASE_FOR_BILLING = '4513005';

const SIGNER = 'signerType';

const SIGNED = ['4515027', '4515031', '4515033'];

const UNABLE = ['4515003', '4515005', '4515013', '4515017', '4515023', '4515037', '4515039'];

const HEALTHCARE_PROVIDER = '4512005';

const CERTIFIED = '9922005';

const PCS_DAYS = 60;

const WARNING_DAYS = 90;

const FILING_DAYS = 365;

const ROUTINE_SERVICE = '2205007';

const DIALYSIS_PREFIXES = ['N186', 'N18.6', 'Z992', 'Z99.2'];

const DIALYSIS_PLACES = ['J', 'G'];

const PCS_WORDS = [
  'PCS',
  'physician certification',
  'physician certification statement',
  'certificate of medical necessity',
  'CMN',
  'medical necessity'
];

type SignatureTest = {
  description: string;
  label: string;
  note: string;
  signatureReason?: string;
  signer?: string;
  statuses: readonly string[];
  statusLabel: string;
  statusNote: string;
};

const signatureRule = (t: SignatureTest): GraphDef => {
  const g = rule(
    [d('signature', T.signature, 'Signature', 'One signature collected or attempted.')],
    [d('result', 'boolean', 'Result', t.description)]
  );
  breakRecord(
    g,
    'signature',
    n('Signature', 'Who signed, why and its status.'),
    SIGNATURE,
    'entry.signature'
  );
  const tests: Port[] = [
    isIn(
      g,
      'status',
      n(t.statusLabel, 'The signature status, NEMSIS eOther.15.'),
      SIGNATURE_STATUS,
      'signature.status',
      codes(
        g,
        'statuses',
        n(`${t.statusLabel} Statuses`, t.statusNote),
        SIGNATURE_STATUS,
        t.statuses
      )
    )
  ];
  if (t.signatureReason) {
    node(
      g,
      'forBilling',
      'std.list.contains',
      n('Release for Billing', 'Why it was signed, NEMSIS eOther.13.'),
      { list: 'signature.reasons', item: fixed(t.signatureReason) },
      { type: code(SIGNATURE_REASON) }
    );
    tests.push('forBilling.result');
  }
  if (t.signer) {
    tests.push(
      isCode(
        g,
        'signer',
        n('Signed by a Healthcare Provider', 'Who signed, NEMSIS eOther.12.'),
        SIGNER,
        'signature.signer',
        t.signer
      )
    );
  }
  g.ret('return');
  g.wire(allOf(g, 'result', n(t.label, t.note), tests), 'return.result');
  return g.def;
};

const keepSignatures = (g: Builder, id: string, label: string, note: string, ruleKey: string) =>
  keepWhere(g, id, n(label, note), ruleKey, 'signature', 'trip.signatures');

const anyKept = (g: Builder, id: string, label: string, kept: string) =>
  greaterThan(g, id, n(label, 'At least one.'), 'integer', `${kept}.count`, 0);

const daysBetween = (g: Builder, id: string, label: string, start: Port, end: Port) => {
  node(
    g,
    id,
    'std.time.difference',
    n(label, 'Nothing when a date is missing.'),
    { start, end },
    { unit: 'days' }
  );
  return orZero(
    g,
    `${id}OrZero`,
    n(`${label} or 0`, 'A missing date counts as 0 days.'),
    `${id}.amount`
  );
};

const dialysisDiagnosis = (): GraphDef => {
  const g = rule(
    [d('diagnosis', code('icd10'), 'Diagnosis', 'One diagnosis, as an ICD-10 code.')],
    [
      d(
        'result',
        'boolean',
        'Result',
        'Whether the diagnosis is end-stage renal disease or dialysis.'
      )
    ]
  );
  g.ret('return');
  g.wire(
    anyOf(
      g,
      'dialysis',
      n(
        'Dialysis Diagnosis',
        'End-stage renal disease or dependence on dialysis, with any later characters.'
      ),
      DIALYSIS_PREFIXES.map((prefix, i) =>
        startsWith(
          g,
          `prefix${i + 1}`,
          n(`Starts With ${prefix}`, 'Written with or without the dot.'),
          'entry.diagnosis',
          prefix
        )
      )
    ),
    'return.result'
  );
  return g.def;
};

const claimChecks = (): GraphDef => {
  const g = rule(
    [
      d('encounter', T.encounter, 'Encounter', 'The encounter billed.'),
      d('classification', CODE.classification, 'Classification', 'What kind of trip it was.'),
      d('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
      d('serviceDate', 'string', 'Service Date', 'The date of service.', true),
      d('diagnoses', listOf(code('icd10')), 'Diagnoses', 'The diagnoses of the claim.'),
      d('originCode', CODE.place, 'Origin', 'The origin letter of the claim.', true),
      d('destinationCode', CODE.place, 'Destination', 'The destination letter of the claim.', true)
    ],
    [
      d(
        'reasons',
        listOf('string'),
        'Reasons',
        'What a biller should fix or confirm before the claim goes out.'
      )
    ]
  );
  breakRecord(
    g,
    'trip',
    n('Encounter', 'Signatures, attachments and the service type.'),
    ENCOUNTER,
    'entry.encounter'
  );
  breakRecord(
    g,
    'payment',
    n('Payment', 'Certification and prior authorization.'),
    PAYMENT,
    'trip.payment'
  );
  keepSignatures(
    g,
    'releases',
    'Signed Releases for Billing',
    'Each signed release for billing.',
    'billing.signed-release'
  );
  keepSignatures(
    g,
    'unable',
    'Patient Unable to Sign',
    'Each release the patient could not sign.',
    'billing.unable-to-sign'
  );
  keepSignatures(
    g,
    'facility',
    'Facility Signatures',
    'Each signature by a healthcare provider.',
    'billing.facility-signature'
  );
  const noRelease = not(
    g,
    'noRelease',
    n('No Signed Release', 'Nobody signed the release for billing.'),
    anyKept(g, 'anySigned', 'Some Release Signed', 'releases')
  );
  const unable = anyKept(g, 'anyUnable', 'Patient Unable to Sign', 'unable');
  const nonEmergencyTransport = allOf(
    g,
    'nonEmergency',
    n('Non-Emergency Transport', 'A transport that was not an emergency.'),
    [
      isIn(
        g,
        'transported',
        n('Transported', 'Only transports need a PCS.'),
        'tripClassification',
        'entry.classification',
        codes(
          g,
          'transports',
          n('Kinds of Transport', 'Emergency and scheduled.'),
          'tripClassification',
          TRANSPORT_KINDS
        )
      ),
      not(
        g,
        'notEmergency',
        n('Not an Emergency', 'A PCS is never needed for an emergency.'),
        'entry.emergency'
      )
    ]
  );
  const routine = isCode(
    g,
    'routine',
    n(
      'Routine Scheduled Service',
      'Other routine medical transport, NEMSIS eResponse.05: repetitive trips.'
    ),
    'serviceType',
    'trip.serviceType',
    ROUTINE_SERVICE
  );
  const fromHomeUnscheduled = allOf(
    g,
    'fromHomeUnscheduled',
    n('Unscheduled From a Residence', 'Medicare needs no PCS for an unscheduled trip from home.'),
    [
      isCode(
        g,
        'fromHome',
        n('From a Residence', 'Origin R.'),
        'placeCode',
        'entry.originCode',
        'R'
      ),
      not(g, 'unscheduled', n('Not Routine', 'Not a scheduled routine service.'), routine)
    ]
  );
  const pcsNeeded = allOf(
    g,
    'pcsNeeded',
    n('PCS Needed', 'Non-emergency, except unscheduled from a residence.'),
    [
      nonEmergencyTransport,
      not(
        g,
        'notFromHome',
        n('Not Unscheduled From Home', 'Facility and scheduled trips need a PCS.'),
        fromHomeUnscheduled
      )
    ]
  );
  const certified = isCode(
    g,
    'certified',
    n('Physician Certification Reported', 'NEMSIS ePayment.02.'),
    'yesNoUnknown',
    'payment.certification',
    CERTIFIED
  );
  node(
    g,
    'fileNames',
    'std.list.pluck',
    n('Attachment Names', 'The name of each file attached, NEMSIS eOther.22.'),
    {
      list: 'trip.attachments',
      field: fixed('name')
    }
  );
  node(g, 'fileText', 'std.text.join', n('Attachment Names as Text', 'Searched together.'), {
    items: 'fileNames.list',
    separator: fixed('. ')
  });
  node(
    g,
    'pcsWords',
    'std.value',
    n('Words for a PCS', 'What an attached PCS is usually called.'),
    {},
    { type: listOf('string'), value: PCS_WORDS }
  );
  node(
    g,
    'pcsFile',
    'std.text.find-phrases',
    n('PCS Attached', 'An attached file named as a PCS.'),
    {
      text: 'fileText.text',
      phrases: 'pcsWords.value'
    }
  );
  const pcsOnFile = anyOf(g, 'pcsOnFile', n('PCS on File', 'Reported, or attached.'), [
    certified,
    'pcsFile.found'
  ]);
  node(g, 'today', 'std.time.now', n('Today', 'For the timely filing checks.'));
  const daysSince = daysBetween(g, 'age', 'Days Since Service', 'entry.serviceDate', 'today.now');
  const dialysis = anyOf(
    g,
    'dialysisTrip',
    n('Dialysis Trip', 'A dialysis diagnosis or a dialysis destination.'),
    [
      greaterThan(
        g,
        'onDialysis',
        n('A Dialysis Diagnosis', 'Counted per diagnosis.'),
        'integer',
        `${keepWhere(g, 'dialysis', n('Dialysis Diagnoses', 'Each dialysis diagnosis.'), 'billing.dialysis-diagnosis', 'diagnosis', 'entry.diagnoses')}.count`,
        0
      ),
      isIn(
        g,
        'toDialysis',
        n('To a Dialysis Facility', 'Destination J or G.'),
        'placeCode',
        'entry.destinationCode',
        codes(
          g,
          'dialysisPlaces',
          n('Dialysis Destinations', 'Freestanding (J) and hospital-based (G).'),
          'placeCode',
          DIALYSIS_PLACES
        )
      )
    ]
  );
  const criteria: Criterion[] = [
    {
      id: 'unsigned',
      label: 'No Signed Release for Billing',
      reason:
        'No signed release for billing: get the patient or a representative to sign (42 CFR 424.36)',
      holds: allOf(
        g,
        'unsigned',
        n('No Signed Release, and the Patient Could Sign', 'A signature is needed.'),
        [
          noRelease,
          not(g, 'couldSign', n('Patient Could Sign', 'No reason the patient could not.'), unable)
        ]
      )
    },
    {
      id: 'exception',
      label: 'Patient Unable to Sign, No Facility Signature',
      reason:
        'The patient could not sign the release for billing: get the receiving facility signature or record for the signature exception (42 CFR 424.36)',
      holds: allOf(
        g,
        'exception',
        n('Unable to Sign, No Facility Signature', 'The exception needs the facility.'),
        [
          noRelease,
          unable,
          not(
            g,
            'noFacility',
            n('No Facility Signature', 'None by a healthcare provider.'),
            anyKept(g, 'anyFacility', 'Some Facility Signature', 'facility')
          )
        ]
      )
    },
    {
      id: 'noPcs',
      label: 'Non-Emergency Transport Without a PCS',
      reason:
        'Non-emergency transport without a physician certification statement (PCS): get one before billing',
      holds: allOf(g, 'noPcs', n('PCS Needed but Missing', 'Neither reported nor attached.'), [
        pcsNeeded,
        not(g, 'noPcsOnFile', n('No PCS on File', 'Not reported or attached.'), pcsOnFile)
      ])
    },
    {
      id: 'stalePcs',
      label: 'Physician Certification Older Than 60 Days',
      reason: 'The physician certification statement is dated more than 60 days before the service',
      holds: allOf(g, 'stalePcs', n('PCS Older Than 60 Days', 'Too old to cover this trip.'), [
        pcsNeeded,
        certified,
        greaterThan(
          g,
          'pcsOld',
          n('More Than 60 Days', 'CMS takes a PCS dated up to 60 days before.'),
          'integer',
          daysBetween(
            g,
            'pcsAge',
            'Days From Certification to Service',
            'payment.certificationDate',
            'entry.serviceDate'
          ),
          PCS_DAYS
        )
      ])
    },
    {
      id: 'noPriorAuthorization',
      label: 'Dialysis Transport Without Prior Authorization',
      reason:
        'Scheduled non-emergency dialysis transport without a prior authorization number: repetitive scheduled transports need one',
      holds: allOf(
        g,
        'noPriorAuthorization',
        n('Dialysis Without Prior Authorization', 'Medicare requires one for repetitive trips.'),
        [
          nonEmergencyTransport,
          isMissing(
            g,
            'noAuthorization',
            n('No Prior Authorization', 'NEMSIS ePayment.53.'),
            'payment.priorAuthorization'
          ),
          dialysis
        ]
      )
    },
    {
      id: 'filingSoon',
      label: 'Over 90 Days Since Service',
      reason:
        'More than 90 days since the date of service: check the payer’s timely filing limit, as many commercial payers allow 90 to 180 days',
      holds: allOf(
        g,
        'filingSoon',
        n('Over 90 Days, Within a Year', 'Some payers may already refuse it.'),
        [
          greaterThan(
            g,
            'over90',
            n('More Than 90 Days', 'The shortest common limit.'),
            'integer',
            daysSince,
            WARNING_DAYS
          ),
          not(
            g,
            'withinYear',
            n('Within a Year', 'Past a year is its own reason.'),
            greaterThan(
              g,
              'overYear',
              n('More Than a Year', 'Medicare’s limit.'),
              'integer',
              daysSince,
              FILING_DAYS
            )
          )
        ]
      )
    },
    {
      id: 'late',
      label: 'Past Timely Filing',
      reason: 'More than a year since the date of service: the claim is past timely filing',
      holds: 'overYear.result'
    }
  ];
  g.ret('return');
  g.wire(
    reasonsOf(g, 'reasons', n('Claim Check Reasons', 'What to fix or confirm.'), criteria),
    'return.reasons'
  );
  return g.def;
};

export const checkGraphs: SeedGraph[] = [
  asRule(
    'billing.dialysis-diagnosis',
    'Dialysis Diagnosis',
    'Whether one diagnosis is end-stage renal disease (N18.6) or dependence on dialysis (Z99.2), written with or without the dot.',
    dialysisDiagnosis()
  ),
  asRule(
    'billing.signed-release',
    'Signed Release',
    'Whether one signature is a signed release for billing, by the patient or someone signing for them.',
    signatureRule({
      description: 'Whether it is a signed release for billing.',
      label: 'Signed Release for Billing',
      note: 'Signed, and for the release of billing information.',
      signatureReason: RELEASE_FOR_BILLING,
      statuses: SIGNED,
      statusLabel: 'Signed',
      statusNote: 'Signed on paper or screen, by the patient or another.'
    })
  ),
  asRule(
    'billing.unable-to-sign',
    'Unable to Sign',
    'Whether one signature is a release for billing the patient could not sign, such as unconscious, impaired, restrained or combative.',
    signatureRule({
      description: 'Whether the patient could not sign the release for billing.',
      label: 'Release the Patient Could Not Sign',
      note: 'Not signed for a reason that allows the signature exception.',
      signatureReason: RELEASE_FOR_BILLING,
      statuses: UNABLE,
      statusLabel: 'Unable to Sign',
      statusNote: 'Deceased, distress, impaired, unconscious, restrained or combative.'
    })
  ),
  asRule(
    'billing.facility-signature',
    'Facility Signature',
    'Whether one signature is by a healthcare provider at the receiving facility, which supports the signature exception.',
    signatureRule({
      description: 'Whether a healthcare provider signed.',
      label: 'Signed by a Healthcare Provider',
      note: 'The receiving facility signed.',
      signer: HEALTHCARE_PROVIDER,
      statuses: SIGNED,
      statusLabel: 'Signed',
      statusNote: 'Signed on paper or screen.'
    })
  ),
  asRule(
    'billing.claim-checks',
    'Claim Checks',
    'What a biller should fix or confirm before the claim goes out: a signed release or the signature exception; a PCS, reported or attached, for a non-emergency transport other than an unscheduled one from a residence, dated no more than 60 days before; a prior authorization for a dialysis transport (by diagnosis or destination); and timely filing, flagged at 90 days and past a year.',
    claimChecks()
  )
];
