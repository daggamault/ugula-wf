import type { GraphDef } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  allOf,
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
  node,
  not,
  orZero,
  PAYMENT,
  type Port,
  reasonsOf,
  rule,
  SIGNATURE,
  T,
  TRANSPORT_KINDS
} from './shared.ts';

const SIGNATURE_STATUS = 'signatureStatus';

const SIGNATURE_REASON = 'signatureReason';

const RELEASE_FOR_BILLING = '4513005';

const SIGNER = 'signerType';

const SIGNED = ['4515027', '4515031', '4515033'];

const UNABLE = ['4515003', '4515005', '4515013', '4515017', '4515023', '4515037'];

const HEALTHCARE_PROVIDER = '4512005';

const CERTIFIED = '9922005';

const PCS_DAYS = 60;

const FILING_DAYS = 365;

const DIALYSIS_DIAGNOSES = ['N186', 'N18.6', 'Z992', 'Z99.2'];

type SignatureTest = {
  description: string;
  label: string;
  signatureReason?: string;
  signer?: string;
  statuses: readonly string[];
  statusLabel: string;
};

const signatureRule = (t: SignatureTest): GraphDef => {
  const g = rule(
    [d('signature', T.signature, 'Signature', 'One signature collected or attempted.')],
    [d('result', 'boolean', 'Result', t.description)]
  );
  breakRecord(g, 'signature', 'Signature', SIGNATURE, 'entry.signature');
  const tests = [
    isIn(
      g,
      'status',
      t.statusLabel,
      SIGNATURE_STATUS,
      'signature.status',
      codes(g, 'statuses', `${t.statusLabel} Statuses`, SIGNATURE_STATUS, t.statuses)
    )
  ];
  if (t.signatureReason) {
    node(
      g,
      'forBilling',
      'std.list.contains',
      'Release for Billing',
      { list: 'signature.reasons', item: fixed(t.signatureReason) },
      { type: code(SIGNATURE_REASON) }
    );
    tests.push('forBilling.result');
  }
  if (t.signer) {
    tests.push(
      isCode(g, 'signer', 'Signed by a Healthcare Provider', SIGNER, 'signature.signer', t.signer)
    );
  }
  g.ret('return');
  g.wire(allOf(g, 'result', t.label, tests), 'return.result');
  return g.def;
};

const keepSignatures = (g: Builder, id: string, label: string, ruleKey: string) =>
  keepWhere(g, id, label, ruleKey, 'signature', 'trip.signatures');

const anyKept = (g: Builder, id: string, label: string, kept: string) =>
  greaterThan(g, id, label, 'integer', `${kept}.count`, 0);

const daysBetween = (g: Builder, id: string, label: string, start: Port, end: Port) => {
  node(g, id, 'std.time.difference', label, { start, end }, { unit: 'days' });
  return orZero(g, `${id}OrZero`, `${label} or Zero`, `${id}.amount`);
};

const dialysisDiagnosis = (): GraphDef => {
  const icd10 = code('icd10');
  const g = rule(
    [d('diagnosis', icd10, 'Diagnosis', 'One diagnosis, as an ICD-10 code.')],
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
    isIn(
      g,
      'dialysis',
      'Dialysis Diagnosis',
      'icd10',
      'entry.diagnosis',
      codes(g, 'dialysisCodes', 'End-Stage Renal Disease and Dialysis', 'icd10', DIALYSIS_DIAGNOSES)
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
      d('diagnoses', listOf(code('icd10')), 'Diagnoses', 'The diagnoses of the claim.')
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
  breakRecord(g, 'trip', 'Encounter', ENCOUNTER, 'entry.encounter');
  breakRecord(g, 'payment', 'Payment', PAYMENT, 'trip.payment');
  keepSignatures(g, 'releases', 'Signed Releases for Billing', 'billing.signed-release');
  keepSignatures(g, 'unable', 'Patient Unable to Sign', 'billing.unable-to-sign');
  keepSignatures(g, 'facility', 'Facility Signatures', 'billing.facility-signature');
  const noRelease = not(
    g,
    'noRelease',
    'No Signed Release',
    anyKept(g, 'anySigned', 'Some Release Signed', 'releases')
  );
  const unable = anyKept(g, 'anyUnable', 'Patient Unable to Sign', 'unable');
  const nonEmergencyTransport = allOf(g, 'nonEmergency', 'Non-Emergency Transport', [
    isIn(
      g,
      'transported',
      'Transported',
      'tripClassification',
      'entry.classification',
      codes(g, 'transports', 'Kinds of Transport', 'tripClassification', TRANSPORT_KINDS)
    ),
    not(g, 'notEmergency', 'Not an Emergency', 'entry.emergency')
  ]);
  const certified = isCode(
    g,
    'certified',
    'Physician Certification on File',
    'yesNoUnknown',
    'payment.certification',
    CERTIFIED
  );
  node(g, 'today', 'std.time.now', 'Today');
  const criteria: Criterion[] = [
    {
      id: 'unsigned',
      label: 'No Signed Release for Billing',
      reason:
        'No signed release for billing: get the patient or a representative to sign (42 CFR 424.36)',
      holds: allOf(g, 'unsigned', 'No Signed Release, and the Patient Could Sign', [
        noRelease,
        not(g, 'couldSign', 'Patient Could Sign', unable)
      ])
    },
    {
      id: 'exception',
      label: 'Patient Unable to Sign, No Facility Signature',
      reason:
        'The patient could not sign the release for billing: get the receiving facility signature or record for the signature exception (42 CFR 424.36)',
      holds: allOf(g, 'exception', 'Patient Unable to Sign, No Facility Signature', [
        noRelease,
        unable,
        not(
          g,
          'noFacility',
          'No Facility Signature',
          anyKept(g, 'anyFacility', 'Some Facility Signature', 'facility')
        )
      ])
    },
    {
      id: 'noPcs',
      label: 'Non-Emergency Transport Without a PCS',
      reason:
        'Non-emergency transport without a physician certification statement (PCS): get one before billing',
      holds: allOf(g, 'noPcs', 'Non-Emergency Transport Without a PCS', [
        nonEmergencyTransport,
        not(g, 'notCertified', 'No Physician Certification', certified)
      ])
    },
    {
      id: 'stalePcs',
      label: 'Physician Certification Older Than 60 Days',
      reason: 'The physician certification statement is dated more than 60 days before the service',
      holds: allOf(g, 'stalePcs', 'Physician Certification Older Than 60 Days', [
        nonEmergencyTransport,
        certified,
        greaterThan(
          g,
          'pcsOld',
          'More Than 60 Days',
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
      holds: allOf(g, 'noPriorAuthorization', 'Dialysis Transport Without Prior Authorization', [
        nonEmergencyTransport,
        isMissing(g, 'noAuthorization', 'No Prior Authorization', 'payment.priorAuthorization'),
        greaterThan(
          g,
          'onDialysis',
          'A Dialysis Diagnosis',
          'integer',
          `${keepWhere(
            g,
            'dialysis',
            'Dialysis Diagnoses',
            'billing.dialysis-diagnosis',
            'diagnosis',
            'entry.diagnoses'
          )}.count`,
          0
        )
      ])
    },
    {
      id: 'late',
      label: 'Past Timely Filing',
      reason: 'More than a year since the date of service: the claim is past timely filing',
      holds: greaterThan(
        g,
        'late',
        'More Than a Year Since Service',
        'integer',
        daysBetween(g, 'age', 'Days Since Service', 'entry.serviceDate', 'today.now'),
        FILING_DAYS
      )
    }
  ];
  g.ret('return');
  g.wire(reasonsOf(g, 'reasons', 'Claim Check Reasons', criteria), 'return.reasons');
  return g.def;
};

export const checkGraphs: SeedGraph[] = [
  asRule(
    'billing.dialysis-diagnosis',
    'Dialysis Diagnosis',
    'Whether one diagnosis is end-stage renal disease (N18.6) or dependence on dialysis (Z99.2).',
    dialysisDiagnosis()
  ),
  asRule(
    'billing.signed-release',
    'Signed Release',
    'Whether one signature is a signed release for billing, by the patient or someone signing for them.',
    signatureRule({
      description: 'Whether it is a signed release for billing.',
      label: 'Signed Release for Billing',
      signatureReason: RELEASE_FOR_BILLING,
      statuses: SIGNED,
      statusLabel: 'Signed'
    })
  ),
  asRule(
    'billing.unable-to-sign',
    'Unable to Sign',
    'Whether one signature is a release for billing the patient could not sign, such as unconscious or impaired.',
    signatureRule({
      description: 'Whether the patient could not sign the release for billing.',
      label: 'Release the Patient Could Not Sign',
      signatureReason: RELEASE_FOR_BILLING,
      statuses: UNABLE,
      statusLabel: 'Unable to Sign'
    })
  ),
  asRule(
    'billing.facility-signature',
    'Facility Signature',
    'Whether one signature is by a healthcare provider at the receiving facility, which supports the signature exception.',
    signatureRule({
      description: 'Whether a healthcare provider signed.',
      label: 'Signed by a Healthcare Provider',
      signer: HEALTHCARE_PROVIDER,
      statuses: SIGNED,
      statusLabel: 'Signed'
    })
  ),
  asRule(
    'billing.claim-checks',
    'Claim Checks',
    'What a biller should fix or confirm before the claim goes out: a signed release for billing or the signature exception, a physician certification for a non-emergency transport and its age, a prior authorization for a dialysis transport, and timely filing.',
    claimChecks()
  )
];
