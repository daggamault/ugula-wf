import { type PricedLine, roundUnits } from './charges.ts';
import {
  type ClaimDetails,
  DIAGNOSIS_LIMIT,
  type InsuredRelationship,
  SELF
} from './claim-details.ts';
import { type Adjudication, type Adjustment, isAdjustmentGroup } from './claims.ts';
import { ZIP_PLUS_4_PATTERN } from './geo.ts';
import type { Address, Sex } from './patients.ts';
import { isValidNpi } from './payers.ts';
import { recordOf, textOrNull } from './values.ts';

export type Submitter = {
  organizationName: string;
  npi: string;
  taxId: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  submitterId: string | null;
  receiverId: string | null;
  receiverName: string | null;
  production: boolean;
};

export type BatchPayer = {
  name: string;
  payerId: string | null;
  claimFiling: string | null;
  memberId: string | null;
  groupId: string | null;
  relationship: InsuredRelationship;
  insuredFirstName: string | null;
  insuredLastName: string | null;
};

export type PriorPayer = BatchPayer & Adjudication;

export type BatchClaim = {
  claimId: string;
  payerClaimNumber: string | null;
  payer: BatchPayer;
  priorPayers: PriorPayer[];
  patient: Address & { firstName: string; lastName: string; birthDate: string; sex: Sex | null };
  details: ClaimDetails;
  emergency: boolean;
  loadedMiles: number | null;
  lines: PricedLine[];
};

type Envelope = { controlNumber: number; createdAt: Date };

export const MAX_CONTROL_NUMBER = 999_999_999;

const AMBULANCE_TAXONOMY = '3416L0300X';

const RESPONSIBILITY = 'PSTABCDEFGH';

const REPLACEMENT_FREQUENCIES: readonly string[] = ['7', '8'];

const ZIP_PLUS_4 = new RegExp(ZIP_PLUS_4_PATTERN);

const clean = (x: string | null | undefined, max = 60) =>
  (x ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[~*:^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .toUpperCase();

const safe = (x: string) => x.replace(/[^\x20-\x7E]/g, '').replace(/[~*:^]/g, ' ');

type Element = string | readonly string[];

type Segment = readonly Element[];

const dollars = (cents: number) => String(cents / 100);

const yyyymmdd = (date: string) => date.slice(0, 10).replaceAll('-', '');

export const submitterIssues = (s: Submitter | null) =>
  !s
    ? ['Add a billing profile in Settings']
    : [
        ...(isValidNpi(s.npi) ? [] : ['The billing NPI is invalid']),
        ...(ZIP_PLUS_4.test(s.postalCode)
          ? []
          : ['The billing ZIP code needs all 9 digits (ZIP+4) in Settings']),
        ...(s.submitterId ? [] : ['Add the clearinghouse submitter ID in Settings']),
        ...(s.receiverId ? [] : ['Add the clearinghouse receiver ID in Settings'])
      ];

type X837Location = Address & { name: string | null };

type X837Line = {
  code: string;
  modifiers: string[];
  chargeCents: number;
  units: number;
  serviceDate: string;
};

type X837OtherPayer = Adjudication & {
  name: string;
  payerId: string;
  claimFiling: string;
  memberId: string;
  groupId: string | null;
  relationship: string;
  lastName: string;
  firstName: string | null;
};

export type X837Claim = {
  claimId: string;
  placeOfService: string;
  frequency: string;
  payerClaimNumber: string | null;
  subscriber: {
    relationship: string;
    lastName: string;
    firstName: string | null;
    memberId: string;
    groupId: string | null;
  };
  patient: Address & {
    lastName: string;
    firstName: string | null;
    birthDate: string;
    sex: string;
  };
  payer: { name: string; payerId: string; claimFiling: string };
  otherPayers: X837OtherPayer[];
  transportReason: string | null;
  loadedMiles: number | null;
  conditionCodes: string[];
  diagnoses: string[];
  pickup: X837Location;
  dropoff: X837Location;
  lines: X837Line[];
};

const list = (x: unknown) => (Array.isArray(x) ? x : []);

const strs = (x: unknown) => list(x).flatMap((v) => textOrNull(v) ?? []);

const need = (value: string | null, what: string) => {
  if (value === null) throw new Error(`The 837P claim needs ${what}`);
  return value;
};

const positive = (x: unknown, what: string) => {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) {
    throw new Error(`The 837P claim needs ${what}`);
  }
  return x;
};

const cents = (x: unknown, what: string) => {
  if (typeof x !== 'number' || !Number.isInteger(x)) {
    throw new Error(`The 837P claim needs ${what} in cents`);
  }
  return x;
};

const address = (r: Record<string, unknown>): Address => ({
  addressLine: textOrNull(r.addressLine),
  city: textOrNull(r.city),
  state: textOrNull(r.state),
  postalCode: textOrNull(r.postalCode)
});

const where = (x: unknown): X837Location => {
  const r = recordOf(x);
  return { name: textOrNull(r.name), ...address(r) };
};

const readX837Line = (x: unknown, i: number): X837Line => {
  const r = recordOf(x);
  const chargeCents = r.chargeCents;
  if (typeof chargeCents !== 'number' || !Number.isInteger(chargeCents) || chargeCents < 0) {
    throw new Error(`Service line ${i + 1} needs a charge in cents`);
  }
  return {
    code: need(textOrNull(r.code), `a code on service line ${i + 1}`),
    modifiers: strs(r.modifiers).slice(0, 4),
    chargeCents,
    units: roundUnits(positive(r.units, `units on service line ${i + 1}`)),
    serviceDate: need(textOrNull(r.serviceDate), `a date on service line ${i + 1}`)
  };
};

type Person = { lastName: string; firstName: string | null };

const insured = (r: Record<string, unknown>, relationship: string, patient: Person, of: string) =>
  relationship === SELF
    ? {
        lastName: textOrNull(r.lastName) ?? patient.lastName,
        firstName: textOrNull(r.firstName) ?? patient.firstName
      }
    : {
        lastName: need(textOrNull(r.lastName), `the last name of the insured on ${of}`),
        firstName: textOrNull(r.firstName)
      };

const readAdjustment = (x: unknown): Adjustment[] => {
  const r = recordOf(x);
  const reason = textOrNull(r.reason);
  return isAdjustmentGroup(r.group) && reason && Number.isInteger(r.cents) && r.cents !== 0
    ? [{ group: r.group, reason, cents: r.cents as number }]
    : [];
};

const readOtherPayer =
  (patient: Person) =>
  (x: unknown, i: number): X837OtherPayer => {
    const r = recordOf(x);
    const of = `other payer ${i + 1}`;
    const relationship = need(textOrNull(r.relationship), `a relationship on ${of}`);
    return {
      name: need(textOrNull(r.name), `a name on ${of}`),
      payerId: need(textOrNull(r.payerId), `a payer ID on ${of}`),
      claimFiling: need(textOrNull(r.claimFiling), `a claim filing indicator on ${of}`),
      memberId: need(textOrNull(r.memberId), `a member ID on ${of}`),
      groupId: textOrNull(r.groupId),
      relationship,
      ...insured(r, relationship, patient, of),
      paidCents: cents(r.paidCents, `the amount ${of} paid`),
      adjustedCents: cents(r.adjustedCents, `the amount ${of} adjusted`),
      adjustments: list(r.adjustments).flatMap(readAdjustment),
      paidOn: need(textOrNull(r.paidOn), `the date ${of} adjudicated it`)
    };
  };

export const readX837Claim = (x: unknown): X837Claim => {
  const r = recordOf(x);
  const sub = recordOf(r.subscriber);
  const pat = recordOf(r.patient);
  const payer = recordOf(r.payer);
  const lines = list(r.lines).map(readX837Line);
  if (!lines.length) throw new Error('The 837P claim needs at least one service line');
  const diagnoses = strs(r.diagnoses);
  if (!diagnoses.length) throw new Error('The 837P claim needs at least one diagnosis');
  const patient = {
    lastName: need(textOrNull(pat.lastName), 'a patient last name'),
    firstName: textOrNull(pat.firstName),
    ...address(pat),
    birthDate: need(textOrNull(pat.birthDate), 'a patient birth date'),
    sex: textOrNull(pat.sex) ?? 'U'
  };
  const otherPayers = list(r.otherPayers).map(readOtherPayer(patient));
  if (otherPayers.length >= RESPONSIBILITY.length) {
    throw new Error(`The 837P claim carries at most ${RESPONSIBILITY.length} payers`);
  }
  const frequency = need(textOrNull(r.frequency), 'a claim frequency');
  const payerClaimNumber = textOrNull(r.payerClaimNumber);
  if (REPLACEMENT_FREQUENCIES.includes(frequency) && payerClaimNumber === null) {
    throw new Error(`The 837P claim needs the payer claim number frequency ${frequency} replaces`);
  }
  const loadedMiles = r.loadedMiles == null ? null : positive(r.loadedMiles, 'loaded miles');
  const relationship = need(textOrNull(sub.relationship), 'a subscriber relationship');
  return {
    claimId: need(textOrNull(r.claimId), 'a claim ID'),
    placeOfService: need(textOrNull(r.placeOfService), 'a place of service'),
    frequency,
    payerClaimNumber,
    subscriber: {
      relationship,
      ...insured(sub, relationship, patient, 'the subscriber'),
      memberId: need(textOrNull(sub.memberId), 'a member ID'),
      groupId: textOrNull(sub.groupId)
    },
    patient,
    payer: {
      name: need(textOrNull(payer.name), 'a payer name'),
      payerId: need(textOrNull(payer.payerId), 'a payer ID'),
      claimFiling: need(textOrNull(payer.claimFiling), 'a claim filing indicator')
    },
    otherPayers,
    transportReason:
      loadedMiles === null
        ? null
        : need(textOrNull(r.transportReason), 'a transport reason with loaded miles'),
    loadedMiles,
    conditionCodes: strs(r.conditionCodes).slice(0, 5),
    diagnoses: diagnoses.slice(0, DIAGNOSIS_LIMIT),
    pickup: where(r.pickup),
    dropoff: where(r.dropoff),
    lines
  };
};

const place = (l: Address): Segment[] => [
  ['N3', clean(l.addressLine, 55)],
  ['N4', clean(l.city, 30), l.state ?? '', l.postalCode ?? '']
];

const demographics = (p: X837Claim['patient']): Segment => [
  'DMG',
  'D8',
  yyyymmdd(p.birthDate),
  p.sex
];

const person = (code: string, p: Person, id: readonly string[] = []): Segment => [
  'NM1',
  code,
  '1',
  clean(p.lastName),
  clean(p.firstName, 35),
  '',
  '',
  '',
  ...id
];

const CAS_TRIPLETS = 6;

const casSegments = (adjustments: Adjustment[]): Segment[] =>
  [...Map.groupBy(adjustments, (a) => a.group)].flatMap(([group, items]) =>
    Array.from({ length: Math.ceil(items.length / CAS_TRIPLETS) }, (_, k) => [
      'CAS',
      group,
      ...items
        .slice(k * CAS_TRIPLETS, (k + 1) * CAS_TRIPLETS)
        .flatMap((a) => [a.reason, dollars(a.cents), ''])
    ])
  );

const fallbackCas = (o: X837OtherPayer, totalCents: number): Segment[] => {
  const remaining = totalCents - o.paidCents - o.adjustedCents;
  return [
    ...(o.adjustedCents ? [['CAS', 'CO', '45', dollars(o.adjustedCents)]] : []),
    ...(remaining ? [['CAS', 'PR', '2', dollars(remaining)]] : [])
  ];
};

const otherPayerSegments = (o: X837OtherPayer, i: number, totalCents: number): Segment[] => [
  [
    'SBR',
    RESPONSIBILITY.charAt(i),
    o.relationship,
    clean(o.groupId, 50),
    '',
    '',
    '',
    '',
    '',
    o.claimFiling
  ],
  ...(o.adjustments.length ? casSegments(o.adjustments) : fallbackCas(o, totalCents)),
  ['AMT', 'D', dollars(o.paidCents)],
  ['OI', '', '', 'Y', 'P', '', 'Y'],
  person('IL', o, ['MI', clean(o.memberId, 80)]),
  ['NM1', 'PR', '2', clean(o.name), '', '', '', '', 'PI', clean(o.payerId, 80)],
  ['DTP', '573', 'D8', yyyymmdd(o.paidOn)]
];

const claimSegments = (c: X837Claim, hl: number): Segment[] => {
  const { subscriber: s, patient: p } = c;
  const self = s.relationship === SELF;
  const totalCents = c.lines.reduce((sum, l) => sum + l.chargeCents, 0);
  return [
    ['HL', String(hl), '1', '22', self ? '0' : '1'],
    [
      'SBR',
      RESPONSIBILITY.charAt(c.otherPayers.length),
      self ? SELF : '',
      clean(s.groupId, 50),
      '',
      '',
      '',
      '',
      '',
      c.payer.claimFiling
    ],
    person('IL', s, ['MI', clean(s.memberId, 80)]),
    ...(self ? [...place(p), demographics(p)] : []),
    ['NM1', 'PR', '2', clean(c.payer.name), '', '', '', '', 'PI', clean(c.payer.payerId, 80)],
    ...(self
      ? []
      : [
          ['HL', String(hl + 1), String(hl), '23', '0'],
          ['PAT', s.relationship],
          person('QC', p),
          ...place(p),
          demographics(p)
        ]),
    [
      'CLM',
      c.claimId,
      dollars(totalCents),
      '',
      '',
      [c.placeOfService, 'B', c.frequency],
      'Y',
      'A',
      'Y',
      'Y'
    ],
    ...(c.payerClaimNumber ? [['REF', 'F8', c.payerClaimNumber]] : []),
    ...(c.loadedMiles === null
      ? []
      : [
          ['CR1', '', '', '', clean(c.transportReason, 1), 'DH', String(roundUnits(c.loadedMiles))]
        ]),
    ...(c.conditionCodes.length ? [['CRC', '07', 'Y', ...c.conditionCodes]] : []),
    ['HI', ...c.diagnoses.map((code, i) => [i ? 'ABF' : 'ABK', code])],
    ['NM1', 'PW', '2'],
    ...place(c.pickup),
    ...(c.loadedMiles === null
      ? []
      : [['NM1', '45', '2', clean(c.dropoff.name)], ...place(c.dropoff)]),
    ...c.otherPayers.flatMap((o, i) => otherPayerSegments(o, i, totalCents)),
    ...c.lines.flatMap((l, i): Segment[] => [
      ['LX', String(i + 1)],
      [
        'SV1',
        ['HC', l.code, ...l.modifiers],
        dollars(l.chargeCents),
        'UN',
        String(l.units),
        '',
        '',
        '1'
      ],
      ['DTP', '472', 'D8', yyyymmdd(l.serviceDate)]
    ])
  ];
};

const fixed = (x: string | null, n: number) => clean(x, n).padEnd(n, ' ');

const serialize = (seg: Segment) =>
  `${seg
    .map((el) => (typeof el === 'string' ? safe(el) : el.map(safe).join(':')))
    .join('*')
    .replace(/\*+$/, '')}~`;

export const build837 = (s: Submitter, claims: X837Claim[], e: Envelope) => {
  if (
    !Number.isInteger(e.controlNumber) ||
    e.controlNumber < 1 ||
    e.controlNumber > MAX_CONTROL_NUMBER
  ) {
    throw new Error(`Control number ${e.controlNumber} is out of range`);
  }
  const iso = e.createdAt.toISOString();
  const date = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 16).replace(':', '');
  const control = String(e.controlNumber).padStart(9, '0');
  const sender = clean(s.submitterId, 15);
  const receiver = clean(s.receiverId, 15);
  let hl = 2;
  const body: Segment[] = [
    ['ST', '837', '0001', '005010X222A1'],
    ['BHT', '0019', '00', control, date, time, 'CH'],
    ['NM1', '41', '2', clean(s.organizationName), '', '', '', '', '46', sender],
    ['PER', 'IC', clean(s.organizationName), 'TE', s.phone],
    ['NM1', '40', '2', clean(s.receiverName) || receiver, '', '', '', '', '46', receiver],
    ['HL', '1', '', '20', '1'],
    ['PRV', 'BI', 'PXC', AMBULANCE_TAXONOMY],
    ['NM1', '85', '2', clean(s.organizationName), '', '', '', '', 'XX', s.npi],
    ['N3', clean(s.addressLine, 55)],
    ['N4', clean(s.city, 30), s.state, s.postalCode],
    ['REF', 'EI', s.taxId],
    ...claims.flatMap((c) => {
      const segments = claimSegments(c, hl);
      hl += c.subscriber.relationship === SELF ? 1 : 2;
      return segments;
    })
  ];
  const isa = [
    'ISA',
    '00',
    fixed('', 10),
    '00',
    fixed('', 10),
    'ZZ',
    fixed(sender, 15),
    'ZZ',
    fixed(receiver, 15),
    date.slice(2),
    time,
    '^',
    '00501',
    control,
    '0',
    s.production ? 'P' : 'T',
    ':'
  ];
  const segments: Segment[] = [
    ['GS', 'HC', sender, receiver, date, time, String(e.controlNumber), 'X', '005010X222A1'],
    ...body,
    ['SE', String(body.length + 1), '0001'],
    ['GE', '1', String(e.controlNumber)],
    ['IEA', '1', control]
  ];
  return `${[`${isa.join('*')}~`, ...segments.map(serialize)].join('\n')}\n`;
};
