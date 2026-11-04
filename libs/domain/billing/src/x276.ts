import { clean, type Envelope, interchange, type Segment, stampOf, yyyymmdd } from './x12.ts';
import type { Submitter } from './x837.ts';

type Person = {
  lastName: string;
  firstName: string | null;
  birthDate: string | null;
  sex: string | null;
};

export type ClaimStatusInquiry = {
  trace: string;
  payer: { name: string; payerId: string };
  subscriber: Person & { memberId: string };
  patient: Person | null;
  claimNumber: string;
  payerClaimNumber: string | null;
  chargeCents: number;
  serviceDate: string;
};

const SEXES = ['F', 'M', 'U'];

const dollars = (cents: number) => (cents / 100).toFixed(2);

const demographics = (p: Person): Segment[] =>
  p.birthDate
    ? [['DMG', 'D8', yyyymmdd(p.birthDate), p.sex && SEXES.includes(p.sex) ? p.sex : 'U']]
    : [];

const claimSegments = (q: ClaimStatusInquiry): Segment[] => [
  ['TRN', '1', q.trace.trim().slice(0, 50)],
  ...(q.payerClaimNumber ? [['REF', '1K', clean(q.payerClaimNumber, 50)]] : []),
  ['REF', 'EJ', q.claimNumber.trim().slice(0, 50)],
  ['AMT', 'T3', dollars(q.chargeCents)],
  ['DTP', '472', 'RD8', `${yyyymmdd(q.serviceDate)}-${yyyymmdd(q.serviceDate)}`]
];

const inquirySegments = (s: Submitter, q: ClaimStatusInquiry, hl: number): Segment[] => {
  const sub = q.subscriber;
  return [
    ['HL', String(hl), '', '20', '1'],
    ['NM1', 'PR', '2', clean(q.payer.name), '', '', '', '', 'PI', clean(q.payer.payerId, 80)],
    ['HL', String(hl + 1), String(hl), '21', '1'],
    ['NM1', '41', '2', clean(s.organizationName), '', '', '', '', '46', s.submitterId ?? ''],
    ['HL', String(hl + 2), String(hl + 1), '19', '1'],
    ['NM1', '1P', '2', clean(s.organizationName), '', '', '', '', 'XX', s.npi],
    ['HL', String(hl + 3), String(hl + 2), '22', q.patient ? '1' : '0'],
    ...(q.patient ? [] : demographics(sub)),
    [
      'NM1',
      'IL',
      '1',
      clean(sub.lastName),
      clean(sub.firstName, 35),
      '',
      '',
      '',
      'MI',
      clean(sub.memberId, 80)
    ],
    ...(q.patient
      ? [
          ['HL', String(hl + 4), String(hl + 3), '23'],
          ...demographics(q.patient),
          ['NM1', 'QC', '1', clean(q.patient.lastName), clean(q.patient.firstName, 35)]
        ]
      : []),
    ...claimSegments(q)
  ];
};

export const build276 = (s: Submitter, inquiries: ClaimStatusInquiry[], e: Envelope) => {
  if (!inquiries.length) throw new Error('A claim status request needs at least one claim');
  const { date, time, control } = stampOf(e);
  let hl = 1;
  const body: Segment[] = [
    ['ST', '276', '0001', '005010X212'],
    ['BHT', '0010', '13', control, date, time],
    ...inquiries.flatMap((q) => {
      const segments = inquirySegments(s, q, hl);
      hl += q.patient ? 5 : 4;
      return segments;
    })
  ];
  return interchange(
    { sender: s.submitterId, receiver: s.receiverId, production: s.production },
    e,
    { functional: 'HR', version: '005010X212' },
    body
  );
};
