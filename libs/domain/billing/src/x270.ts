import { sexOf } from './patients.ts';
import { clean, type Envelope, interchange, type Segment, stampOf, yyyymmdd } from './x12.ts';
import type { Submitter } from './x837.ts';

type SubscriberAddress = {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type EligibilityRequest = {
  trace: string;
  payer: { name: string; payerId: string };
  subscriber: {
    lastName: string;
    firstName: string | null;
    memberId: string | null;
    birthDate: string | null;
    sex: string | null;
    address?: SubscriberAddress | null;
  };
  serviceDate: string;
};

const HEALTH_BENEFIT_PLAN_COVERAGE = '30';

const addressSegments = (a: SubscriberAddress | null | undefined): Segment[] => {
  if (!a?.city || !a.state || !a.postalCode) return [];
  return [
    ...(a.addressLine ? [['N3', clean(a.addressLine, 55)]] : []),
    ['N4', clean(a.city, 30), clean(a.state, 2), clean(a.postalCode, 15)]
  ];
};

const requestSegments = (s: Submitter, r: EligibilityRequest, hl: number): Segment[] => {
  const sub = r.subscriber;
  const search = !sub.memberId;
  if (search && !sub.birthDate) {
    throw new Error(`A search without a member ID needs the birth date (${r.trace})`);
  }
  const sex = sexOf(sub.sex) ?? 'U';
  return [
    ['HL', String(hl), '', '20', '1'],
    ['NM1', 'PR', '2', clean(r.payer.name), '', '', '', '', 'PI', clean(r.payer.payerId, 80)],
    ['HL', String(hl + 1), String(hl), '21', '1'],
    ['NM1', '1P', '2', clean(s.organizationName), '', '', '', '', 'XX', s.npi],
    ['HL', String(hl + 2), String(hl + 1), '22', '0'],
    ['TRN', '1', r.trace.trim().slice(0, 50), `1${s.taxId}`],
    [
      'NM1',
      'IL',
      '1',
      clean(sub.lastName),
      clean(sub.firstName, 35),
      ...(search ? [] : ['', '', '', 'MI', clean(sub.memberId, 80)])
    ],
    ...(search ? addressSegments(sub.address) : []),
    ...(sub.birthDate ? [['DMG', 'D8', yyyymmdd(sub.birthDate), sex]] : []),
    ['DTP', '291', 'D8', yyyymmdd(r.serviceDate)],
    ['EQ', HEALTH_BENEFIT_PLAN_COVERAGE]
  ];
};

export const build270 = (s: Submitter, requests: EligibilityRequest[], e: Envelope) => {
  if (!requests.length) throw new Error('An eligibility request needs at least one subscriber');
  const { date, time, control } = stampOf(e);
  const body: Segment[] = [
    ['ST', '270', '0001', '005010X279A1'],
    ['BHT', '0022', '13', control, date, time],
    ...requests.flatMap((r, i) => requestSegments(s, r, i * 3 + 1))
  ];
  return interchange(
    { sender: s.submitterId, receiver: s.receiverId, production: s.production },
    e,
    { functional: 'HS', version: '005010X279A1' },
    body
  );
};
