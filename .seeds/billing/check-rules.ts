import { billingModels, MAX_LOADED_MILES } from '@ugula/billing';
import type { ConditionOp, GraphDef, Json, PinSpec, ValueType } from '@ugula/graph';
import type { SeedGraph } from '../graphs.ts';
import {
  asRule,
  type Builder,
  condition,
  d,
  fixed,
  labelOf,
  listItem,
  orElse,
  P,
  type Port,
  rule,
  shared,
  T,
  type Test,
  template
} from './shared.ts';

type Severity = 'blocking' | 'warning';

type Clause = [name: string, op: ConditionOp, value?: Json] | Test;

const MAX_PAYERS = 11;
const MSP_ANSWERS = ['mspEmployerPlan', 'mspEsrd', 'mspDisability', 'mspAccident'];
export const ISSUE_TYPE = listItem(T.issues);

const LIMITS = {
  likelyMiles: ['Likely Loaded Miles', 100],
  maxMiles: ['Maximum Loaded Miles', MAX_LOADED_MILES],
  pcsValidDays: ['PCS Valid Days', 60],
  pcsLateDays: ['PCS Late Days', 2],
  filingWarningDays: ['Filing Warning Days', 30],
  freeRoundTrips: ['Round Trips Without Authorization', 3]
} as const;

type Limit = keyof typeof LIMITS;

const CHECK_LIMITS = shared.lookup(
  'billing.check-limits',
  'Check Limits',
  'The numbers the claim checks hold a claim to. Likely Loaded Miles: more loaded miles than this asks a biller to check the odometers. Maximum Loaded Miles: more loaded miles than this is an error to correct. PCS Valid Days: how many days before a repetitive trip its physician certification may be signed. PCS Late Days: how many days after the trip it may still be signed. Filing Warning Days: how many days before a filing limit a biller is warned. Round Trips Without Authorization: how many repetitive scheduled Medicare round trips go before a prior authorization is needed.',
  {
    type: 'integer',
    rows: Object.values(LIMITS).map(([key, value]) => ({ key, value }))
  }
);

export const checkLimit = (g: Builder, id: string, key: Limit) => {
  const [name] = LIMITS[key];
  g.add(id, 'std.table.lookup', { label: name, config: CHECK_LIMITS, values: { key: name } });
  return `${id}.value` as const;
};

const fieldsOf = (key: string) =>
  new Map(
    (billingModels.find((m) => m.key === key)?.fields ?? []).map((f) => [f.name, f.type] as const)
  );

const FACT_TYPES = fieldsOf('billing.check-facts');
const PAYER_TYPES = fieldsOf('billing.checked-payer');

const PLACEHOLDER = /\{(\w+)/g;

const placeholders = (text: string) => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))
];

type Source = { port: Port; type: ValueType };

export const camel = (code: string) => code.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

const checks = (
  g: Builder,
  record: { node: string; types: ReadonlyMap<string, ValueType> },
  codes: Record<string, Severity>
) => {
  const sources = new Map<string, Source>();
  const issues: Port[] = [];
  const lists: Port[] = [];
  const portOf = (name: string): Port => sources.get(name)?.port ?? `${record.node}.${name}`;
  const typeOf = (name: string): ValueType => {
    const type = sources.get(name)?.type ?? record.types.get(name);
    if (!type) throw new Error(`Unknown check value ${name}`);
    return type;
  };
  const known = (code: string) => {
    if (!codes[code]) throw new Error(`Check code ${code} has no severity`);
    return code;
  };
  const value = (name: string, port: Port, type: ValueType) => {
    sources.set(name, { port, type });
    return name;
  };
  const node = (
    id: string,
    type: string,
    label: string,
    opts: { config?: Json; values?: Record<string, Json> } = {}
  ) => g.add(id, type, { label, ...opts });
  const when = (id: string, label: string, clauses: Clause[], match: 'all' | 'any' = 'all') => {
    const tests = clauses.map((c): Test => {
      if (!Array.isArray(c)) return c;
      const [field, op, v] = c;
      return v === undefined ? { field, op } : { field, op, value: v };
    });
    const names = [...new Set(tests.flatMap((t) => (t.input ? [t.field, t.input] : [t.field])))];
    const result = condition(
      g,
      id,
      label,
      Object.fromEntries(names.map((n) => [n, [typeOf(n), portOf(n)]])),
      tests,
      match
    );
    return value(id, result, 'boolean');
  };
  const text = (id: string, label: string, pattern: string) =>
    value(
      id,
      template(
        g,
        id,
        label,
        pattern,
        Object.fromEntries(placeholders(pattern).map((n) => [n, portOf(n)]))
      ),
      'string'
    );
  const otherwise = (id: string, label: string, name: string, fallback: string) =>
    value(id, orElse(g, id, label, portOf(name), fixed(fallback)), 'string');
  const limit = (id: string, key: Limit) => value(id, checkLimit(g, id, key), 'integer');
  const negate = (id: string, label: string, name: string) => {
    g.add(id, 'std.math.negate', { label });
    g.wire(portOf(name), `${id}.value`);
    return value(id, `${id}.result`, 'number');
  };
  const issue = (
    code: string,
    field: string,
    message: string,
    when: string,
    opts: { coverage?: string; id?: string; label?: string } = {}
  ) => {
    const id = opts.id ?? `${camel(code)}Issue`;
    const label = opts.label ?? labelOf(code);
    const dynamic = placeholders(message).length > 0;
    g.add(id, 'billing.issue-when', {
      label,
      config: { code: known(code), field, message: dynamic ? '' : message }
    });
    g.wire(portOf(when), `${id}.when`);
    if (dynamic) g.wire(portOf(text(`${id}Message`, `${label} Message`, message)), `${id}.message`);
    if (opts.coverage) g.wire(portOf(opts.coverage), `${id}.coverageId`);
    issues.push(`${id}.issue`);
  };
  const each = (code: string, field: string, message: string, items: string, when?: string) => {
    const id = `${camel(code)}Issues`;
    g.add(id, 'billing.issue-for-each', {
      label: labelOf(code),
      config: { code: known(code), field, message }
    });
    g.wire(portOf(items), `${id}.items`);
    if (when) g.wire(portOf(when), `${id}.when`);
    lists.push(`${id}.issues`);
  };
  const perPayer = (
    id: string,
    label: string,
    [flat, flatLabel]: [string, string],
    check: string,
    more: string[] = []
  ) => {
    g.add(id, 'std.list.map-rule', { label, config: { rule: check, version: 1, item: 'payer' } });
    g.add(flat, 'std.list.flatten', { label: flatLabel });
    g.wire(portOf('payers'), `${id}.list`);
    for (const name of more) g.wire(portOf(name), `${id}.${name}`);
    g.wire(`${id}.issues`, `${flat}.list`);
    lists.push(`${flat}.list`);
  };
  const wire = (from: string, ...to: Port[]) => {
    for (const t of to) g.wire(from.includes('.') ? (from as Port) : portOf(from), t);
  };
  const finish = () => {
    const parts = [...lists];
    if (issues.length) {
      g.add('found', 'std.list.make', {
        label: 'Issues Found',
        config: { count: issues.length, type: ISSUE_TYPE }
      });
      for (const [i, p] of issues.entries()) g.wire(p, `found.item${i + 1}`);
      parts.unshift('found.list');
    }
    g.ret('return');
    const [only] = parts;
    if (parts.length === 1 && only) {
      g.wire(only, 'return.issues');
      return g.def;
    }
    g.add('all', 'std.list.join', {
      label: 'Every Issue',
      config: { count: parts.length, type: ISSUE_TYPE }
    });
    for (const [i, p] of parts.entries()) g.wire(p, `all.list${i + 1}`);
    g.wire('all.list', 'return.issues');
    return g.def;
  };
  return {
    when,
    value,
    node,
    issue,
    each,
    perPayer,
    otherwise,
    limit,
    negate,
    wire,
    finish
  };
};

type Checks = ReturnType<typeof checks>;

type CheckSpec = {
  key: string;
  name: string;
  description: string;
  codes: Record<string, Severity>;
  build: (c: Checks) => void;
};

type PayerCheckSpec = CheckSpec & { extra?: PinSpec[] };

const FACTS_IN = d(
  'facts',
  T.checkFacts,
  'Check Facts',
  'The saved claim as the checks read it, with the date math done.'
);

const PAYER_TYPE: ValueType = { object: Object.fromEntries(PAYER_TYPES) };

const PAYER_IN = d('payer', PAYER_TYPE, 'Payer', 'One payer on the claim, as the checks read it.');

const FOUND_OUT = P.issues('What this check found, before severities apply.');

const onFacts = ({ codes, build }: CheckSpec) => {
  const g = rule([FACTS_IN], [FOUND_OUT]);
  g.add('facts', 'billing.check-facts.break', { label: 'Check Facts' });
  g.wire('entry.facts', 'facts.facts');
  const c = checks(g, { node: 'facts', types: FACT_TYPES }, codes);
  build(c);
  return c.finish();
};

const onPayer = ({ codes, build, extra = [] }: PayerCheckSpec) => {
  const g = rule([PAYER_IN, ...extra], [FOUND_OUT]);
  g.add('payer', 'billing.checked-payer.break', { label: 'Payer' });
  g.wire('entry.payer', 'payer.payer');
  const c = checks(g, { node: 'payer', types: PAYER_TYPES }, codes);
  for (const p of extra) c.value(p.name, `entry.${p.name}`, p.type);
  c.value('coverage', 'payer.coverageId', { id: 'coverage' });
  build(c);
  return c.finish();
};

const ZIP_PLACES = [
  { place: 'pickup', field: 'pickup', name: 'Pickup', text: 'pickup' },
  { place: 'destination', field: 'destination', name: 'Destination', text: 'destination' },
  { place: 'patient', field: 'patientAddress', name: 'Patient', text: "patient's" }
];

const SCHEDULED: Clause[] = [
  ['classification', 'is', 'scheduled'],
  ['emergency', 'isNot', true]
];

const CHECKS: CheckSpec[] = [
  {
    key: 'billing.check-patient',
    name: 'Check Patient',
    description: 'Checks that the claim has a patient with a complete mailing address.',
    codes: { 'patient-missing': 'blocking', 'patient-address-missing': 'blocking' },
    build: (c) => {
      c.issue(
        'patient-missing',
        'patient',
        'The claim has no patient; choose the patient',
        c.when('noPatient', 'No Patient on the Claim', [['patientLinked', 'isNot', true]])
      );
      c.each(
        'patient-address-missing',
        'patientAddress',
        "The patient's {item} is missing",
        'patientAddressMissing'
      );
    }
  },
  {
    key: 'billing.check-report',
    name: 'Check Report',
    description: 'Checks that the report has a PCR number and a date of service.',
    codes: { 'pcr-number-missing': 'warning', 'service-date-missing': 'blocking' },
    build: (c) => {
      c.issue(
        'pcr-number-missing',
        'pcrNumber',
        'The report has no PCR number, so a corrected report opens a new claim',
        c.when('noPcrNumber', 'No PCR Number', [['pcrNumber', 'empty']])
      );
      c.issue(
        'service-date-missing',
        'serviceDate',
        'The date of service is missing; enter the date of the trip',
        c.when('noServiceDate', 'No Date of Service', [['serviceDate', 'empty']])
      );
    }
  },
  {
    key: 'billing.check-service',
    name: 'Check Service',
    description:
      'Checks that the trip is billable, has a level of service and says whether it was an emergency; a scheduled trip billed as an emergency is worth checking.',
    codes: {
      'not-billable': 'blocking',
      'level-missing': 'blocking',
      'emergency-missing': 'blocking',
      'scheduled-emergency': 'warning'
    },
    build: (c) => {
      c.issue(
        'not-billable',
        'classification',
        'The trip is classified as not billable; choose the classification to bill',
        c.when('notBillable', 'Classified as Not Billable', [
          ['classification', 'is', 'notBillable']
        ])
      );
      c.issue(
        'level-missing',
        'level',
        'Choose a level of service: BLS, ALS1, ALS2, SCT',
        c.when('noLevel', 'No Valid Level of Service', [['levelValid', 'isNot', true]])
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
        c.when('scheduledEmergency', 'Scheduled Trip Billed as an Emergency', [
          ['classification', 'is', 'scheduled'],
          ['emergency', 'is', true]
        ]),
        { label: 'Scheduled Emergency' }
      );
    }
  },
  {
    key: 'billing.check-charges',
    name: 'Check Charges',
    description: 'Checks that the claim has charge lines and its total adds up to them.',
    codes: { 'lines-missing': 'blocking', 'lines-total': 'blocking' },
    build: (c) => {
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
        c.when('offTotal', 'Total Does Not Add Up', [
          ['lineCount', 'isNot', 0],
          ['linesAddUp', 'isNot', true]
        ]),
        { label: 'Lines Off the Total' }
      );
    }
  },
  {
    key: 'billing.check-diagnoses',
    name: 'Check Diagnoses',
    description:
      'Checks that the claim has at least one ICD-10 diagnosis; for trips in the year of the loaded ICD-10-CM codes, every diagnosis is an ICD-10-CM code and none is a category that needs more characters to bill.',
    codes: {
      'diagnosis-missing': 'blocking',
      'diagnosis-unknown': 'blocking',
      'diagnosis-not-billable': 'blocking'
    },
    build: (c) => {
      c.issue(
        'diagnosis-missing',
        'diagnoses',
        'At least one diagnosis code is required; add the ICD-10-CM code of the main complaint',
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
    }
  },
  {
    key: 'billing.check-locations',
    name: 'Check Addresses',
    description:
      'Checks that the pickup has a full street address; a transport also has a full destination address and a valid origin/destination modifier. Medicare prices the trip by the pickup ZIP code, so it must be in the CMS ZIP file, with its ZIP+4 where CMS splits the ZIP code between localities; and every ZIP code should belong to the state of its address (GeoNames).',
    codes: {
      'pickup-address-missing': 'blocking',
      'destination-address-missing': 'blocking',
      'origin-destination-missing': 'blocking',
      'pickup-zip-not-priced': 'blocking',
      'pickup-zip4-needed': 'warning',
      'zip-state-mismatch': 'warning'
    },
    build: (c) => {
      c.each('pickup-address-missing', 'pickup', 'The pickup {item} is missing', 'pickupMissing');
      c.each(
        'destination-address-missing',
        'destination',
        'The destination {item} is missing',
        'destinationMissing',
        c.when('transported', 'Transported', [['transports', 'is', true]])
      );
      c.issue(
        'origin-destination-missing',
        'originDestination',
        'The origin/destination modifier is missing; choose where the trip started and ended',
        c.when('noModifier', 'Transported Without a Modifier', [
          ['transports', 'is', true],
          ['originDestinationValid', 'isNot', true]
        ])
      );
      c.issue(
        'pickup-zip-not-priced',
        'pickup',
        'Medicare does not price the pickup ZIP code (it is not in the CMS ZIP file); correct it',
        c.when('zipNotPriced', 'Medicare Does Not Price the Pickup ZIP', [
          ['billsMedicare', 'is', true],
          ['pickupZipPriced', 'is', false]
        ])
      );
      c.issue(
        'pickup-zip4-needed',
        'pickup',
        'CMS splits the pickup ZIP code between Medicare localities; add its ZIP+4 so the trip is priced for the right one',
        c.when('zip4Needed', 'Medicare Needs the Pickup ZIP+4', [
          ['billsMedicare', 'is', true],
          ['pickupZipNeedsPlusFour', 'is', true]
        ])
      );
      for (const { place, field, name, text } of ZIP_PLACES)
        c.issue(
          'zip-state-mismatch',
          field,
          `The ${text} ZIP code belongs to another state than its address; correct the ZIP code or the state`,
          c.when(`${place}ZipState`, `${name} ZIP in Another State`, [
            ['zipStateMismatches', 'is', place]
          ]),
          { id: `${place}ZipStateIssue`, label: `${name} ZIP State Mismatch` }
        );
    }
  },
  {
    key: 'billing.check-transport-reason',
    name: 'Check Transport Reason',
    description: 'Checks that a transport has an ambulance transport reason (CR104).',
    codes: { 'transport-reason-missing': 'blocking' },
    build: (c) =>
      c.issue(
        'transport-reason-missing',
        'transportReason',
        'The ambulance transport reason is missing; choose why the patient was transported',
        c.when('noReason', 'Transported Without a Reason', [
          ['transports', 'is', true],
          ['transportReason', 'empty']
        ])
      )
  },
  {
    key: 'billing.check-conditions',
    name: 'Check Ambulance Conditions',
    description:
      'Checks that a non-emergency Medicare transport documents the ambulance conditions (CRC) that made an ambulance necessary, such as bed-confined or moved by stretcher.',
    codes: { 'conditions-missing': 'warning' },
    build: (c) =>
      c.issue(
        'conditions-missing',
        'pcs',
        'The report documents no ambulance condition (such as bed-confined or moved by stretcher) for this non-emergency Medicare transport, so none is billed; document it on the report or the physician certification',
        c.when('noConditions', 'Non-Emergency Medicare Transport Without Conditions', [
          ['transports', 'is', true],
          ['emergency', 'is', false],
          ['billsMedicare', 'is', true],
          ['conditionsDocumented', 'isNot', true]
        ])
      )
  },
  {
    key: 'billing.check-trip-times',
    name: 'Check Trip Times',
    description:
      'Checks that a transport records when the patient left the scene and arrived at the destination, in order.',
    codes: { 'trip-times-missing': 'warning', 'trip-times-order': 'warning' },
    build: (c) => {
      c.issue(
        'trip-times-missing',
        'times',
        'The report does not say when the patient left the scene and arrived at the destination',
        c.when('noTimes', 'Transported Without Trip Times', [
          ['transports', 'is', true],
          ['timesRecorded', 'isNot', true]
        ])
      );
      c.issue(
        'trip-times-order',
        'times',
        'The trip times are out of order; correct when the unit arrived, left the scene and arrived at the destination',
        c.when('timesOutOfOrder', 'Trip Times Out of Order', [
          ['transports', 'is', true],
          ['timesRecorded', 'is', true],
          ['timesInOrder', 'isNot', true]
        ]),
        { label: 'Trip Times Out of Order' }
      );
    }
  },
  {
    key: 'billing.check-mileage',
    name: 'Check Mileage',
    description:
      'Checks that a transport has loaded miles within the Maximum Loaded Miles of the Check Limits table, and more than the Likely Loaded Miles of the Check Limits table are worth checking; a trip without transport has none.',
    codes: {
      'loaded-miles-missing': 'blocking',
      'loaded-miles-over-limit': 'blocking',
      'loaded-miles-unlikely': 'warning',
      'miles-without-transport': 'warning'
    },
    build: (c) => {
      const miles = c.when('hasMiles', 'Has Loaded Miles', [['loadedMiles', 'gt', 0]]);
      c.issue(
        'loaded-miles-missing',
        'loadedMiles',
        'Loaded miles are missing; enter the miles driven with the patient on board',
        c.when('noMiles', 'Transported Without Loaded Miles', [
          ['transports', 'is', true],
          [miles, 'isNot', true]
        ])
      );
      const maxMiles = c.limit('maxMiles', 'maxMiles');
      c.issue(
        'loaded-miles-over-limit',
        'loadedMiles',
        'Loaded miles are over {maxMiles}',
        c.when('overLimit', 'Loaded Miles Over the Limit', [
          ['transports', 'is', true],
          { field: 'loadedMiles', op: 'gt', input: maxMiles }
        ])
      );
      const likely = c.limit('likelyMiles', 'likelyMiles');
      c.issue(
        'loaded-miles-unlikely',
        'loadedMiles',
        'Loaded miles are over {likelyMiles}; check the odometers',
        c.when('unlikely', 'Unlikely Loaded Miles', [
          ['transports', 'is', true],
          { field: 'loadedMiles', op: 'gt', input: likely },
          { field: 'loadedMiles', op: 'lte', input: maxMiles }
        ])
      );
      c.issue(
        'miles-without-transport',
        'loadedMiles',
        'Loaded miles are recorded on a trip without transport; clear them or correct the classification',
        c.when('milesNoTransport', 'Loaded Miles Without Transport', [
          ['transports', 'isNot', true],
          [miles, 'is', true]
        ])
      );
    }
  },
  {
    key: 'billing.check-signature',
    name: 'Check Billing Signature',
    description:
      'Checks that the patient or a representative signed the release for billing, or a documented exception explains why not, when the claim bills a payer.',
    codes: {
      'signature-exception': 'warning',
      'signature-refused': 'blocking',
      'signature-missing': 'blocking'
    },
    build: (c) => {
      c.otherwise('note', 'Exception Note', 'signatureNote', 'The patient could not sign');
      c.otherwise('missingNote', 'Missing Signature Note', 'signatureNote', 'No billing signature');
      c.issue(
        'signature-exception',
        'signature',
        "{note}; keep the crew statement and the receiving facility's name and date with the claim",
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
        "{missingNote}; get the patient's or a representative's signature",
        c.when('missing', 'No Billing Signature', [
          ['payers', 'present'],
          ['signature', 'notOneOf', ['signed', 'exception', 'refused']]
        ])
      );
    }
  },
  {
    key: 'billing.check-pcs',
    name: 'Check Physician Certification',
    description:
      'Checks that a scheduled non-emergency transport has a physician certification statement (required for Medicare); one for repetitive transports is signed within the PCS Valid Days before the trip, and none later than the PCS Late Days after it (Check Limits table).',
    codes: {
      'pcs-missing-medicare': 'blocking',
      'pcs-missing': 'warning',
      'pcs-undated': 'warning',
      'pcs-expired': 'warning',
      'pcs-late': 'warning'
    },
    build: (c) => {
      const scheduled = c.when('scheduled', 'Scheduled Non-Emergency', SCHEDULED);
      const message =
        'A scheduled non-emergency transport needs a physician certification statement; add it to the claim';
      c.issue(
        'pcs-missing-medicare',
        'pcs',
        message,
        c.when('missingMedicare', 'No PCS for Medicare', [
          [scheduled, 'is', true],
          ['pcsOnFile', 'isNot', true],
          ['billsMedicare', 'is', true]
        ]),
        { label: 'PCS Missing for Medicare' }
      );
      c.issue(
        'pcs-missing',
        'pcs',
        message,
        c.when('missing', 'No PCS', [
          [scheduled, 'is', true],
          ['pcsOnFile', 'isNot', true],
          ['billsMedicare', 'isNot', true]
        ])
      );
      c.issue(
        'pcs-undated',
        'pcs',
        'The physician certification statement has no signed date; enter the date it was signed',
        c.when('undated', 'PCS Undated', [
          [scheduled, 'is', true],
          ['pcsOnFile', 'is', true],
          ['pcsDaysBeforeTrip', 'empty']
        ])
      );
      const validDays = c.limit('validDays', 'pcsValidDays');
      c.issue(
        'pcs-expired',
        'pcs',
        'The physician certification statement was signed {pcsDaysBeforeTrip} days before the trip; repetitive transports need one from the last {validDays} days',
        c.when('expired', 'PCS Too Old', [
          [scheduled, 'is', true],
          ['pcsOnFile', 'is', true],
          { field: 'pcsDaysBeforeTrip', op: 'gt', input: validDays },
          ['pcsType', 'isNot', 'nonRepetitive']
        ])
      );
      const daysAfter = c.negate('daysAfter', 'Days Signed After the Trip', 'pcsDaysBeforeTrip');
      const lateDays = c.limit('lateDays', 'pcsLateDays');
      c.issue(
        'pcs-late',
        'pcs',
        'The physician certification statement was signed more than {lateDays} days after the trip',
        c.when('late', 'PCS Signed Late', [
          [scheduled, 'is', true],
          ['pcsOnFile', 'is', true],
          { field: daysAfter, op: 'gt', input: lateDays }
        ])
      );
    }
  },
  {
    key: 'billing.check-prior-authorization',
    name: 'Check Prior Authorization',
    description:
      'Checks that a repetitive scheduled non-emergency Medicare transport past the Round Trips Without Authorization of the Check Limits table has a prior authorization (UTN) that has not expired by the date of service.',
    codes: { 'prior-authorization-missing': 'warning', 'prior-authorization-expired': 'warning' },
    build: (c) => {
      const scheduled = c.when('scheduled', 'Scheduled Non-Emergency Medicare', [
        ...SCHEDULED,
        ['billsMedicare', 'is', true]
      ]);
      const freeTrips = c.limit('freeTrips', 'freeRoundTrips');
      c.issue(
        'prior-authorization-missing',
        'priorAuthorization',
        'Repetitive scheduled Medicare transports need a prior authorization (UTN) after {freeTrips} round trips; this is round trip {roundTrips}',
        c.when('missing', 'No Authorization Past the Free Trips', [
          [scheduled, 'is', true],
          ['priorAuthorization', 'empty'],
          { field: 'roundTrips', op: 'gt', input: freeTrips }
        ])
      );
      const daysExpired = c.negate('daysPast', 'Days Expired', 'priorAuthorizationDaysLeft');
      c.issue(
        'prior-authorization-expired',
        'priorAuthorization',
        `The prior authorization expired {${daysExpired}} days before the trip`,
        c.when('expired', 'Authorization Expired', [
          [scheduled, 'is', true],
          ['priorAuthorization', 'present'],
          ['priorAuthorizationDaysLeft', 'lt', 0]
        ])
      );
    }
  },
  {
    key: 'billing.check-abn',
    name: 'Check Advance Beneficiary Notice',
    description:
      'Checks that a Medicare transport expected to be denied has an ABN on file (else it is billed with GZ and the patient cannot be billed); an ABN is dated and is not used for an emergency.',
    codes: { 'abn-missing': 'warning', 'abn-undated': 'warning', 'abn-emergency': 'warning' },
    build: (c) => {
      c.issue(
        'abn-missing',
        'abn',
        'Medicare is expected to deny this transport and no ABN is on file, so it is billed with GZ and the patient cannot be billed',
        c.when('missing', 'Denial Expected Without an ABN', [
          ['billsMedicare', 'is', true],
          ['denialExpected', 'is', true],
          ['abnOnFile', 'isNot', true]
        ])
      );
      c.issue(
        'abn-undated',
        'abn',
        'The ABN on file has no signed date; enter the date it was signed',
        c.when('undated', 'ABN Undated', [
          ['billsMedicare', 'is', true],
          ['abnOnFile', 'is', true],
          ['abnSignedOn', 'empty']
        ])
      );
      c.issue(
        'abn-emergency',
        'abn',
        'An ABN cannot be used for an emergency transport; remove it or correct the emergency response',
        c.when('emergency', 'ABN on an Emergency', [
          ['billsMedicare', 'is', true],
          ['abnOnFile', 'is', true],
          ['emergency', 'is', true]
        ]),
        { label: 'ABN for an Emergency' }
      );
    }
  },
  {
    key: 'billing.check-msp',
    name: 'Check Medicare Secondary Payer',
    description:
      'Checks that a claim billing Medicare answers the MSP questions, and when another payer pays first (Medicare Secondary Payer rule) that payer is on the claim and billed before Medicare; Medicare is billed after another payer only when the MSP rule says why (SBR05).',
    codes: {
      'msp-unanswered': 'warning',
      'msp-employer-size-missing': 'warning',
      'msp-primary-missing': 'blocking',
      'msp-order': 'blocking',
      'msp-type-missing': 'blocking'
    },
    build: (c) => {
      const unanswered = c.when(
        'unanswered',
        'An MSP Question Unanswered',
        MSP_ANSWERS.map((a): Clause => [a, 'empty']),
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
      c.node('why', 'std.list.first', 'Main MSP Reason');
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
        'Medicare pays second ({reason}), but no payer to bill first is on the claim; add that payer ahead of Medicare',
        c.when('noPrimary', 'Medicare Pays Second, No Payer First', [
          ['billsMedicare', 'is', true],
          ['secondary', 'is', true],
          ['otherPayers', 'is', 0]
        ])
      );
      c.issue(
        'msp-order',
        'payers',
        'Medicare pays second ({reason}); put the payer that pays first ahead of Medicare',
        c.when('wrongOrder', 'Medicare Pays Second but Is Billed First', [
          ['billsMedicare', 'is', true],
          ['secondary', 'is', true],
          ['otherPayers', 'gt', 0],
          ['medicareFirst', 'is', true]
        ]),
        { label: 'MSP Payer Order' }
      );
      c.issue(
        'msp-type-missing',
        'msp',
        'Medicare is billed after another payer, but no Medicare Secondary Payer answer says why; answer the MSP questions or put Medicare first',
        c.when('noWhy', 'Medicare After Another Payer Without a Reason', [
          ['billsMedicare', 'is', true],
          ['secondary', 'isNot', true],
          ['payers', 'present'],
          ['medicareFirst', 'isNot', true]
        ])
      );
    }
  },
  {
    key: 'billing.check-facility',
    name: 'Check Facility Responsibility',
    description:
      'Checks that a claim the Facility Responsibility rule bills to a facility is billed to it rather than the payers, and a stay a payer reports on the date of service is confirmed by a biller.',
    codes: { 'facility-responsible': 'blocking', 'facility-stay-reported': 'warning' },
    build: (c) => {
      c.node('responsibility', 'billing.facility-responsibility', 'Facility Responsibility');
      c.node('why', 'std.list.first', 'Main Reason');
      for (const p of [
        'recordedParty',
        'facilityStay',
        'emergency',
        'pickupFacility',
        'destinationFacility'
      ])
        c.wire(p, `responsibility.${p}`);
      c.wire('responsibility.reasons', 'why.list');
      c.value('party', 'responsibility.party', 'string');
      c.value('reason', 'why.item', 'string');
      c.value('responsibleFacility', 'responsibility.facilityName', 'string');
      c.otherwise(
        'facility',
        'Facility Name, Else the Facility',
        'responsibleFacility',
        'the facility'
      );
      c.issue(
        'facility-responsible',
        'facility',
        '{reason}: bill {facility}, not the payers',
        c.when('responsible', 'A Facility Is Responsible', [
          ['responsibleParty', 'isNot', 'facility'],
          ['party', 'is', 'facility']
        ])
      );
      c.perPayer(
        'stays',
        'Check Each Payer Stay',
        ['stayIssues', 'Every Stay Issue'],
        'billing.check-payer-stay',
        ['facilityStay', 'responsibleParty']
      );
    }
  },
  {
    key: 'billing.check-payers',
    name: 'Check Payers',
    description: `Checks the payers on the claim: at least one (else the patient is billed), at most ${MAX_PAYERS} on an 837P claim, and each one with Check One Payer: linked, with a member ID and insured, an active coverage and time left to file.`,
    codes: {
      'payer-missing': 'warning',
      'payers-over-limit': 'blocking',
      'payer-unlinked': 'blocking',
      'member-id-missing': 'blocking',
      'insured-missing': 'blocking',
      'coverage-inactive': 'blocking',
      'filing-limit-passed': 'warning',
      'filing-limit-near': 'warning'
    },
    build: (c) => {
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
        `An 837P claim carries at most ${MAX_PAYERS} payers; remove the payers that will not pay`,
        c.when('tooMany', 'Too Many Payers', [['payerCount', 'gt', MAX_PAYERS]])
      );
      c.perPayer(
        'each',
        'Check Each Payer',
        ['payerIssues', 'Every Payer Issue'],
        'billing.check-one-payer'
      );
    }
  }
];

const PAYER_RULES: PayerCheckSpec[] = [
  {
    key: 'billing.check-one-payer',
    name: 'Check One Payer',
    description:
      'Finds what stops one payer from being billed: not linked to the payer directory, no member ID, no insured when the patient is not the insured, or a coverage the payer says is inactive; and warns when its filing limit has passed or is within the Filing Warning Days of the Check Limits table.',
    codes: {
      'payer-unlinked': 'blocking',
      'member-id-missing': 'blocking',
      'insured-missing': 'blocking',
      'coverage-inactive': 'blocking',
      'filing-limit-passed': 'warning',
      'filing-limit-near': 'warning'
    },
    build: (c) => {
      c.issue(
        'payer-unlinked',
        'payer',
        '{name} is not linked to the payer directory; choose the payer from the directory',
        c.when('unlinked', 'Not Linked to the Payer Directory', [['linked', 'isNot', true]]),
        { coverage: 'coverage' }
      );
      c.issue(
        'member-id-missing',
        'memberId',
        'The member ID for {name} is missing',
        c.when('noMemberId', 'No Member ID', [['memberId', 'empty']]),
        { coverage: 'coverage' }
      );
      c.issue(
        'insured-missing',
        'insured',
        "The insured's last name for {name} is missing",
        c.when('noInsured', 'Insured Needed but Missing', [
          ['needsInsured', 'is', true],
          ['insuredLastName', 'empty']
        ]),
        { coverage: 'coverage' }
      );
      c.issue(
        'coverage-inactive',
        'payer',
        '{name} reports this coverage is not active; fix the member ID or remove the payer. {eligibilityNote}',
        c.when('inactive', 'Coverage Inactive', [['eligibility', 'is', 'inactive']]),
        { coverage: 'coverage' }
      );
      const passedDays = c.negate('daysPast', 'Days Past the Limit', 'filingDaysLeft');
      c.issue(
        'filing-limit-passed',
        'filing',
        `The {filingLimitDays}-day filing limit for {name} passed {${passedDays}} days ago; submit only with proof of timely filing`,
        c.when('passed', 'Filing Limit Passed', [['filingDaysLeft', 'lt', 0]]),
        { coverage: 'coverage' }
      );
      const warningDays = c.limit('warningDays', 'filingWarningDays');
      c.issue(
        'filing-limit-near',
        'filing',
        '{filingDaysLeft} days are left to file with {name} ({filingLimitDays}-day limit)',
        c.when('near', 'Filing Limit Near', [
          ['filingDaysLeft', 'gte', 0],
          { field: 'filingDaysLeft', op: 'lte', input: warningDays }
        ]),
        { coverage: 'coverage' }
      );
    }
  },
  {
    key: 'billing.check-payer-stay',
    name: 'Check Payer Stay',
    description:
      'Asks a biller to confirm a facility stay one payer reports on the date of service, unless the claim is already billed to a facility or a stay is confirmed.',
    codes: { 'facility-stay-reported': 'warning' },
    extra: [
      d(
        'facilityStay',
        'string',
        'Facility Stay',
        'The facility stay a biller confirmed, if any.',
        true
      ),
      d('responsibleParty', 'string', 'Responsible Party', 'Who the claim is billed to.', true)
    ],
    build: (c) => {
      c.node('stayKind', 'std.table.lookup', 'Kind of Stay', {
        config: shared.lookup(
          'billing.reported-stay-kinds',
          'Reported Stay Kinds',
          'How the issue a biller sees names a facility stay a payer reports, by the kind of stay: snf is a skilled nursing facility stay, and any other kind a hospital inpatient stay.',
          {
            type: 'string',
            rows: [{ key: 'snf', value: 'skilled nursing facility' }],
            fallback: 'hospital inpatient'
          }
        )
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
        { coverage: 'coverage' }
      );
    }
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

const REJECTION_CODES = { 'submission-rejected': 'warning' } as const;

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
    c.when('rejected', 'Last Submission Rejected', [['rejection', 'present']]),
    { coverage: 'rejectedCoverageId' }
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
  ...PAYER_RULES.map((c) => asRule(c.key, c.name, c.description, onPayer(c))),
  ...CHECKS.map((c) => asRule(c.key, c.name, c.description, onFacts(c))),
  asRule(
    'billing.check-last-submission',
    'Check Last Submission',
    'Shows why the payer or clearinghouse rejected the last submission when the claim is reviewed again.',
    checkLastSubmission()
  )
];
