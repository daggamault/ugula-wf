import { CLAIM_FIX_FIELDS, type ClaimField, MAX_LOADED_MILES } from '@ugula/billing';
import type { GraphDef, Json } from '@ugula/graph';
import { slot } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  asStage,
  d,
  exit,
  expr,
  issuesSummary,
  named,
  P,
  rule,
  shared,
  stage,
  summarize,
  T
} from './shared.ts';

const BILLED = `(patientOnly == true ? 'the patient' : ${named('context?.payer', "'this claim'")})`;

const FIX_SUMMARY = issuesSummary(
  'issues',
  BILLED,
  `'Nothing blocks billing ' + ${BILLED} + '; correct any field below and save to check the claim again'`
);

const CHECK_FACTS_IN = d(
  'facts',
  T.checkFacts,
  'Check Facts',
  'The saved claim as the checks read it, with the date math done.'
);

const issue = (code: string, field: string, message: string, coverageId = 'null') =>
  `{ code: "${code}", field: "${field}", message: ${message}, coverageId: ${coverageId} }`;

const when = (condition: string, ...issues: string[]) =>
  `(${condition} ? [${issues.join(', ')}] : [])`;

type Use = {
  id: string;
  type: string;
  label: string;
  inputs: string[];
  outputs: Record<string, string>;
};

type Check = {
  key: string;
  name: string;
  description: string;
  codes: Record<string, 'blocking' | 'warning'>;
  facts: string[];
  expression: string;
  values?: Record<string, Json>;
  uses?: Use[];
};

const checkGraph = ({ facts, expression, values, uses = [] }: Check): GraphDef => {
  const g = rule([CHECK_FACTS_IN], [P.issues('What this check found, before severities apply.')]);
  g.add('facts', 'billing.check-facts.break');
  g.add('issues', 'std.expr', {
    ...expr('Issues', expression),
    ...(values ? { values } : {})
  });
  g.ret('return');
  g.wire('entry.facts', 'facts.facts');
  for (const f of facts) g.wire(`facts.${f}`, `issues.${f}`);
  for (const u of uses) {
    g.add(u.id, u.type, { label: u.label });
    for (const pin of u.inputs) g.wire(`facts.${pin}`, `${u.id}.${pin}`);
    for (const [pin, as] of Object.entries(u.outputs)) g.wire(`${u.id}.${pin}`, `issues.${as}`);
  }
  g.wire('issues.result', 'return.issues');
  return g.def;
};

const LIKELY_LOADED_MILES = 100;

const PCS_VALID_DAYS = 60;

const PCS_LATE_DAYS = 2;

const FILING_WARNING_DAYS = 30;

const MAX_PAYERS = 11;

const ROUND_TRIPS_WITHOUT_AUTHORIZATION = 3;

const MSP_ANSWERS = ['mspEmployerPlan', 'mspEsrd', 'mspDisability', 'mspAccident'];

const addressIssues = (list: string, code: string, field: string, label: string) =>
  `map(${list} ?? [], p => ${issue(code, field, `"The ${label} " + p + " is missing"`)})`;

const CHECKS: Check[] = [
  {
    key: 'billing.check-patient',
    name: 'Check Patient',
    description: 'The claim has a patient with a complete mailing address.',
    codes: { 'patient-missing': 'blocking', 'patient-address-missing': 'blocking' },
    facts: ['patientLinked', 'patientAddressMissing'],
    expression: `concat(
  ${when('!patientLinked', issue('patient-missing', 'patient', '"The claim has no patient"'))},
  ${addressIssues('patientAddressMissing', 'patient-address-missing', 'patientAddress', "patient's")}
)`
  },
  {
    key: 'billing.check-report',
    name: 'Check Report',
    description: 'The report has a PCR number and a date of service.',
    codes: { 'pcr-number-missing': 'warning', 'service-date-missing': 'blocking' },
    facts: ['pcrNumber', 'serviceDate'],
    expression: `concat(
  ${when(
    'pcrNumber == null',
    issue(
      'pcr-number-missing',
      'pcrNumber',
      '"The report has no PCR number, so a corrected report opens a new claim"'
    )
  )},
  ${when(
    'serviceDate == null',
    issue('service-date-missing', 'serviceDate', '"The date of service is missing"')
  )}
)`
  },
  {
    key: 'billing.check-service',
    name: 'Check Service',
    description:
      'The trip is billable, has a level of service and says whether it was an emergency; a scheduled trip billed as an emergency is worth checking.',
    codes: {
      'no-claim-trip': 'blocking',
      'level-missing': 'blocking',
      'emergency-missing': 'blocking',
      'scheduled-emergency': 'warning'
    },
    facts: ['tripType', 'levelValid', 'emergency'],
    expression: `concat(
  ${when(
    'tripType == "noClaim"',
    issue(
      'no-claim-trip',
      'tripType',
      '"The trip is classified as needing no claim; choose the trip type billed"'
    )
  )},
  ${when('!levelValid', issue('level-missing', 'level', '"Choose a level of service: BLS, ALS1, ALS2, SCT"'))},
  ${when(
    'emergency == null',
    issue('emergency-missing', 'emergency', '"Say whether the response was an emergency"')
  )},
  ${when(
    'tripType == "scheduled" && emergency == true',
    issue(
      'scheduled-emergency',
      'emergency',
      '"A scheduled trip is billed as an emergency; confirm the unit responded immediately"'
    )
  )}
)`
  },
  {
    key: 'billing.check-charges',
    name: 'Check Charges',
    description: 'The claim has charge lines and its total adds up to them.',
    codes: { 'lines-missing': 'blocking', 'lines-total': 'blocking' },
    facts: ['lineCount', 'linesAddUp'],
    expression: `lineCount == 0
  ? [${issue('lines-missing', 'lines', '"The claim has no charge lines"')}]
  : ${when('!linesAddUp', issue('lines-total', 'lines', '"The claim total does not add up to its lines"'))}`
  },
  {
    key: 'billing.check-diagnoses',
    name: 'Check Diagnoses',
    description: 'The claim has at least one ICD-10 diagnosis.',
    codes: { 'diagnosis-missing': 'blocking' },
    facts: ['diagnosisCount'],
    expression: when(
      'diagnosisCount == 0',
      issue('diagnosis-missing', 'diagnoses', '"At least one diagnosis code is required"')
    )
  },
  {
    key: 'billing.check-locations',
    name: 'Check Pickup and Destination',
    description:
      'The pickup has a full street address; a transport also has a full destination address and a valid origin/destination modifier.',
    codes: {
      'pickup-address-missing': 'blocking',
      'destination-address-missing': 'blocking',
      'origin-destination-missing': 'blocking'
    },
    facts: ['pickupMissing', 'destinationMissing', 'originDestinationValid', 'transports'],
    expression: `concat(
  ${addressIssues('pickupMissing', 'pickup-address-missing', 'pickup', 'pickup')},
  transports ? ${addressIssues('destinationMissing', 'destination-address-missing', 'destination', 'destination')} : [],
  ${when(
    'transports && !originDestinationValid',
    issue(
      'origin-destination-missing',
      'originDestination',
      '"The origin/destination modifier is missing"'
    )
  )}
)`
  },
  {
    key: 'billing.check-transport-reason',
    name: 'Check Transport Reason',
    description: 'A transport has an ambulance transport reason (CR104).',
    codes: { 'transport-reason-missing': 'blocking' },
    facts: ['transports', 'transportReason'],
    expression: when(
      'transports && transportReason == null',
      issue(
        'transport-reason-missing',
        'transportReason',
        '"The ambulance transport reason is missing"'
      )
    )
  },
  {
    key: 'billing.check-trip-times',
    name: 'Check Trip Times',
    description:
      'A transport records when the patient left the scene and arrived at the destination, in order.',
    codes: { 'trip-times-missing': 'warning', 'trip-times-order': 'warning' },
    facts: ['transports', 'timesRecorded', 'timesInOrder'],
    expression: `!transports ? [] : !timesRecorded
  ? [${issue(
    'trip-times-missing',
    'times',
    '"The report does not say when the patient left the scene and arrived at the destination"'
  )}]
  : ${when('!timesInOrder', issue('trip-times-order', 'times', '"The trip times are out of order"'))}`
  },
  {
    key: 'billing.check-mileage',
    name: 'Check Mileage',
    description:
      'A transport has loaded miles within the limit (unlikely distances are worth checking); a trip without transport has none.',
    codes: {
      'loaded-miles-missing': 'blocking',
      'loaded-miles-over-limit': 'blocking',
      'loaded-miles-unlikely': 'warning',
      'miles-without-transport': 'warning'
    },
    facts: ['transports', 'loadedMiles'],
    values: { maxMiles: MAX_LOADED_MILES, likelyMiles: LIKELY_LOADED_MILES },
    expression: `transports
  ? (loadedMiles == null || loadedMiles <= 0
    ? [${issue('loaded-miles-missing', 'loadedMiles', '"Loaded miles are missing"')}]
    : loadedMiles > maxMiles
      ? [${issue('loaded-miles-over-limit', 'loadedMiles', '"Loaded miles are over " + text(maxMiles)')}]
      : ${when(
        'loadedMiles > likelyMiles',
        issue(
          'loaded-miles-unlikely',
          'loadedMiles',
          '"Loaded miles are over " + text(likelyMiles) + "; check the odometers"'
        )
      )})
  : ${when(
    'loadedMiles != null && loadedMiles > 0',
    issue(
      'miles-without-transport',
      'loadedMiles',
      '"Loaded miles are recorded on a trip without transport"'
    )
  )}`
  },
  {
    key: 'billing.check-signature',
    name: 'Check Billing Signature',
    description:
      'The patient or a representative signed the release for billing, or a documented exception explains why not, when the claim bills a payer.',
    codes: {
      'signature-exception': 'warning',
      'signature-refused': 'blocking',
      'signature-missing': 'blocking'
    },
    facts: ['signature', 'signatureNote', 'payers'],
    expression: `len(payers ?? []) == 0 || signature == "signed" ? [] : signature == "exception"
  ? [${issue(
    'signature-exception',
    'signature',
    `(signatureNote ?? "The patient could not sign") + "; keep the crew statement and the receiving facility's name and date with the claim"`
  )}]
  : signature == "refused"
    ? [${issue(
      'signature-refused',
      'signature',
      '"The patient refused to sign the release for billing; get a signature before billing a payer"'
    )}]
    : [${issue(
      'signature-missing',
      'signature',
      `(signatureNote ?? "No billing signature") + "; get the patient's or a representative's signature"`
    )}]`
  },
  {
    key: 'billing.check-pcs',
    name: 'Check Physician Certification',
    description:
      'A scheduled non-emergency transport has a physician certification statement (required for Medicare), signed within the 60 days before the trip when it covers repetitive transports, and not long after.',
    codes: {
      'pcs-missing-medicare': 'blocking',
      'pcs-missing': 'warning',
      'pcs-undated': 'warning',
      'pcs-expired': 'warning',
      'pcs-late': 'warning'
    },
    facts: ['tripType', 'emergency', 'pcsOnFile', 'pcsDaysBeforeTrip', 'billsMedicare', 'pcsType'],
    values: { validDays: PCS_VALID_DAYS, lateDays: PCS_LATE_DAYS },
    expression: `tripType != "scheduled" || emergency == true ? [] : pcsOnFile != true
  ? [${issue(
    'pcs-missing',
    'pcs',
    '"A scheduled non-emergency transport needs a physician certification statement"'
  ).replace('code: "pcs-missing"', 'code: billsMedicare ? "pcs-missing-medicare" : "pcs-missing"')}]
  : pcsDaysBeforeTrip == null
    ? [${issue('pcs-undated', 'pcs', '"The physician certification statement has no signed date"')}]
    : pcsDaysBeforeTrip > validDays && pcsType != "nonRepetitive"
      ? [${issue(
        'pcs-expired',
        'pcs',
        '"The physician certification statement was signed " + text(pcsDaysBeforeTrip) + " days before the trip; repetitive transports need one from the last " + text(validDays) + " days"'
      )}]
      : ${when(
        'pcsDaysBeforeTrip < 0 - lateDays',
        issue(
          'pcs-late',
          'pcs',
          '"The physician certification statement was signed more than " + text(lateDays) + " days after the trip"'
        )
      )}`
  },
  {
    key: 'billing.check-prior-authorization',
    name: 'Check Prior Authorization',
    description:
      'A repetitive scheduled non-emergency Medicare transport past the third round trip has a prior authorization (UTN) that has not expired by the date of service.',
    codes: {
      'prior-authorization-missing': 'warning',
      'prior-authorization-expired': 'warning'
    },
    facts: [
      'tripType',
      'emergency',
      'billsMedicare',
      'roundTrips',
      'priorAuthorization',
      'priorAuthorizationDaysLeft'
    ],
    values: { freeTrips: ROUND_TRIPS_WITHOUT_AUTHORIZATION },
    expression: `tripType != "scheduled" || emergency == true || !billsMedicare ? [] : (priorAuthorization == null || priorAuthorization == "")
  ? ${when(
    'roundTrips != null && roundTrips > freeTrips',
    issue(
      'prior-authorization-missing',
      'priorAuthorization',
      '"Repetitive scheduled Medicare transports need a prior authorization (UTN) after " + text(freeTrips) + " round trips; this is round trip " + text(roundTrips)'
    )
  )}
  : ${when(
    'priorAuthorizationDaysLeft != null && priorAuthorizationDaysLeft < 0',
    issue(
      'prior-authorization-expired',
      'priorAuthorization',
      '"The prior authorization expired " + text(0 - priorAuthorizationDaysLeft) + " days before the trip"'
    )
  )}`
  },
  {
    key: 'billing.check-abn',
    name: 'Check Advance Beneficiary Notice',
    description:
      'A Medicare transport expected to be denied has an ABN on file (else it is billed with GZ and the patient cannot be billed); an ABN is dated and is not used for an emergency.',
    codes: { 'abn-missing': 'warning', 'abn-undated': 'warning', 'abn-emergency': 'warning' },
    facts: ['billsMedicare', 'emergency', 'abnOnFile', 'abnSignedOn', 'denialExpected'],
    expression: `!billsMedicare ? [] : concat(
  ${when(
    'denialExpected == true && abnOnFile != true',
    issue(
      'abn-missing',
      'abn',
      '"Medicare is expected to deny this transport and no ABN is on file, so it is billed with GZ and the patient cannot be billed"'
    )
  )},
  ${when('abnOnFile == true && abnSignedOn == null', issue('abn-undated', 'abn', '"The ABN on file has no signed date"'))},
  ${when(
    'abnOnFile == true && emergency == true',
    issue('abn-emergency', 'abn', '"An ABN cannot be used for an emergency transport"')
  )}
)`
  },
  {
    key: 'billing.check-msp',
    name: 'Check Medicare Secondary Payer',
    description:
      'A claim billing Medicare answers the MSP questions, and when another payer pays first (Medicare Secondary Payer rule) that payer is on the claim and billed before Medicare; Medicare is billed after another payer only when the MSP rule says why (SBR05).',
    codes: {
      'msp-unanswered': 'warning',
      'msp-primary-missing': 'blocking',
      'msp-order': 'blocking',
      'msp-type-missing': 'blocking'
    },
    facts: ['billsMedicare', 'payers', ...MSP_ANSWERS],
    uses: [
      {
        id: 'msp',
        type: 'billing.medicare-secondary-payer',
        label: 'Medicare Secondary Payer',
        inputs: MSP_ANSWERS,
        outputs: { medicareSecondary: 'secondary', reasons: 'why' }
      }
    ],
    expression: `!billsMedicare ? [] : concat(
  ${when(
    MSP_ANSWERS.map((a) => `${a} == null`).join(' || '),
    issue(
      'msp-unanswered',
      'msp',
      '"Answer the Medicare Secondary Payer questions before billing Medicare"'
    )
  )},
  secondary && !some(payers ?? [], p => !p.medicare)
    ? [${issue(
      'msp-primary-missing',
      'payers',
      '"Medicare pays second (" + first(why) + "), but no payer to bill first is on the claim"'
    )}]
    : ${when(
      'secondary && len(payers ?? []) > 0 && payers[0].medicare',
      issue(
        'msp-order',
        'payers',
        '"Medicare pays second (" + first(why) + "); put the payer that pays first ahead of Medicare"'
      )
    )},
  ${when(
    '!secondary && len(payers ?? []) > 0 && !payers[0].medicare',
    issue(
      'msp-type-missing',
      'msp',
      '"Medicare is billed after another payer, but no Medicare Secondary Payer answer says why; answer the MSP questions or put Medicare first"'
    )
  )}
)`
  },
  {
    key: 'billing.check-facility',
    name: 'Check Facility Responsibility',
    description:
      'A claim the Facility Responsibility rule bills to a facility is billed to it rather than the payers, and a stay a payer reports on the date of service is confirmed by a biller.',
    codes: {
      'facility-responsible': 'blocking',
      'facility-stay-reported': 'warning'
    },
    facts: ['responsibleParty', 'facilityStay', 'payers'],
    uses: [
      {
        id: 'responsibility',
        type: 'billing.facility-responsibility',
        label: 'Facility Responsibility',
        inputs: [
          'recordedParty',
          'facilityStay',
          'emergency',
          'pickupFacility',
          'destinationFacility'
        ],
        outputs: { party: 'party', facilityName: 'facilityName', reasons: 'why' }
      }
    ],
    expression: `responsibleParty == "facility"
  ? []
  : concat(
    ${when(
      'party == "facility"',
      issue(
        'facility-responsible',
        'facility',
        'first(why) + ": bill " + (facilityName ?? "the facility") + ", not the payers"'
      )
    )},
    flatten(map(filter(payers ?? [], p => p.stayReported != null && facilityStay == null), p => [${issue(
      'facility-stay-reported',
      'facility',
      'p.name + " reports a " + (p.stayReported == "snf" ? "skilled nursing facility" : "hospital inpatient") + " stay on the date of service; confirm the facility stay"',
      'p.coverageId'
    )}]))
  )`
  },
  {
    key: 'billing.check-payers',
    name: 'Check Payers',
    description:
      'Each payer is linked to the payer directory, has a member ID and the insured when the patient is not the insured, and has not answered that the coverage is inactive; at most 11 payers.',
    codes: {
      'payer-missing': 'warning',
      'payers-over-limit': 'blocking',
      'payer-unlinked': 'blocking',
      'member-id-missing': 'blocking',
      'insured-missing': 'blocking',
      'coverage-inactive': 'blocking'
    },
    facts: ['payers'],
    values: { maxPayers: MAX_PAYERS },
    expression: `concat(
  ${when('len(payers ?? []) == 0', issue('payer-missing', 'payers', '"No payer is on the claim, so the patient is billed"'))},
  ${when(
    'len(payers ?? []) > maxPayers',
    issue(
      'payers-over-limit',
      'payers',
      '"An 837P claim carries at most " + text(maxPayers) + " payers"'
    )
  )},
  flatten(map(payers ?? [], p => concat(
    ${when('!p.linked', issue('payer-unlinked', 'payer', 'p.name + " is not linked to the payer directory"', 'p.coverageId'))},
    ${when(
      'p.memberId == null || p.memberId == ""',
      issue(
        'member-id-missing',
        'memberId',
        '"The member ID for " + p.name + " is missing"',
        'p.coverageId'
      )
    )},
    ${when(
      'p.needsInsured && (p.insuredLastName == null || p.insuredLastName == "")',
      issue(
        'insured-missing',
        'insured',
        `"The insured's last name for " + p.name + " is missing"`,
        'p.coverageId'
      )
    )},
    ${when(
      'p.eligibility == "inactive"',
      issue(
        'coverage-inactive',
        'payer',
        'p.name + " reports this coverage is not active" + (p.eligibilityNote != null && p.eligibilityNote != "" ? " (" + p.eligibilityNote + ")" : "") + "; fix the member ID or remove the payer"',
        'p.coverageId'
      )
    )}
  )))
)`
  },
  {
    key: 'billing.check-timely-filing',
    name: 'Check Timely Filing',
    description:
      "Warns when a payer's filing limit has passed or is near, from its days left to file.",
    codes: { 'filing-limit-passed': 'warning', 'filing-limit-near': 'warning' },
    facts: ['payers'],
    values: { warnDays: FILING_WARNING_DAYS },
    expression: `flatten(map(payers ?? [], p => p.filingDaysLeft == null ? [] : p.filingDaysLeft < 0
  ? [${issue(
    'filing-limit-passed',
    'filing',
    '"The " + text(p.filingLimitDays) + "-day filing limit for " + p.name + " passed " + text(0 - p.filingDaysLeft) + " days ago; submit only with proof of timely filing"',
    'p.coverageId'
  )}]
  : ${when(
    'p.filingDaysLeft <= warnDays',
    issue(
      'filing-limit-near',
      'filing',
      'text(p.filingDaysLeft) + " days are left to file with " + p.name + " (" + text(p.filingLimitDays) + "-day limit)"',
      'p.coverageId'
    )
  )}))`
  }
];

const REJECTION_CODES = { 'submission-rejected': 'warning' } as const;

const REJECTION_IN = d(
  'rejection',
  'string',
  'Rejection',
  'Why the payer or clearinghouse rejected the last submission, when the claim is reviewed again after one.',
  true
);

const REJECTED_COVERAGE_IN = d(
  'rejectedCoverageId',
  'string',
  'Rejected Payer',
  'The payer that rejected it.',
  true
);

const checkLastSubmission = (): GraphDef => {
  const g = rule(
    [REJECTION_IN, REJECTED_COVERAGE_IN],
    [P.issues('The rejection, before severities apply.')]
  );
  g.add(
    'issues',
    'std.expr',
    expr(
      'Issues',
      when(
        'rejection != null',
        issue('submission-rejected', 'submission', 'rejection', 'rejectedCoverageId')
      )
    )
  );
  g.ret('return');
  g.wire('entry.rejection', 'issues.rejection');
  g.wire('entry.rejectedCoverageId', 'issues.rejectedCoverageId');
  g.wire('issues.result', 'return.issues');
  return g.def;
};

const SEVERITIES: Record<string, string> = Object.assign(
  {},
  REJECTION_CODES,
  ...CHECKS.map((c) => c.codes)
);

const ids = CHECKS.map((c) =>
  c.key.replace('billing.check-', '').replace(/-(\w)/g, (_, x) => x.toUpperCase())
);

const claimChecks = (): GraphDef => {
  const g = rule(
    [CHECK_FACTS_IN, REJECTION_IN, REJECTED_COVERAGE_IN],
    [P.issues('Every issue the checks found, with the severity the Check Severity table gives it.')]
  );
  g.add('lastSubmission', 'billing.check-last-submission', { label: 'Check Last Submission' });
  CHECKS.forEach((c, i) => {
    g.add(ids[i] ?? c.key, c.key, { label: c.name });
    g.wire('entry.facts', `${ids[i]}.facts`);
  });
  g.add('found', 'std.expr', expr('Every Check', `concat(lastSubmission, ${ids.join(', ')})`));
  g.add('agency', 'billing.agency-checks', { label: 'Agency Checks' });
  g.add('codes', 'std.list.pluck', { label: 'Check Codes', values: { field: 'code' } });
  g.add('severity', 'std.table.lookup', {
    label: 'Check Severity',
    config: shared.lookup(
      'billing.check-severity',
      'Check Severity',
      'How much each claim check matters: blocking keeps the claim from going out, warning shows it to the biller, off ignores it. A code not listed blocks.',
      {
        type: 'string',
        rows: Object.entries(SEVERITIES).map(([key, value]) => ({ key, value })),
        fallback: 'blocking'
      }
    )
  });
  g.add(
    'rated',
    'std.expr',
    expr(
      'With Their Severity',
      'filter(map(issues, (i, n) => merge(i, { severity: severities[n] })), i => i.severity == "blocking" || i.severity == "warning")'
    )
  );
  g.ret('return');
  g.wire('entry.rejection', 'lastSubmission.rejection');
  g.wire('entry.rejectedCoverageId', 'lastSubmission.rejectedCoverageId');
  g.wire('lastSubmission.issues', 'found.lastSubmission');
  for (const id of ids) g.wire(`${id}.issues`, `found.${id}`);
  g.wire('found.result', 'agency.issues');
  g.wire('entry.facts', 'agency.facts');
  g.wire('agency.issues', 'codes.list', 'rated.issues');
  g.wire('codes.list', 'severity.keys');
  g.wire('severity.values', 'rated.severities');
  g.wire('rated.result', 'return.issues');
  return g.def;
};

const PAYER_ONLY_FIELDS = [
  'payers',
  'payer',
  'memberId',
  'insured',
  'signature',
  'pcs',
  'abn',
  'msp',
  'priorAuthorization',
  'facility',
  'filing',
  'submission'
] satisfies ClaimField[];

const ISSUES_OUT = P.issues('The issues that matter for this step, with their severity.');

const FORM_OUT = [
  d('visible', { list: 'string' }, 'Fields to Fix', 'The Fix Claim Data fields the issues name.'),
  d('defaults', { object: {} }, 'Current Values', 'The current value of each field.'),
  d('options', { object: {} }, 'Choices', 'The payer and directory choices of the form.')
];

const checkClaim = (): GraphDef => {
  const g = stage(
    [
      P.claimId(),
      d(
        'all',
        'boolean',
        'Every Field',
        'Lay out every field of the fix form, not only those the issues name.',
        true
      ),
      d(
        'patientOnly',
        'boolean',
        'Patient Billing',
        'Only issues that matter for billing the patient (payer issues are left out).',
        true
      ),
      REJECTION_IN,
      REJECTED_COVERAGE_IN
    ],
    [
      ISSUES_OUT,
      d('claim', { object: {} }, 'Claim', 'The claim as checked, for task details.'),
      ...FORM_OUT
    ],
    {
      valid: exit('Valid', 'Nothing blocks the claim.'),
      invalid: exit('Invalid', 'A blocking issue keeps the claim from going out.')
    }
  );
  g.add('read', 'billing.read-claim-checks', { label: 'Read Claim for Checks' });
  g.add('checks', 'billing.claim-checks', { label: 'Claim Checks' });
  g.add(
    'relevant',
    'std.expr',
    expr(
      'Issues That Matter Now',
      `filter(issues, i => patientOnly == true ? !contains(${JSON.stringify(PAYER_ONLY_FIELDS)}, i.field) : i.coverageId == null || !contains(skipped, i.coverageId))`
    )
  );
  g.add('form', 'billing.fix-claim-form', { label: 'Fix Claim Form' });
  g.add(
    'blocking',
    'std.expr',
    expr('Anything Blocking', 'some(issues, i => i.severity == "blocking")')
  );
  g.add('decide', 'std.flow.branch', { label: 'Blocked?' });
  g.ret('validDone', 'valid');
  g.ret('invalidDone', 'invalid');
  g.wire('entry.exec', 'read.exec');
  g.wire('entry.claimId', 'read.claimId', 'form.claimId');
  g.wire('read.facts', 'checks.facts');
  g.wire('entry.rejection', 'checks.rejection');
  g.wire('entry.rejectedCoverageId', 'checks.rejectedCoverageId');
  g.wire('checks.issues', 'relevant.issues');
  g.wire('read.skipped', 'relevant.skipped');
  g.wire('entry.patientOnly', 'relevant.patientOnly');
  g.wire('relevant.result', 'form.issues', 'blocking.issues');
  g.wire('entry.all', 'form.all');
  g.wire('read.then', 'form.exec');
  g.wire('form.then', 'decide.exec');
  g.wire('blocking.result', 'decide.condition');
  g.wire('decide.true', 'invalidDone.exec');
  g.wire('decide.false', 'validDone.exec');
  for (const done of ['validDone', 'invalidDone']) {
    g.wire('relevant.result', `${done}.issues`);
    g.wire('read.claim', `${done}.claim`);
    for (const pin of ['visible', 'defaults', 'options']) g.wire(`form.${pin}`, `${done}.${pin}`);
  }
  return g.def;
};

const fixClaim = (): GraphDef => {
  const g = stage(
    [
      P.claimId(),
      d(
        'all',
        'boolean',
        'Ask Every Field',
        'Ask about every field once, even when nothing blocks the claim.',
        true
      ),
      d(
        'patientOnly',
        'boolean',
        'Patient Billing',
        'Only issues that matter for billing the patient (payer issues are left out).',
        true
      ),
      P.subject(),
      P.context()
    ],
    [],
    {
      fixed: exit('Fixed', 'Nothing blocks the claim any more.'),
      voided: exit('Voided', 'A biller voided the claim.'),
      backToReview: exit('Back to Review', 'A biller sent the claim back to PCR review.')
    },
    [{ name: 'askAll', type: 'boolean', default: false }]
  );
  g.add('ask', 'std.var.set', { label: 'Ask Every Field First?', config: { name: 'askAll' } });
  g.add('askAll', 'std.var.get', { label: 'Asking Every Field', config: { name: 'askAll' } });
  g.add('check', 'billing.check-claim', { label: 'Check Claim' });
  g.add('asked', 'std.flow.branch', { label: 'Asked to Fix Anyway?' });
  g.add(
    'facilityBlocks',
    'std.expr',
    expr(
      'A Facility Is Responsible',
      'some(issues, i => i.code == "facility-responsible" && i.severity == "blocking")'
    )
  );
  g.add('toFacility', 'std.flow.branch', { label: 'Bill a Facility?' });
  g.add('responsibility', 'billing.decide-responsibility', { label: 'Decide Responsibility' });
  g.add('billFacility', 'billing.bill-facility', { label: 'Bill Facility' });
  g.add('fixContext', 'std.expr', expr('Fix Context', '{ issues: issues, claim: context }'));
  g.add('fix', 'std.human.task', {
    label: 'Fix Claim Data',
    config: {
      title: 'Fix claim data',
      queue: 'billing-review',
      instructions:
        'The claim is missing something or has something wrong, listed with the field it is fixed in. Correct the fields below and save, and the claim is checked again; empty fields are left as they are. Charges are mapped and priced again when the trip type, service, miles or payers change. Void the claim if it should never be billed.',
      fields: CLAIM_FIX_FIELDS,
      outcomes: ['save', 'void', 'backToReview'],
      hints: {
        save: 'Applies the fixes, reprices if needed and checks the claim; this task comes back while anything blocks it.',
        void: 'Voids the claim so it is never billed.',
        backToReview: 'Saves nothing and hands the claim back to the step that asked for this fix.'
      },
      prefill: 'current'
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
  g.add('triggers', 'billing.reprice-triggers', { label: 'Reprice Triggers' });
  g.add('repriceNeeded', 'std.flow.branch', { label: 'Reprice?' });
  g.add('reprice', 'billing.reprice-claim', { label: 'Reprice Changed Charges' });
  g.ret('fixedDone', 'fixed');
  g.ret('voidedDone', 'voided');
  g.ret('reviewDone', 'backToReview');
  g.wire('entry.exec', 'ask.exec');
  g.wire('entry.all', 'ask.value');
  g.wire('ask.then', 'check.exec');
  g.wire('entry.claimId', 'check.claimId');
  g.wire('entry.patientOnly', 'check.patientOnly');
  g.wire('claimIdToPatch.claimId', 'patch.claimId', 'reprice.claimId');
  g.wire('askAll.value', 'check.all', 'asked.condition');
  g.wire('check.invalid', 'toFacility.exec');
  g.wire('check.issues', 'facilityBlocks.issues');
  g.wire('facilityBlocks.result', 'toFacility.condition');
  g.wire('toFacility.false', 'fix.exec');
  g.wire('toFacility.true', 'responsibility.exec');
  g.wire('claimIdToPatch.claimId', 'responsibility.claimId', 'billFacility.claimId');
  g.wire('responsibility.payers', 'fix.exec');
  g.wire('responsibility.facility', 'billFacility.exec');
  g.wire('responsibility.facilityId', 'billFacility.facilityId');
  g.wire('responsibility.reason', 'billFacility.reason');
  g.wire('entry.subject', 'billFacility.subject');
  g.wire('entry.context', 'billFacility.context');
  g.wire('billFacility.billed', 'check.exec');
  g.wire('billFacility.payers', 'check.exec');
  g.wire('billFacility.voided', 'voidedDone.exec');
  g.wire('check.valid', 'asked.exec');
  g.wire('asked.true', 'fix.exec');
  g.wire('asked.false', 'fixedDone.exec');
  g.wire('check.issues', 'fixContext.issues');
  g.wire('entry.context', 'fixContext.context');
  g.wire('fixContext.result', 'fix.context');
  g.wire('check.visible', 'fix.visible');
  g.wire('check.defaults', 'fix.defaults');
  g.wire('check.options', 'fix.options');
  g.wire('entry.subject', 'fix.subject');
  summarize(g, 'fix', FIX_SUMMARY, {
    issues: 'check.issues',
    context: 'entry.context',
    patientOnly: 'entry.patientOnly'
  });
  g.wire('subjectToReprice.subject', 'reprice.subject');
  g.wire('fix.save', 'stopAsking.exec');
  g.wire('stopAsking.then', 'patch.exec');
  for (const { name } of CLAIM_FIX_FIELDS) g.wire(`fix.${name}`, `patch.${name}`);
  g.wire('patch.changes', 'triggers.changes');
  g.wire('patch.then', 'repriceNeeded.exec');
  g.wire('triggers.reprice', 'repriceNeeded.condition');
  g.wire('repriceNeeded.false', 'check.exec');
  g.wire('repriceNeeded.true', 'reprice.exec');
  g.wire('patch.tripType', 'reprice.tripType');
  g.wire('patch.service', 'reprice.service');
  g.wire('patch.payerId', 'reprice.payerId');
  g.wire('fixContext.result', 'reprice.context');
  g.wire('reprice.repriced', 'check.exec');
  g.wire('reprice.voided', 'voidedDone.exec');
  g.wire('fix.void', 'voidedDone.exec');
  g.wire('fix.backToReview', 'reviewDone.exec');
  return g.def;
};

export const checkGraphs: SeedGraph[] = [
  slot(
    'billing.agency-checks',
    'Agency Checks',
    'An agency rule after the base claim checks: add checks of its own (a payer that needs a facesheet, say) or drop issues, before severities apply. Passes the issues through unchanged until an agency overrides it.',
    {
      execIn: [],
      execOut: [],
      inputs: [
        d('issues', T.issues, 'Issues', 'The issues the base checks found.'),
        d('facts', T.checkFacts, 'Check Facts', 'The claim as the checks read it.', true)
      ],
      outputs: [d('issues', T.issues, 'Issues', 'The issues to rate and show.')]
    }
  ),
  ...CHECKS.map((c) => asRule(c.key, c.name, c.description, checkGraph(c))),
  asRule(
    'billing.check-last-submission',
    'Check Last Submission',
    'Shows why the payer or clearinghouse rejected the last submission when the claim is reviewed again.',
    checkLastSubmission()
  ),
  asRule(
    'billing.claim-checks',
    'Claim Checks',
    'Runs every claim check on the check facts, then the Agency Checks rule, and rates each issue with the Check Severity table (blocking, warning or off).',
    claimChecks()
  ),
  asStage(
    'billing.check-claim',
    'Check Claim',
    'Reads the saved claim, runs the Claim Checks, keeps the issues that matter now (none about skipped payers; only patient ones before billing the patient) and lays out the fix form. Continues through invalid when an issue blocks the claim.',
    checkClaim()
  ),
  asStage(
    'billing.fix-claim',
    'Fix Claim',
    'Checks a saved claim and, while anything blocks it (or always, with all), asks a biller to fix the fields the issues name, applies the fixes, reprices when the Reprice Triggers rule says so and checks again; a claim the Facility Responsibility rule bills to a facility goes to Bill Facility instead, then is checked again. With patientOnly, only issues that matter for billing the patient count. Continues through fixed, voided or backToReview.',
    fixClaim()
  )
];
