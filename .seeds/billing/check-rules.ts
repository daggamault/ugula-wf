import { billingModels, MAX_LOADED_MILES } from '@ugula/billing';
import type { GraphDef, Json, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import { asRule, type Builder, d, P, rule, T } from './shared.ts';

type Severity = 'blocking' | 'warning';

type Op = 'is' | 'isNot' | 'oneOf' | 'notOneOf' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'present';

type Test = [name: string, op: Op, value?: Json];

const LIKELY_LOADED_MILES = 100;
const PCS_VALID_DAYS = 60;
const PCS_LATE_DAYS = 2;
const FILING_WARNING_DAYS = 30;
const MAX_PAYERS = 11;
const ROUND_TRIPS_WITHOUT_AUTHORIZATION = 3;
const MSP_ANSWERS = ['mspEmployerPlan', 'mspEsrd', 'mspDisability', 'mspAccident'];
const ISSUE_TYPE = (T.issues as { list: ValueType }).list;

const fieldsOf = (key: string) =>
  new Map(
    (billingModels.find((m) => m.key === key)?.fields ?? []).map((f) => [f.name, f.type] as const)
  );

const FACT_TYPES = fieldsOf('billing.check-facts');
const PAYER_TYPES = fieldsOf('billing.checked-payer');

const PLACEHOLDER = /\{(\w+)/g;

const placeholders = (template: string) => [
  ...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))
];

const titleOf = (code: string) =>
  code.replace(
    /(^|-)(\w)/g,
    (_, dash: string, c: string) => `${dash ? ' ' : ''}${c.toUpperCase()}`
  );

type Source = { port: string; type: ValueType };

type Port = `${string}.${string}`;

const camel = (code: string) => code.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

const checks = (
  g: Builder,
  record: { node: string; types: ReadonlyMap<string, ValueType> },
  codes: Record<string, Severity>
) => {
  const link = (from: string, to: string) => g.wire(from as Port, to as Port);
  const sources = new Map<string, Source>();
  const issues: string[] = [];
  const lists: string[] = [];
  const portOf = (name: string) => sources.get(name)?.port ?? `${record.node}.${name}`;
  const typeOf = (name: string): ValueType => {
    const type = sources.get(name)?.type ?? record.types.get(name);
    if (!type) throw new Error(`Unknown check value ${name}`);
    return type;
  };
  const known = (code: string) => {
    if (!codes[code]) throw new Error(`Check code ${code} has no severity`);
    return code;
  };
  const value = (name: string, port: string, type: ValueType) => {
    sources.set(name, { port, type });
    return name;
  };
  const node = (
    id: string,
    type: string,
    label: string,
    opts: { config?: Json; values?: Record<string, Json> } = {}
  ) => g.add(id, type, { label, ...opts });
  const when = (id: string, label: string, tests: Test[], match: 'all' | 'any' = 'all') => {
    const names = [...new Set(tests.map(([name]) => name))];
    g.add(id, 'std.logic.condition', {
      label,
      config: {
        match,
        inputs: names.map((name) => ({ name, type: typeOf(name) })),
        rules: tests.map(([field, op, v]) => ({
          field,
          op,
          ...(v === undefined ? {} : { value: v })
        }))
      }
    });
    for (const name of names) link(portOf(name), `${id}.${name}`);
    return value(id, `${id}.result`, 'boolean');
  };
  const text = (id: string, label: string, template: string) => {
    g.add(id, 'std.text.template', { label, config: { template } });
    for (const name of placeholders(template)) link(portOf(name), `${id}.${name}`);
    return value(id, `${id}.text`, 'string');
  };
  const issue = (
    code: string,
    field: string,
    message: string,
    condition: string,
    opts: { coverage?: string; id?: string } = {}
  ) => {
    const id = opts.id ?? `${camel(code)}Issue`;
    const dynamic = placeholders(message).length > 0;
    g.add(id, 'billing.issue-when', {
      label: titleOf(code),
      config: { code: known(code), field, message: dynamic ? '' : message }
    });
    link(portOf(condition), `${id}.when`);
    if (dynamic)
      link(portOf(text(`${id}Message`, `${titleOf(code)} Message`, message)), `${id}.message`);
    if (opts.coverage) link(portOf(opts.coverage), `${id}.coverageId`);
    issues.push(`${id}.issue`);
  };
  const each = (
    code: string,
    field: string,
    message: string,
    items: string,
    condition?: string
  ) => {
    const id = `${camel(code)}Issues`;
    g.add(id, 'billing.issue-for-each', {
      label: titleOf(code),
      config: { code: known(code), field, message }
    });
    link(portOf(items), `${id}.items`);
    if (condition) link(portOf(condition), `${id}.when`);
    lists.push(`${id}.issues`);
  };
  const list = (port: string) => lists.push(port);
  const wire = (from: string, ...to: string[]) => {
    for (const t of to) link(from.includes('.') ? from : portOf(from), t);
  };
  const finish = () => {
    const parts = [...lists];
    if (issues.length) {
      g.add('found', 'std.list.make', {
        label: 'Issues Found',
        config: { count: issues.length, type: ISSUE_TYPE }
      });
      for (const [i, p] of issues.entries()) link(p, `found.item${i + 1}`);
      parts.unshift('found.list');
    }
    g.ret('return');
    if (parts.length === 1) {
      link(parts[0] ?? '', 'return.issues');
      return g.def;
    }
    g.add('all', 'std.list.join', {
      label: 'Every Issue',
      config: { count: parts.length, type: ISSUE_TYPE }
    });
    for (const [i, p] of parts.entries()) link(p, `all.list${i + 1}`);
    g.wire('all.list', 'return.issues');
    return g.def;
  };
  return { when, text, value, node, issue, each, list, wire, finish };
};

type Checks = ReturnType<typeof checks>;

const FACTS_IN = d(
  'facts',
  T.checkFacts,
  'Check Facts',
  'The saved claim as the checks read it, with the date math done.'
);

const PAYER_TYPE: ValueType = { object: Object.fromEntries(PAYER_TYPES) };

const PAYER_IN = d('payer', PAYER_TYPE, 'Payer', 'One payer on the claim, as the checks read it.');

const FOUND_OUT = P.issues('What this check found, before severities apply.');

const onFacts = (codes: Record<string, Severity>, build: (c: Checks) => void) => {
  const g = rule([FACTS_IN], [FOUND_OUT]);
  g.add('facts', 'billing.check-facts.break', { label: 'Check Facts' });
  g.wire('entry.facts', 'facts.facts');
  const c = checks(g, { node: 'facts', types: FACT_TYPES }, codes);
  build(c);
  return c.finish();
};

const onPayer = (
  codes: Record<string, Severity>,
  build: (c: Checks) => void,
  extra: (typeof FACTS_IN)[] = []
) => {
  const g = rule([PAYER_IN, ...extra], [FOUND_OUT]);
  g.add('payer', 'billing.checked-payer.break', { label: 'Payer' });
  g.wire('entry.payer', 'payer.payer');
  const c = checks(g, { node: 'payer', types: PAYER_TYPES }, codes);
  for (const p of extra) c.value(p.name, `entry.${p.name}`, p.type);
  build(c);
  return c.finish();
};

type CheckSpec = {
  key: string;
  name: string;
  description: string;
  codes: Record<string, Severity>;
  definition: () => GraphDef;
};

const PATIENT_CODES = {
  'patient-missing': 'blocking',
  'patient-address-missing': 'blocking'
} as const;

const REPORT_CODES = {
  'pcr-number-missing': 'warning',
  'service-date-missing': 'blocking'
} as const;

const SERVICE_CODES = {
  'not-billable': 'blocking',
  'level-missing': 'blocking',
  'emergency-missing': 'blocking',
  'scheduled-emergency': 'warning'
} as const;

const CHARGE_CODES = { 'lines-missing': 'blocking', 'lines-total': 'blocking' } as const;

const DIAGNOSIS_CODES = {
  'diagnosis-missing': 'blocking',
  'diagnosis-unknown': 'blocking',
  'diagnosis-not-billable': 'blocking'
} as const;

const LOCATION_CODES = {
  'pickup-address-missing': 'blocking',
  'destination-address-missing': 'blocking',
  'origin-destination-missing': 'blocking',
  'pickup-zip-not-priced': 'blocking',
  'pickup-zip4-needed': 'warning',
  'zip-state-mismatch': 'warning'
} as const;

const MILEAGE_CODES = {
  'loaded-miles-missing': 'blocking',
  'loaded-miles-over-limit': 'blocking',
  'loaded-miles-unlikely': 'warning',
  'miles-without-transport': 'warning'
} as const;

const SIGNATURE_CODES = {
  'signature-exception': 'warning',
  'signature-refused': 'blocking',
  'signature-missing': 'blocking'
} as const;

const PCS_CODES = {
  'pcs-missing-medicare': 'blocking',
  'pcs-missing': 'warning',
  'pcs-undated': 'warning',
  'pcs-expired': 'warning',
  'pcs-late': 'warning'
} as const;

const AUTHORIZATION_CODES = {
  'prior-authorization-missing': 'warning',
  'prior-authorization-expired': 'warning'
} as const;

const ABN_CODES = {
  'abn-missing': 'warning',
  'abn-undated': 'warning',
  'abn-emergency': 'warning'
} as const;

const MSP_CODES = {
  'msp-unanswered': 'warning',
  'msp-employer-size-missing': 'warning',
  'msp-primary-missing': 'blocking',
  'msp-order': 'blocking',
  'msp-type-missing': 'blocking'
} as const;

const FACILITY_CODES = {
  'facility-responsible': 'blocking',
  'facility-stay-reported': 'warning'
} as const;

const PAYER_CODES = {
  'payer-missing': 'warning',
  'payers-over-limit': 'blocking',
  'payer-unlinked': 'blocking',
  'member-id-missing': 'blocking',
  'insured-missing': 'blocking',
  'coverage-inactive': 'blocking'
} as const;

const FILING_CODES = { 'filing-limit-passed': 'warning', 'filing-limit-near': 'warning' } as const;

const REJECTION_CODES = { 'submission-rejected': 'warning' } as const;

const ZIP_PLACES = [
  { place: 'pickup', field: 'pickup', label: 'pickup' },
  { place: 'destination', field: 'destination', label: 'destination' },
  { place: 'patient', field: 'patientAddress', label: "patient's" }
];

const CHECKS: CheckSpec[] = [
  {
    key: 'billing.check-patient',
    name: 'Check Patient',
    description: 'The claim has a patient with a complete mailing address.',
    codes: PATIENT_CODES,
    definition: () =>
      onFacts(PATIENT_CODES, (c) => {
        c.issue(
          'patient-missing',
          'patient',
          'The claim has no patient',
          c.when('noPatient', 'No Patient', [['patientLinked', 'isNot', true]])
        );
        c.each(
          'patient-address-missing',
          'patientAddress',
          "The patient's {item} is missing",
          'patientAddressMissing'
        );
      })
  },
  {
    key: 'billing.check-report',
    name: 'Check Report',
    description: 'The report has a PCR number and a date of service.',
    codes: REPORT_CODES,
    definition: () =>
      onFacts(REPORT_CODES, (c) => {
        c.issue(
          'pcr-number-missing',
          'pcrNumber',
          'The report has no PCR number, so a corrected report opens a new claim',
          c.when('noPcrNumber', 'No PCR Number', [['pcrNumber', 'empty']])
        );
        c.issue(
          'service-date-missing',
          'serviceDate',
          'The date of service is missing',
          c.when('noServiceDate', 'No Date of Service', [['serviceDate', 'empty']])
        );
      })
  },
  {
    key: 'billing.check-service',
    name: 'Check Service',
    description:
      'The trip is billable, has a level of service and says whether it was an emergency; a scheduled trip billed as an emergency is worth checking.',
    codes: SERVICE_CODES,
    definition: () =>
      onFacts(SERVICE_CODES, (c) => {
        c.issue(
          'not-billable',
          'classification',
          'The trip is classified as not billable; choose the classification to bill',
          c.when('notBillable', 'Not Billable', [['classification', 'is', 'notBillable']])
        );
        c.issue(
          'level-missing',
          'level',
          'Choose a level of service: BLS, ALS1, ALS2, SCT',
          c.when('noLevel', 'No Valid Level', [['levelValid', 'isNot', true]])
        );
        c.issue(
          'emergency-missing',
          'emergency',
          'Say whether the response was an emergency',
          c.when('noEmergency', 'Emergency Not Said', [['emergency', 'empty']])
        );
        c.issue(
          'scheduled-emergency',
          'emergency',
          'A scheduled trip is billed as an emergency; confirm the unit responded immediately',
          c.when('scheduledEmergency', 'Scheduled but Emergency', [
            ['classification', 'is', 'scheduled'],
            ['emergency', 'is', true]
          ])
        );
      })
  },
  {
    key: 'billing.check-charges',
    name: 'Check Charges',
    description: 'The claim has charge lines and its total adds up to them.',
    codes: CHARGE_CODES,
    definition: () =>
      onFacts(CHARGE_CODES, (c) => {
        c.issue(
          'lines-missing',
          'lines',
          'The claim has no charge lines',
          c.when('noLines', 'No Charge Lines', [['lineCount', 'is', 0]])
        );
        c.issue(
          'lines-total',
          'lines',
          'The claim total does not add up to its lines',
          c.when('offTotal', 'Total Off', [
            ['lineCount', 'isNot', 0],
            ['linesAddUp', 'isNot', true]
          ])
        );
      })
  },
  {
    key: 'billing.check-diagnoses',
    name: 'Check Diagnoses',
    description:
      'The claim has at least one ICD-10 diagnosis; for trips in the year of the loaded ICD-10-CM codes, every diagnosis is an ICD-10-CM code and none is a category that needs more characters to bill.',
    codes: DIAGNOSIS_CODES,
    definition: () =>
      onFacts(DIAGNOSIS_CODES, (c) => {
        c.issue(
          'diagnosis-missing',
          'diagnoses',
          'At least one diagnosis code is required',
          c.when('noDiagnosis', 'No Diagnosis', [['diagnosisCount', 'is', 0]])
        );
        c.each(
          'diagnosis-unknown',
          'diagnoses',
          'Diagnosis {item} is not an ICD-10-CM code; correct it',
          'unknownDiagnoses'
        );
        c.each(
          'diagnosis-not-billable',
          'diagnoses',
          '{item} is a category, not a billable ICD-10-CM code; choose a more specific code under it',
          'unbillableDiagnoses'
        );
      })
  },
  {
    key: 'billing.check-locations',
    name: 'Check Pickup and Destination',
    description:
      'The pickup has a full street address; a transport also has a full destination address and a valid origin/destination modifier. Medicare prices the trip by the pickup ZIP code, so it must be in the CMS ZIP file, with its ZIP+4 where CMS splits the ZIP between localities; and every ZIP code should belong to the state of its address (GeoNames).',
    codes: LOCATION_CODES,
    definition: () =>
      onFacts(LOCATION_CODES, (c) => {
        c.each('pickup-address-missing', 'pickup', 'The pickup {item} is missing', 'pickupMissing');
        const transported = c.when('transported', 'Transported', [['transports', 'is', true]]);
        c.each(
          'destination-address-missing',
          'destination',
          'The destination {item} is missing',
          'destinationMissing',
          transported
        );
        c.issue(
          'origin-destination-missing',
          'originDestination',
          'The origin/destination modifier is missing',
          c.when('noModifier', 'Transported Without Modifier', [
            ['transports', 'is', true],
            ['originDestinationValid', 'isNot', true]
          ])
        );
        c.issue(
          'pickup-zip-not-priced',
          'pickup',
          'Medicare does not price the pickup ZIP code (it is not in the CMS ZIP file); correct it',
          c.when('zipNotPriced', 'Pickup ZIP Not Priced', [
            ['billsMedicare', 'is', true],
            ['pickupZipPriced', 'is', false]
          ])
        );
        c.issue(
          'pickup-zip4-needed',
          'pickup',
          'CMS splits the pickup ZIP code between Medicare localities; add its ZIP+4 so the trip is priced for the right one',
          c.when('zip4Needed', 'Pickup ZIP+4 Needed', [
            ['billsMedicare', 'is', true],
            ['pickupZipNeedsPlusFour', 'is', true]
          ])
        );
        for (const { place, field, label } of ZIP_PLACES) {
          c.issue(
            'zip-state-mismatch',
            field,
            `The ${label} ZIP code belongs to another state than its address`,
            c.when(`${place}ZipState`, `${titleOf(place)} ZIP in Another State`, [
              ['zipStateMismatches', 'is', place]
            ]),
            { id: `${place}ZipStateIssue` }
          );
        }
      })
  },
  {
    key: 'billing.check-transport-reason',
    name: 'Check Transport Reason',
    description: 'A transport has an ambulance transport reason (CR104).',
    codes: { 'transport-reason-missing': 'blocking' },
    definition: () =>
      onFacts({ 'transport-reason-missing': 'blocking' }, (c) =>
        c.issue(
          'transport-reason-missing',
          'transportReason',
          'The ambulance transport reason is missing',
          c.when('noReason', 'Transported Without Reason', [
            ['transports', 'is', true],
            ['transportReason', 'empty']
          ])
        )
      )
  },
  {
    key: 'billing.check-conditions',
    name: 'Check Ambulance Conditions',
    description:
      'A non-emergency Medicare transport documents the ambulance conditions (CRC) that made an ambulance necessary, such as bed-confined or moved by stretcher.',
    codes: { 'conditions-missing': 'warning' },
    definition: () =>
      onFacts({ 'conditions-missing': 'warning' }, (c) =>
        c.issue(
          'conditions-missing',
          'pcs',
          'The report documents no ambulance condition (such as bed-confined or moved by stretcher) for this non-emergency Medicare transport, so none is billed; document it on the report or the physician certification',
          c.when('noConditions', 'Non-Emergency Medicare Without Conditions', [
            ['transports', 'is', true],
            ['emergency', 'is', false],
            ['billsMedicare', 'is', true],
            ['conditionsDocumented', 'isNot', true]
          ])
        )
      )
  },
  {
    key: 'billing.check-trip-times',
    name: 'Check Trip Times',
    description:
      'A transport records when the patient left the scene and arrived at the destination, in order.',
    codes: { 'trip-times-missing': 'warning', 'trip-times-order': 'warning' },
    definition: () =>
      onFacts({ 'trip-times-missing': 'warning', 'trip-times-order': 'warning' }, (c) => {
        c.issue(
          'trip-times-missing',
          'times',
          'The report does not say when the patient left the scene and arrived at the destination',
          c.when('noTimes', 'Transported Without Times', [
            ['transports', 'is', true],
            ['timesRecorded', 'isNot', true]
          ])
        );
        c.issue(
          'trip-times-order',
          'times',
          'The trip times are out of order',
          c.when('timesOutOfOrder', 'Times Out of Order', [
            ['transports', 'is', true],
            ['timesRecorded', 'is', true],
            ['timesInOrder', 'isNot', true]
          ])
        );
      })
  },
  {
    key: 'billing.check-mileage',
    name: 'Check Mileage',
    description:
      'A transport has loaded miles within the limit (unlikely distances are worth checking); a trip without transport has none.',
    codes: MILEAGE_CODES,
    definition: () =>
      onFacts(MILEAGE_CODES, (c) => {
        const miles = c.when('hasMiles', 'Has Loaded Miles', [['loadedMiles', 'gt', 0]]);
        c.issue(
          'loaded-miles-missing',
          'loadedMiles',
          'Loaded miles are missing',
          c.when('noMiles', 'Transported Without Miles', [
            ['transports', 'is', true],
            [miles, 'isNot', true]
          ])
        );
        c.issue(
          'loaded-miles-over-limit',
          'loadedMiles',
          `Loaded miles are over ${MAX_LOADED_MILES}`,
          c.when('overLimit', 'Miles Over the Limit', [
            ['transports', 'is', true],
            ['loadedMiles', 'gt', MAX_LOADED_MILES]
          ])
        );
        c.issue(
          'loaded-miles-unlikely',
          'loadedMiles',
          `Loaded miles are over ${LIKELY_LOADED_MILES}; check the odometers`,
          c.when('unlikely', 'Unlikely Miles', [
            ['transports', 'is', true],
            ['loadedMiles', 'gt', LIKELY_LOADED_MILES],
            ['loadedMiles', 'lte', MAX_LOADED_MILES]
          ])
        );
        c.issue(
          'miles-without-transport',
          'loadedMiles',
          'Loaded miles are recorded on a trip without transport',
          c.when('milesNoTransport', 'Miles Without Transport', [
            ['transports', 'isNot', true],
            [miles, 'is', true]
          ])
        );
      })
  },
  {
    key: 'billing.check-signature',
    name: 'Check Billing Signature',
    description:
      'The patient or a representative signed the release for billing, or a documented exception explains why not, when the claim bills a payer.',
    codes: SIGNATURE_CODES,
    definition: () =>
      onFacts(SIGNATURE_CODES, (c) => {
        c.node('note', 'std.logic.choose', 'Note, Else Default', {
          config: { mode: 'first', type: 'string', count: 2 },
          values: { option2: 'The patient could not sign' }
        });
        c.node('missingNote', 'std.logic.choose', 'Note, Else No Signature', {
          config: { mode: 'first', type: 'string', count: 2 },
          values: { option2: 'No billing signature' }
        });
        c.wire('signatureNote', 'note.option1', 'missingNote.option1');
        c.value('noteOrDefault', 'note.value', 'string');
        c.value('noteOrMissing', 'missingNote.value', 'string');
        c.issue(
          'signature-exception',
          'signature',
          "{noteOrDefault}; keep the crew statement and the receiving facility's name and date with the claim",
          c.when('exception', 'Signature Exception', [
            ['payers', 'present'],
            ['signature', 'is', 'exception']
          ])
        );
        c.issue(
          'signature-refused',
          'signature',
          'The patient refused to sign the release for billing; get a signature before billing a payer',
          c.when('refused', 'Signature Refused', [
            ['payers', 'present'],
            ['signature', 'is', 'refused']
          ])
        );
        c.issue(
          'signature-missing',
          'signature',
          "{noteOrMissing}; get the patient's or a representative's signature",
          c.when('missing', 'No Signature', [
            ['payers', 'present'],
            ['signature', 'notOneOf', ['signed', 'exception', 'refused']]
          ])
        );
      })
  },
  {
    key: 'billing.check-pcs',
    name: 'Check Physician Certification',
    description:
      'A scheduled non-emergency transport has a physician certification statement (required for Medicare), signed within the 60 days before the trip when it covers repetitive transports, and not long after.',
    codes: PCS_CODES,
    definition: () =>
      onFacts(PCS_CODES, (c) => {
        const scheduled = c.when('scheduled', 'Scheduled Non-Emergency', [
          ['classification', 'is', 'scheduled'],
          ['emergency', 'isNot', true]
        ]);
        const message =
          'A scheduled non-emergency transport needs a physician certification statement';
        c.issue(
          'pcs-missing-medicare',
          'pcs',
          message,
          c.when('missingMedicare', 'No Certification, Medicare', [
            [scheduled, 'is', true],
            ['pcsOnFile', 'isNot', true],
            ['billsMedicare', 'is', true]
          ])
        );
        c.issue(
          'pcs-missing',
          'pcs',
          message,
          c.when('missing', 'No Certification', [
            [scheduled, 'is', true],
            ['pcsOnFile', 'isNot', true],
            ['billsMedicare', 'isNot', true]
          ])
        );
        c.issue(
          'pcs-undated',
          'pcs',
          'The physician certification statement has no signed date',
          c.when('undated', 'Certification Undated', [
            [scheduled, 'is', true],
            ['pcsOnFile', 'is', true],
            ['pcsDaysBeforeTrip', 'empty']
          ])
        );
        c.issue(
          'pcs-expired',
          'pcs',
          `The physician certification statement was signed {pcsDaysBeforeTrip} days before the trip; repetitive transports need one from the last ${PCS_VALID_DAYS} days`,
          c.when('expired', 'Certification Too Old', [
            [scheduled, 'is', true],
            ['pcsOnFile', 'is', true],
            ['pcsDaysBeforeTrip', 'gt', PCS_VALID_DAYS],
            ['pcsType', 'isNot', 'nonRepetitive']
          ])
        );
        c.issue(
          'pcs-late',
          'pcs',
          `The physician certification statement was signed more than ${PCS_LATE_DAYS} days after the trip`,
          c.when('late', 'Certification Signed Late', [
            [scheduled, 'is', true],
            ['pcsOnFile', 'is', true],
            ['pcsDaysBeforeTrip', 'lt', -PCS_LATE_DAYS]
          ])
        );
      })
  },
  {
    key: 'billing.check-prior-authorization',
    name: 'Check Prior Authorization',
    description:
      'A repetitive scheduled non-emergency Medicare transport past the third round trip has a prior authorization (UTN) that has not expired by the date of service.',
    codes: AUTHORIZATION_CODES,
    definition: () =>
      onFacts(AUTHORIZATION_CODES, (c) => {
        const scheduled = c.when('scheduled', 'Scheduled Non-Emergency Medicare', [
          ['classification', 'is', 'scheduled'],
          ['emergency', 'isNot', true],
          ['billsMedicare', 'is', true]
        ]);
        c.issue(
          'prior-authorization-missing',
          'priorAuthorization',
          `Repetitive scheduled Medicare transports need a prior authorization (UTN) after ${ROUND_TRIPS_WITHOUT_AUTHORIZATION} round trips; this is round trip {roundTrips}`,
          c.when('missing', 'No Authorization Past the Free Trips', [
            [scheduled, 'is', true],
            ['priorAuthorization', 'empty'],
            ['roundTrips', 'gt', ROUND_TRIPS_WITHOUT_AUTHORIZATION]
          ])
        );
        c.node('daysPast', 'std.math.negate', 'Days Past');
        c.wire('priorAuthorizationDaysLeft', 'daysPast.value');
        c.value('daysExpired', 'daysPast.result', 'number');
        c.issue(
          'prior-authorization-expired',
          'priorAuthorization',
          'The prior authorization expired {daysExpired} days before the trip',
          c.when('expired', 'Authorization Expired', [
            [scheduled, 'is', true],
            ['priorAuthorization', 'present'],
            ['priorAuthorizationDaysLeft', 'lt', 0]
          ])
        );
      })
  },
  {
    key: 'billing.check-abn',
    name: 'Check Advance Beneficiary Notice',
    description:
      'A Medicare transport expected to be denied has an ABN on file (else it is billed with GZ and the patient cannot be billed); an ABN is dated and is not used for an emergency.',
    codes: ABN_CODES,
    definition: () =>
      onFacts(ABN_CODES, (c) => {
        c.issue(
          'abn-missing',
          'abn',
          'Medicare is expected to deny this transport and no ABN is on file, so it is billed with GZ and the patient cannot be billed',
          c.when('missing', 'Denial Expected Without ABN', [
            ['billsMedicare', 'is', true],
            ['denialExpected', 'is', true],
            ['abnOnFile', 'isNot', true]
          ])
        );
        c.issue(
          'abn-undated',
          'abn',
          'The ABN on file has no signed date',
          c.when('undated', 'ABN Undated', [
            ['billsMedicare', 'is', true],
            ['abnOnFile', 'is', true],
            ['abnSignedOn', 'empty']
          ])
        );
        c.issue(
          'abn-emergency',
          'abn',
          'An ABN cannot be used for an emergency transport',
          c.when('emergency', 'ABN for an Emergency', [
            ['billsMedicare', 'is', true],
            ['abnOnFile', 'is', true],
            ['emergency', 'is', true]
          ])
        );
      })
  },
  {
    key: 'billing.check-msp',
    name: 'Check Medicare Secondary Payer',
    description:
      'A claim billing Medicare answers the MSP questions, and when another payer pays first (Medicare Secondary Payer rule) that payer is on the claim and billed before Medicare; Medicare is billed after another payer only when the MSP rule says why (SBR05).',
    codes: MSP_CODES,
    definition: () =>
      onFacts(MSP_CODES, (c) => {
        const unanswered = c.when(
          'unanswered',
          'An MSP Question Unanswered',
          MSP_ANSWERS.map((a): Test => [a, 'empty']),
          'any'
        );
        c.issue(
          'msp-unanswered',
          'msp',
          'Answer the Medicare Secondary Payer questions before billing Medicare',
          c.when('askMsp', 'Medicare Without MSP Answers', [
            ['billsMedicare', 'is', true],
            [unanswered, 'is', true]
          ])
        );
        const employer = c.when(
          'employerPlan',
          'Employer or Disability Plan',
          [
            ['mspEmployerPlan', 'is', true],
            ['mspDisability', 'is', true]
          ],
          'any'
        );
        c.issue(
          'msp-employer-size-missing',
          'msp',
          'Enter how many employees the employer that sponsors the group health plan has; Medicare pays second only from 20 (working aged) or 100 (disability)',
          c.when('askSize', 'Employer Size Missing', [
            ['billsMedicare', 'is', true],
            [employer, 'is', true],
            ['mspEmployerSize', 'empty']
          ])
        );
        c.node('msp', 'billing.medicare-secondary-payer', 'Medicare Secondary Payer');
        c.node('others', 'std.list.where', 'Payers Other Than Medicare', {
          config: { field: 'medicare', op: 'isNot', value: true }
        });
        c.node('firstPayer', 'std.list.first', 'First Payer');
        c.node('firstMedicare', 'std.object.get-field', 'First Payer Is Medicare', {
          config: { record: PAYER_TYPE, path: 'medicare' }
        });
        c.node('why', 'std.list.first', 'Main Reason');
        for (const a of [...MSP_ANSWERS, 'mspEmployerSize']) c.wire(a, `msp.${a}`);
        c.wire('payers', 'others.list', 'firstPayer.list');
        c.wire('firstPayer.item', 'firstMedicare.record');
        c.wire('msp.reasons', 'why.list');
        c.value('secondary', 'msp.medicareSecondary', 'boolean');
        c.value('otherPayers', 'others.count', 'integer');
        c.value('medicareFirst', 'firstMedicare.value', 'boolean');
        c.value('reason', 'why.item', 'string');
        c.issue(
          'msp-primary-missing',
          'payers',
          'Medicare pays second ({reason}), but no payer to bill first is on the claim',
          c.when('noPrimary', 'Medicare Second, Nobody First', [
            ['billsMedicare', 'is', true],
            ['secondary', 'is', true],
            ['otherPayers', 'is', 0]
          ])
        );
        c.issue(
          'msp-order',
          'payers',
          'Medicare pays second ({reason}); put the payer that pays first ahead of Medicare',
          c.when('wrongOrder', 'Medicare Second but Billed First', [
            ['billsMedicare', 'is', true],
            ['secondary', 'is', true],
            ['otherPayers', 'gt', 0],
            ['medicareFirst', 'is', true]
          ])
        );
        c.issue(
          'msp-type-missing',
          'msp',
          'Medicare is billed after another payer, but no Medicare Secondary Payer answer says why; answer the MSP questions or put Medicare first',
          c.when('noWhy', 'Medicare After Another Payer Without Why', [
            ['billsMedicare', 'is', true],
            ['secondary', 'isNot', true],
            ['payers', 'present'],
            ['medicareFirst', 'isNot', true]
          ])
        );
      })
  },
  {
    key: 'billing.check-facility',
    name: 'Check Facility Responsibility',
    description:
      'A claim the Facility Responsibility rule bills to a facility is billed to it rather than the payers, and a stay a payer reports on the date of service is confirmed by a biller.',
    codes: FACILITY_CODES,
    definition: () =>
      onFacts(FACILITY_CODES, (c) => {
        c.node('responsibility', 'billing.facility-responsibility', 'Facility Responsibility');
        c.node('why', 'std.list.first', 'Main Reason');
        c.node('facility', 'std.logic.choose', 'Facility, Else Any', {
          config: { mode: 'first', type: 'string', count: 2 },
          values: { option2: 'the facility' }
        });
        for (const p of [
          'recordedParty',
          'facilityStay',
          'emergency',
          'pickupFacility',
          'destinationFacility'
        ])
          c.wire(p, `responsibility.${p}`);
        c.wire('responsibility.reasons', 'why.list');
        c.wire('responsibility.facilityName', 'facility.option1');
        c.value('party', 'responsibility.party', 'string');
        c.value('reason', 'why.item', 'string');
        c.value('facilityName', 'facility.value', 'string');
        c.issue(
          'facility-responsible',
          'facility',
          '{reason}: bill {facilityName}, not the payers',
          c.when('responsible', 'A Facility Is Responsible', [
            ['responsibleParty', 'isNot', 'facility'],
            ['party', 'is', 'facility']
          ])
        );
        c.node('stays', 'std.list.map-rule', 'Check Each Payer Stay', {
          config: { rule: 'billing.check-payer-stay', version: 1, item: 'payer' }
        });
        c.node('stayIssues', 'std.list.flatten', 'Every Stay Issue');
        c.wire('payers', 'stays.list');
        c.wire('facilityStay', 'stays.facilityStay');
        c.wire('responsibleParty', 'stays.responsibleParty');
        c.wire('stays.issues', 'stayIssues.list');
        c.list('stayIssues.list');
      })
  },
  {
    key: 'billing.check-payers',
    name: 'Check Payers',
    description:
      'Each payer is linked to the payer directory, has a member ID and the insured when the patient is not the insured, and has not answered that the coverage is inactive; at most 11 payers.',
    codes: PAYER_CODES,
    definition: () =>
      onFacts(PAYER_CODES, (c) => {
        c.issue(
          'payer-missing',
          'payers',
          'No payer is on the claim, so the patient is billed',
          c.when('noPayer', 'No Payer', [['payers', 'empty']])
        );
        c.node('count', 'std.list.length', 'Payer Count');
        c.wire('payers', 'count.list');
        c.value('payerCount', 'count.length', 'integer');
        c.issue(
          'payers-over-limit',
          'payers',
          `An 837P claim carries at most ${MAX_PAYERS} payers`,
          c.when('tooMany', 'Too Many Payers', [['payerCount', 'gt', MAX_PAYERS]])
        );
        c.node('each', 'std.list.map-rule', 'Check Each Payer', {
          config: { rule: 'billing.check-one-payer', version: 1, item: 'payer' }
        });
        c.node('payerIssues', 'std.list.flatten', 'Every Payer Issue');
        c.wire('payers', 'each.list');
        c.wire('each.issues', 'payerIssues.list');
        c.list('payerIssues.list');
      })
  },
  {
    key: 'billing.check-timely-filing',
    name: 'Check Timely Filing',
    description:
      "Warns when a payer's filing limit has passed or is near, from its days left to file.",
    codes: FILING_CODES,
    definition: () =>
      onFacts(FILING_CODES, (c) => {
        c.node('each', 'std.list.map-rule', 'Check Each Payer Filing', {
          config: { rule: 'billing.check-payer-filing', version: 1, item: 'payer' }
        });
        c.node('filingIssues', 'std.list.flatten', 'Every Filing Issue');
        c.wire('payers', 'each.list');
        c.wire('each.issues', 'filingIssues.list');
        c.list('filingIssues.list');
      })
  }
];

const ONE_PAYER_CODES = {
  'payer-unlinked': 'blocking',
  'member-id-missing': 'blocking',
  'insured-missing': 'blocking',
  'coverage-inactive': 'blocking'
} as const;

const PAYER_RULES: CheckSpec[] = [
  {
    key: 'billing.check-one-payer',
    name: 'Check One Payer',
    description:
      'One payer is linked to the payer directory, has a member ID and the insured when the patient is not the insured, and has not answered that the coverage is inactive.',
    codes: ONE_PAYER_CODES,
    definition: () =>
      onPayer(ONE_PAYER_CODES, (c) => {
        const coverage = c.value('coverage', 'payer.coverageId', { id: 'coverage' });
        c.issue(
          'payer-unlinked',
          'payer',
          '{name} is not linked to the payer directory',
          c.when('unlinked', 'Not Linked', [['linked', 'isNot', true]]),
          { coverage }
        );
        c.issue(
          'member-id-missing',
          'memberId',
          'The member ID for {name} is missing',
          c.when('noMemberId', 'No Member ID', [['memberId', 'empty']]),
          { coverage }
        );
        c.issue(
          'insured-missing',
          'insured',
          "The insured's last name for {name} is missing",
          c.when('noInsured', 'Insured Needed but Missing', [
            ['needsInsured', 'is', true],
            ['insuredLastName', 'empty']
          ]),
          { coverage }
        );
        c.issue(
          'coverage-inactive',
          'payer',
          '{name} reports this coverage is not active; fix the member ID or remove the payer. {eligibilityNote}',
          c.when('inactive', 'Coverage Inactive', [['eligibility', 'is', 'inactive']]),
          { coverage }
        );
      })
  },
  {
    key: 'billing.check-payer-filing',
    name: 'Check Payer Filing',
    description:
      "Warns when one payer's filing limit has passed or is near, from its days left to file.",
    codes: FILING_CODES,
    definition: () =>
      onPayer(FILING_CODES, (c) => {
        const coverage = c.value('coverage', 'payer.coverageId', { id: 'coverage' });
        c.node('daysPast', 'std.math.negate', 'Days Past');
        c.wire('filingDaysLeft', 'daysPast.value');
        c.value('passedDays', 'daysPast.result', 'number');
        c.issue(
          'filing-limit-passed',
          'filing',
          'The {filingLimitDays}-day filing limit for {name} passed {passedDays} days ago; submit only with proof of timely filing',
          c.when('passed', 'Filing Limit Passed', [['filingDaysLeft', 'lt', 0]]),
          { coverage }
        );
        c.issue(
          'filing-limit-near',
          'filing',
          '{filingDaysLeft} days are left to file with {name} ({filingLimitDays}-day limit)',
          c.when('near', 'Filing Limit Near', [
            ['filingDaysLeft', 'gte', 0],
            ['filingDaysLeft', 'lte', FILING_WARNING_DAYS]
          ]),
          { coverage }
        );
      })
  },
  {
    key: 'billing.check-payer-stay',
    name: 'Check Payer Stay',
    description:
      'Asks a biller to confirm a facility stay one payer reports on the date of service, unless the claim is already billed to a facility or a stay is confirmed.',
    codes: { 'facility-stay-reported': 'warning' },
    definition: () =>
      onPayer(
        { 'facility-stay-reported': 'warning' },
        (c) => {
          const coverage = c.value('coverage', 'payer.coverageId', { id: 'coverage' });
          c.node('stayKind', 'std.table.lookup', 'Stay Kind', {
            config: {
              type: 'string',
              rows: [{ key: 'snf', value: 'skilled nursing facility' }],
              fallback: 'hospital inpatient'
            }
          });
          c.wire('stayReported', 'stayKind.key');
          c.value('stay', 'stayKind.value', 'string');
          c.issue(
            'facility-stay-reported',
            'facility',
            '{name} reports a {stay} stay on the date of service; confirm the facility stay',
            c.when('unconfirmed', 'Reported Stay Not Confirmed', [
              ['stayReported', 'present'],
              ['facilityStay', 'empty'],
              ['responsibleParty', 'isNot', 'facility']
            ]),
            { coverage }
          );
        },
        [
          d(
            'facilityStay',
            'string',
            'Facility Stay',
            'The facility stay a biller confirmed, if any.',
            true
          ),
          d('responsibleParty', 'string', 'Responsible Party', 'Who the claim is billed to.', true)
        ]
      )
  }
];

const REJECTION_IN = d(
  'rejection',
  'string',
  'Rejection',
  'Why the payer or clearinghouse rejected the last submission, when the claim is reviewed again after one.',
  true
);

const REJECTED_COVERAGE_IN = d(
  'rejectedCoverageId',
  { id: 'coverage' },
  'Rejected Payer',
  'The payer that rejected it.',
  true
);

const checkLastSubmission = (): GraphDef => {
  const g = rule(
    [REJECTION_IN, REJECTED_COVERAGE_IN],
    [P.issues('The rejection, before severities apply.')]
  );
  const c = checks(
    g,
    {
      node: 'entry',
      types: new Map<string, ValueType>([
        ['rejection', 'string'],
        ['rejectedCoverageId', { id: 'coverage' }]
      ])
    },
    REJECTION_CODES
  );
  c.issue(
    'submission-rejected',
    'submission',
    '{rejection}',
    c.when('rejected', 'Rejected', [['rejection', 'present']]),
    {
      coverage: 'rejectedCoverageId'
    }
  );
  return c.finish();
};

export const CHECK_RULES = CHECKS;

export const CHECK_SEVERITIES: Record<string, Severity> = Object.assign(
  {},
  REJECTION_CODES,
  ...CHECKS.map((c) => c.codes)
);

export { FACTS_IN as CHECK_FACTS_IN, REJECTED_COVERAGE_IN, REJECTION_IN };

export const checkRuleGraphs: SeedGraph[] = [
  ...PAYER_RULES.map((c) => asRule(c.key, c.name, c.description, c.definition())),
  ...CHECKS.map((c) => asRule(c.key, c.name, c.description, c.definition())),
  asRule(
    'billing.check-last-submission',
    'Check Last Submission',
    'Shows why the payer or clearinghouse rejected the last submission when the claim is reviewed again.',
    checkLastSubmission()
  )
];
