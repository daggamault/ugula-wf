import { build271, type MockResponse, respond } from './mock-x12.ts';
import { readX12, textOf } from './x12.ts';

export const WAYSTAR_RECEIVERS = ['WAYSTAR', 'ZIRMED'] as const;

export const WAYSTAR_EXTENSIONS = { claims: '.CLP', eligibility: '.ELG' } as const;

export const INACTIVE_MEMBER_PREFIX = 'INACTIVE';

type Interchange = {
  sender: string;
  receiver: string;
  controlNumber: string;
  production: boolean;
};

export const readInterchange = (text: string): Interchange | null => {
  try {
    const [isa = []] = readX12(text).segments;
    return {
      sender: isa[6]?.trim() ?? '',
      receiver: isa[8]?.trim() ?? '',
      controlNumber: isa[13]?.trim() ?? '',
      production: isa[15] === 'P'
    };
  } catch {
    return null;
  }
};

const TA1_INVALID_RECEIVER = '008';

const yymmdd = (d: Date) => d.toISOString().slice(2, 10).replaceAll('-', '');

const hhmm = (d: Date) => d.toISOString().slice(11, 16).replace(':', '');

export const buildTA1 = (rejected: Interchange, noteCode: string, now: Date) => {
  const isa = [
    'ISA',
    '00',
    ' '.repeat(10),
    '00',
    ' '.repeat(10),
    'ZZ',
    'WAYSTAR'.padEnd(15),
    'ZZ',
    rejected.sender.slice(0, 15).padEnd(15),
    yymmdd(now),
    hhmm(now),
    '^',
    '00501',
    rejected.controlNumber.padStart(9, '0'),
    '0',
    rejected.production ? 'P' : 'T',
    ':'
  ].join('*');
  const ta1 = [
    'TA1',
    rejected.controlNumber.padStart(9, '0'),
    yymmdd(now),
    hhmm(now),
    'R',
    noteCode
  ].join('*');
  return `${isa}~\n${ta1}~\nIEA*0*${rejected.controlNumber.padStart(9, '0')}~\n`;
};

export type WaystarClaimsResponse = MockResponse & { ta1: string | null };

export const respondToClaims = (
  text: string,
  now: Date,
  isEraEnrolled: (payerId: string) => boolean = () => true
): WaystarClaimsResponse => {
  const isa = readInterchange(text);
  if (isa && !(WAYSTAR_RECEIVERS as readonly string[]).includes(isa.receiver.toUpperCase())) {
    return {
      inbound: null,
      error: `ISA08 must be ${WAYSTAR_RECEIVERS.join(' or ')}, not ${isa.receiver || 'blank'}`,
      ack999: '',
      ack277: null,
      remit835: null,
      accepted: [],
      rejected: [],
      ta1: buildTA1(isa, TA1_INVALID_RECEIVER, now)
    };
  }
  return { ...respond(text, now, { remits: (c) => isEraEnrolled(c.payer?.id ?? '') }), ta1: null };
};

export type EligibilityInquiry = {
  trace: string;
  payer: { name: string; id: string };
  subscriber: { lastName: string; firstName: string | null; memberId: string };
};

export const read270 = (text: string) => {
  const file = readX12(text);
  const st = file.segments.find((s) => s[0] === 'ST');
  if (st?.[1] !== '270') throw new Error('No 270 transaction set');
  const inquiries: EligibilityInquiry[] = [];
  let payer = { name: '', id: '' };
  let trace = '';
  for (const seg of file.segments) {
    const [id, q] = seg;
    if (id === 'NM1' && q === 'PR')
      payer = { name: textOf(seg[3]) ?? '', id: textOf(seg[9]) ?? '' };
    if (id === 'TRN') trace = textOf(seg[2]) ?? '';
    if (id === 'NM1' && q === 'IL') {
      inquiries.push({
        trace,
        payer,
        subscriber: {
          lastName: textOf(seg[3]) ?? '',
          firstName: textOf(seg[4]),
          memberId: textOf(seg[9]) ?? ''
        }
      });
    }
  }
  return { interchange: readInterchange(text), inquiries };
};

export const isActiveMember = (memberId: string) =>
  !memberId.toUpperCase().startsWith(INACTIVE_MEMBER_PREFIX);

export const respondToEligibility = (text: string, now: Date) => {
  const { interchange, inquiries } = read270(text);
  return inquiries.map((q) =>
    build271(
      {
        trace: q.trace,
        active: isActiveMember(q.subscriber.memberId),
        payer: q.payer,
        subscriber: q.subscriber,
        ...(isActiveMember(q.subscriber.memberId) ? {} : { message: 'COVERAGE TERMINATED' })
      },
      {
        sender: 'WAYSTAR',
        receiver: interchange?.sender ?? '',
        production: interchange?.production ?? false,
        createdAt: now
      }
    )
  );
};

const stampOf = (d: Date) => d.toISOString().replace(/\D/g, '').slice(0, 14);

export const downloadName = (clientId: string, type: string, now: Date, seq: number) =>
  `${clientId}_${type}_${stampOf(now)}_${String(seq).padStart(4, '0')}`;
