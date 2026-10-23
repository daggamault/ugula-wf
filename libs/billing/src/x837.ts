import type { PricedLine } from './charges.ts';
import { type ClaimDetails, isOriginDestination } from './claim-details.ts';
import type { Address, Sex } from './patients.ts';
import { isValidNpi } from './payers.ts';

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

export type BatchClaim = {
  claimId: string;
  priorPayers: string[];
  payer: { name: string; payerId: string | null; claimFiling: string | null };
  memberId: string | null;
  groupId: string | null;
  patient: Address & { firstName: string; lastName: string; birthDate: string; sex: Sex | null };
  details: ClaimDetails;
  emergency: boolean;
  loadedMiles: number | null;
  lines: PricedLine[];
};

export type Envelope = { controlNumber: number; createdAt: Date };

export const MAX_CONTROL_NUMBER = 999_999_999;

export const MAX_BATCH_CLAIMS = 500;

const AMBULANCE_TAXONOMY = '3416L0300X';

const clean = (x: string | null | undefined, max = 60) =>
  (x ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[~*:^]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .toUpperCase();

const dollars = (cents: number) => String(cents / 100);

const tenths = (n: number) => String(Math.ceil(n * 10 - 1e-9) / 10);

const yyyymmdd = (date: string) => date.slice(0, 10).replaceAll('-', '');

const addressIssues = (label: string, a: Address) => [
  ...(a.addressLine ? [] : [`${label} street address is missing`]),
  ...(a.city ? [] : [`${label} city is missing`]),
  ...(a.state ? [] : [`${label} state is missing`]),
  ...(a.postalCode ? [] : [`${label} ZIP code is missing`])
];

export const submitterIssues = (s: Submitter | null) =>
  !s
    ? ['Add a billing profile in Settings']
    : [
        ...(isValidNpi(s.npi) ? [] : ['The billing NPI is invalid']),
        ...(s.submitterId ? [] : ['Add the clearinghouse submitter ID in Settings']),
        ...(s.receiverId ? [] : ['Add the clearinghouse receiver ID in Settings'])
      ];

export const claimIssues = (c: BatchClaim) => [
  ...(c.priorPayers.length
    ? [
        `${c.payer.name} is a secondary payer; batches only carry primary claims, so submit it from the clearinghouse portal`
      ]
    : []),
  ...(c.payer.payerId && c.payer.claimFiling
    ? []
    : [`${c.payer.name} is not in the payer directory`]),
  ...(c.memberId ? [] : [`The member ID for ${c.payer.name} is missing`]),
  ...addressIssues('Patient', c.patient),
  ...(c.details.serviceDate ? [] : ['The date of service is missing']),
  ...(c.details.diagnoses.length ? [] : ['At least one diagnosis code is required']),
  ...addressIssues('Pickup', c.details.pickup),
  ...addressIssues('Drop-off', c.details.destination),
  ...(isOriginDestination(c.details.originDestination)
    ? []
    : ['The origin/destination modifier is missing']),
  ...(c.loadedMiles !== null && c.loadedMiles > 0 ? [] : ['Loaded miles are missing']),
  ...(c.lines.length ? [] : ['The claim has no service lines'])
];

const place = (l: Address) => [
  ['N3', clean(l.addressLine, 55)],
  ['N4', clean(l.city, 30), l.state ?? '', l.postalCode ?? '']
];

const claimSegments = (c: BatchClaim, hl: number) => {
  const { patient: p, details: d } = c;
  const serviceDate = yyyymmdd(d.serviceDate ?? '');
  return [
    ['HL', String(hl), '1', '22', '0'],
    ['SBR', 'P', '18', clean(c.groupId, 50), '', '', '', '', '', c.payer.claimFiling ?? ''],
    [
      'NM1',
      'IL',
      '1',
      clean(p.lastName),
      clean(p.firstName, 35),
      '',
      '',
      '',
      'MI',
      clean(c.memberId, 80)
    ],
    ...place(p),
    ['DMG', 'D8', yyyymmdd(p.birthDate), p.sex ?? 'U'],
    ['NM1', 'PR', '2', clean(c.payer.name), '', '', '', '', 'PI', clean(c.payer.payerId, 80)],
    [
      'CLM',
      c.claimId,
      dollars(c.lines.reduce((sum, l) => sum + l.totalCents, 0)),
      '',
      '',
      '41:B:1',
      'Y',
      'A',
      'Y',
      'Y'
    ],
    ['CR1', '', '', '', 'A', 'DH', tenths(c.loadedMiles ?? 0)],
    ['CRC', '07', 'Y', '09', ...(c.emergency ? ['06'] : [])],
    ['HI', ...d.diagnoses.map((code, i) => `${i ? 'ABF' : 'ABK'}:${code}`)],
    ['NM1', 'PW', '2'],
    ...place(d.pickup),
    ['NM1', '45', '2', clean(d.destination.name)],
    ...place(d.destination),
    ...c.lines.flatMap((l, i) => [
      ['LX', String(i + 1)],
      [
        'SV1',
        `HC:${l.code}:${d.originDestination ?? ''}`,
        dollars(l.totalCents),
        'UN',
        tenths(l.units),
        '',
        '',
        '1'
      ],
      ['DTP', '472', 'D8', serviceDate]
    ])
  ];
};

const fixed = (x: string | null, n: number) => clean(x, n).padEnd(n, ' ');

export const build837 = (s: Submitter, claims: BatchClaim[], e: Envelope) => {
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
  const body = [
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
    ...claims.flatMap((c, i) => claimSegments(c, i + 2))
  ];
  const segments = [
    [
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
    ],
    ['GS', 'HC', sender, receiver, date, time, String(e.controlNumber), 'X', '005010X222A1'],
    ...body,
    ['SE', String(body.length + 1), '0001'],
    ['GE', '1', String(e.controlNumber)],
    ['IEA', '1', control]
  ];
  return `${segments.map((seg) => `${seg.join('*').replace(/\*+$/, '')}~`).join('\n')}\n`;
};
