import type { Adjustment } from './claims.ts';
import {
  centsOf,
  clean,
  dateOf,
  MAX_CONTROL_NUMBER,
  readX12,
  type Segment,
  textOf,
  yyyymmdd
} from './x12.ts';

type MockOptions = {
  sender?: string;
  receiver?: string;
  production?: boolean;
  controlNumber?: number;
  createdAt?: Date;
};

type Transaction = { id: string; version: string; body: Segment[] };

type Party = { name: string; id: string };

const DEFAULT_SENDER = 'DEMOCH';

const DEFAULT_RECEIVER = 'DEVEMS01';

const DEFAULT_PROVIDER: Party = { name: 'DEVELOPMENT EMS', id: '1234567893' };

const DEFAULT_PAYER: Party = { name: 'MEDICARE', id: 'DEMOMCR' };

const safe = (x: string) => x.replace(/[^\x20-\x7E]/g, '').replace(/[~*:^]/g, ' ');

const serialize = (seg: Segment) =>
  `${seg
    .map((el) => (typeof el === 'string' ? safe(el) : el.map(safe).join(':')))
    .join('*')
    .replace(/\*+$/, '')}~`;

const randomControl = () => Math.floor(Math.random() * (MAX_CONTROL_NUMBER - 1)) + 1;

const mockDollars = (cents: number) => (cents / 100).toFixed(2);

const stamp = (o: MockOptions) => {
  const iso = (o.createdAt ?? new Date()).toISOString();
  return {
    date: iso.slice(0, 10).replaceAll('-', ''),
    time: iso.slice(11, 16).replace(':', '')
  };
};

const envelope = (
  o: MockOptions,
  group: { functional: string; version: string },
  transactions: Transaction[]
) => {
  const control = o.controlNumber ?? randomControl();
  if (!Number.isInteger(control) || control < 1 || control > MAX_CONTROL_NUMBER) {
    throw new Error(`Control number ${control} is out of range`);
  }
  const { date, time } = stamp(o);
  const sender = clean(o.sender ?? DEFAULT_SENDER, 15);
  const receiver = clean(o.receiver ?? DEFAULT_RECEIVER, 15);
  const padded = String(control).padStart(9, '0');
  const isa = [
    'ISA',
    '00',
    ' '.repeat(10),
    '00',
    ' '.repeat(10),
    'ZZ',
    sender.padEnd(15),
    'ZZ',
    receiver.padEnd(15),
    date.slice(2),
    time,
    '^',
    '00501',
    padded,
    '0',
    o.production ? 'P' : 'T',
    ':'
  ].join('*');
  const segments: Segment[] = [
    ['GS', group.functional, sender, receiver, date, time, String(control), 'X', group.version],
    ...transactions.flatMap((t, i): Segment[] => {
      const st = String(i + 1).padStart(4, '0');
      return [['ST', t.id, st, t.version], ...t.body, ['SE', String(t.body.length + 2), st]];
    }),
    ['GE', String(transactions.length), String(control)],
    ['IEA', '1', padded]
  ];
  return `${[`${isa}~`, ...segments.map(serialize)].join('\n')}\n`;
};

type Mock999Error = {
  segment: string;
  position: number;
  loop?: string;
  code: string;
  element?: { position: string; code: string };
};

type Mock999Transaction = {
  controlNumber: string;
  accepted: boolean;
  errors?: Mock999Error[];
};

type Mock999 = {
  groupControlNumber: string;
  functionalId?: string;
  transactionSetId?: string;
  version?: string;
  transactions: Mock999Transaction[];
  accepted?: boolean;
};

export const build999 = (ack: Mock999, o: MockOptions = {}) => {
  const version = ack.version ?? '005010X222A1';
  const transactionId = ack.transactionSetId ?? '837';
  const acceptedCount = ack.transactions.filter((t) => t.accepted).length;
  const groupStatus =
    ack.accepted === false
      ? 'R'
      : ack.accepted === true || acceptedCount === ack.transactions.length
        ? 'A'
        : acceptedCount
          ? 'P'
          : 'R';
  return envelope(o, { functional: 'FA', version: '005010X231A1' }, [
    {
      id: '999',
      version: '005010X231A1',
      body: [
        ['AK1', ack.functionalId ?? 'HC', ack.groupControlNumber, version],
        ...ack.transactions.flatMap((t): Segment[] => [
          ['AK2', transactionId, t.controlNumber, version],
          ...(t.errors ?? []).flatMap((e): Segment[] => [
            ['IK3', e.segment, String(e.position), e.loop ?? '', e.code],
            ...(e.element ? [['IK4', e.element.position, '', e.element.code]] : [])
          ]),
          ['IK5', t.accepted ? 'A' : 'R']
        ]),
        [
          'AK9',
          groupStatus,
          String(ack.transactions.length),
          String(ack.transactions.length),
          String(groupStatus === 'R' ? 0 : acceptedCount)
        ]
      ]
    }
  ]);
};

type Mock277Claim = {
  claimNumber: string;
  chargeCents?: number;
  rejection: string | null;
  payerClaimNumber?: string | null;
  patient?: { lastName: string; firstName?: string | null };
  serviceDate?: string | null;
};

type Mock277 = {
  clearinghouse?: Party;
  submitter?: Party;
  provider?: Party;
  claims: Mock277Claim[];
};

export const build277 = (ack: Mock277, o: MockOptions = {}) => {
  const { date, time } = stamp(o);
  const clearinghouse = ack.clearinghouse ?? {
    name: 'DEMO CLEARINGHOUSE',
    id: o.sender ?? DEFAULT_SENDER
  };
  const submitter = ack.submitter ?? {
    name: DEFAULT_PROVIDER.name,
    id: o.receiver ?? DEFAULT_RECEIVER
  };
  const provider = ack.provider ?? DEFAULT_PROVIDER;
  return envelope(o, { functional: 'HN', version: '005010X214' }, [
    {
      id: '277',
      version: '005010X214',
      body: [
        ['BHT', '0085', '08', 'MOCK', date, time, 'TH'],
        ['HL', '1', '', '20', '1'],
        ['NM1', 'AY', '2', clean(clearinghouse.name), '', '', '', '', '46', clearinghouse.id],
        ['HL', '2', '1', '21', '1'],
        ['NM1', '41', '2', clean(submitter.name), '', '', '', '', '46', submitter.id],
        ['HL', '3', '2', '19', '1'],
        ['NM1', '85', '2', clean(provider.name), '', '', '', '', 'XX', provider.id],
        ...ack.claims.flatMap((c, i): Segment[] => {
          const charge = mockDollars(c.chargeCents ?? 0);
          return [
            ['HL', String(4 + i), '3', 'PT'],
            [
              'NM1',
              'QC',
              '1',
              clean(c.patient?.lastName ?? 'PATIENT'),
              clean(c.patient?.firstName, 35)
            ],
            ['TRN', '2', c.claimNumber],
            c.rejection
              ? ['STC', ['A7', '21'], date, 'U', charge, '', '', '', '', '', '', '', c.rejection]
              : ['STC', ['A2', '20'], date, 'WQ', charge],
            ...(c.payerClaimNumber ? [['REF', '1K', c.payerClaimNumber]] : []),
            ...(c.serviceDate ? [['DTP', '472', 'D8', yyyymmdd(c.serviceDate)]] : [])
          ];
        })
      ]
    }
  ]);
};

type Mock835Claim = {
  claimNumber: string;
  chargeCents: number;
  paidCents: number;
  patientCents?: number;
  payerClaimNumber?: string | null;
  claimFiling?: string;
  adjustments?: Adjustment[];
};

type Mock835 = {
  payer?: Party;
  payee?: Party;
  checkNumber?: string;
  claims: Mock835Claim[];
};

const adjustmentsOf = (c: Mock835Claim): Adjustment[] => {
  if (c.adjustments) return c.adjustments;
  const rest = c.chargeCents - c.paidCents - (c.patientCents ?? 0);
  return rest ? [{ group: 'CO', reason: '45', cents: rest }] : [];
};

const casOf = (adjustments: Adjustment[]): Segment[] =>
  [...Map.groupBy(adjustments, (a) => a.group)].map(([group, items]) => [
    'CAS',
    group,
    ...items.slice(0, 6).flatMap((a) => [a.reason, mockDollars(a.cents), ''])
  ]);

export const build835 = (remits: Mock835[], o: MockOptions = {}) => {
  const { date } = stamp(o);
  const control = o.controlNumber ?? randomControl();
  return envelope({ ...o, controlNumber: control }, { functional: 'HP', version: '005010X221A1' }, [
    ...remits.map((r, i): Transaction => {
      const payer = r.payer ?? DEFAULT_PAYER;
      const payee = r.payee ?? DEFAULT_PROVIDER;
      const total = r.claims.reduce((sum, c) => sum + c.paidCents, 0);
      return {
        id: '835',
        version: '005010X221A1',
        body: [
          [
            'BPR',
            'I',
            mockDollars(total),
            'C',
            'ACH',
            'CCP',
            '01',
            '1',
            'DA',
            '1',
            '1',
            '',
            '01',
            '1',
            'DA',
            '1',
            date
          ],
          ['TRN', '1', r.checkNumber ?? `EFT-${control}-${i + 1}`, '1'],
          ['N1', 'PR', clean(payer.name), 'XV', payer.id],
          ['N1', 'PE', clean(payee.name), 'XX', payee.id],
          ['LX', '1'],
          ...r.claims.flatMap((c): Segment[] => [
            [
              'CLP',
              c.claimNumber,
              c.paidCents === 0 ? '4' : '1',
              mockDollars(c.chargeCents),
              mockDollars(c.paidCents),
              mockDollars(c.patientCents ?? 0),
              c.claimFiling ?? 'MB',
              c.payerClaimNumber ?? ''
            ],
            ...casOf(adjustmentsOf(c))
          ])
        ]
      };
    })
  ]);
};

type Mock271 = {
  trace: string;
  active: boolean;
  payer?: Party;
  provider?: Party;
  subscriber?: { lastName: string; firstName?: string | null; memberId: string };
  message?: string;
};

export const build271 = (e: Mock271, o: MockOptions = {}) => {
  const { date, time } = stamp(o);
  const payer = e.payer ?? DEFAULT_PAYER;
  const provider = e.provider ?? DEFAULT_PROVIDER;
  const subscriber = e.subscriber ?? {
    lastName: 'KLINE',
    firstName: 'DOROTHY',
    memberId: '2KT7XM4RW91'
  };
  return envelope(o, { functional: 'HB', version: '005010X279A1' }, [
    {
      id: '271',
      version: '005010X279A1',
      body: [
        ['BHT', '0022', '11', 'MOCK', date, time],
        ['HL', '1', '', '20', '1'],
        ['NM1', 'PR', '2', clean(payer.name), '', '', '', '', 'PI', payer.id],
        ['HL', '2', '1', '21', '1'],
        ['NM1', '1P', '2', clean(provider.name), '', '', '', '', 'XX', provider.id],
        ['HL', '3', '2', '22', '0'],
        ['TRN', '2', e.trace, '9123456789'],
        [
          'NM1',
          'IL',
          '1',
          clean(subscriber.lastName),
          clean(subscriber.firstName, 35),
          '',
          '',
          '',
          'MI',
          subscriber.memberId
        ],
        e.active ? ['EB', '1', '', '30', '', 'MEDICARE PART B'] : ['EB', '6', '', '30'],
        ...(e.message ? [['MSG', e.message]] : [])
      ]
    }
  ]);
};

type Mock837Claim = {
  claimNumber: string;
  chargeCents: number;
  memberId: string | null;
  serviceDate: string | null;
  patient: { lastName: string; firstName: string | null };
  payer: Party | null;
  claimFiling: string | null;
};

type Mock837 = {
  interchangeControlNumber: string;
  sender: string;
  receiver: string;
  production: boolean;
  groupControlNumber: string;
  version: string;
  transactionControlNumber: string;
  submitter: Party | null;
  provider: Party | null;
  claims: Mock837Claim[];
};

type Subscriber = {
  memberId: string | null;
  patient: Mock837Claim['patient'];
  payer: Party | null;
  claimFiling: string | null;
};

const partyOf = (seg: string[]): Party => ({
  name: textOf(seg[3]) ?? '',
  id: textOf(seg[9]) ?? ''
});

const personOf = (seg: string[]) => ({
  lastName: textOf(seg[3]) ?? '',
  firstName: textOf(seg[4])
});

const blankSubscriber = (): Subscriber => ({
  memberId: null,
  patient: { lastName: '', firstName: null },
  payer: null,
  claimFiling: null
});

export const read837 = (text: string): Mock837 => {
  const file = readX12(text);
  const [isa = []] = file.segments;
  const gs = file.segments.find((s) => s[0] === 'GS');
  const st = file.segments.find((s) => s[0] === 'ST');
  if (gs?.[1] !== 'HC') throw new Error('No HC functional group');
  if (st?.[1] !== '837') throw new Error('No 837 transaction set');
  const out: Mock837 = {
    interchangeControlNumber: isa[13]?.trim() ?? '',
    sender: isa[6]?.trim() ?? '',
    receiver: isa[8]?.trim() ?? '',
    production: isa[15] === 'P',
    groupControlNumber: gs[6]?.trim() ?? '',
    version: gs[8]?.trim() ?? '',
    transactionControlNumber: st[2]?.trim() ?? '',
    submitter: null,
    provider: null,
    claims: []
  };
  let sub = blankSubscriber();
  let claim: Mock837Claim | null = null;
  for (const seg of file.segments) {
    const [id, q] = seg;
    if (id === 'HL') {
      claim = null;
      if (seg[3] === '22') sub = blankSubscriber();
      continue;
    }
    if (id === 'CLM') {
      const claimNumber = textOf(seg[1]);
      if (!claimNumber) throw new Error('A CLM has no claim number');
      claim = {
        claimNumber,
        chargeCents: centsOf(seg[2]),
        memberId: sub.memberId,
        serviceDate: null,
        patient: sub.patient,
        payer: sub.payer,
        claimFiling: sub.claimFiling
      };
      out.claims.push(claim);
      continue;
    }
    if (claim) {
      if (id === 'DTP' && q === '472') claim.serviceDate ??= dateOf(seg[3]?.slice(0, 8));
      continue;
    }
    if (id === 'NM1' && q === '41') out.submitter = partyOf(seg);
    if (id === 'NM1' && q === '85') out.provider = partyOf(seg);
    if (id === 'SBR') sub.claimFiling = textOf(seg[9]);
    if (id === 'NM1' && q === 'IL') {
      sub.memberId = textOf(seg[9]);
      sub.patient = personOf(seg);
    }
    if (id === 'NM1' && q === 'QC') sub.patient = personOf(seg);
    if (id === 'NM1' && q === 'PR') sub.payer = partyOf(seg);
  }
  if (!out.claims.length) throw new Error('The 837 has no claims');
  return out;
};

const MOCK_REJECT_PREFIX = 'REJECT';

const MOCK_REJECTION = 'Invalid member ID';

const MOCK_PAID_SHARE = 0.8;

type MockResponse = {
  inbound: Mock837 | null;
  error: string | null;
  ack999: string;
  ack277: string | null;
  remit835: string | null;
  accepted: string[];
  rejected: string[];
};

const groupOf = (text: string) => {
  try {
    const file = readX12(text);
    const isa = file.segments[0] ?? [];
    const gs = file.segments.find((s) => s[0] === 'GS');
    const st = file.segments.find((s) => s[0] === 'ST');
    return {
      sender: isa[6]?.trim() || null,
      receiver: isa[8]?.trim() || null,
      production: isa[15] === 'P',
      group: gs?.[6]?.trim() || '0',
      version: gs?.[8]?.trim() || null,
      transaction: st?.[2]?.trim() || null
    };
  } catch {
    return null;
  }
};

const rejectFile = (text: string, now: Date, error: string): MockResponse => {
  const g = groupOf(text);
  return {
    inbound: null,
    error,
    ack999: build999(
      {
        groupControlNumber: g?.group ?? '0',
        ...(g?.version ? { version: g.version } : {}),
        transactions: g?.transaction ? [{ controlNumber: g.transaction, accepted: false }] : [],
        accepted: false
      },
      {
        ...(g?.receiver ? { sender: g.receiver } : {}),
        ...(g?.sender ? { receiver: g.sender } : {}),
        production: g?.production ?? false,
        createdAt: now
      }
    ),
    ack277: null,
    remit835: null,
    accepted: [],
    rejected: []
  };
};

const mockPayerClaimNumber = (claimNumber: string) => `MOCK-${claimNumber}`;

const isRejected = (c: Mock837Claim) =>
  (c.memberId ?? '').toUpperCase().startsWith(MOCK_REJECT_PREFIX);

export const respond = (text837: string, now: Date): MockResponse => {
  let inbound: Mock837;
  try {
    inbound = read837(text837);
  } catch (e) {
    return rejectFile(text837, now, e instanceof Error ? e.message : String(e));
  }
  const options: MockOptions = {
    sender: inbound.receiver,
    receiver: inbound.sender,
    production: inbound.production,
    createdAt: now
  };
  const provider = inbound.provider ? { provider: inbound.provider } : {};
  const accepted = inbound.claims.filter((c) => !isRejected(c));
  const ack999 = build999(
    {
      groupControlNumber: inbound.groupControlNumber,
      version: inbound.version,
      transactions: [{ controlNumber: inbound.transactionControlNumber, accepted: true }]
    },
    options
  );
  const ack277 = build277(
    {
      submitter: { name: inbound.submitter?.name ?? '', id: inbound.sender },
      ...provider,
      claims: inbound.claims.map((c) => ({
        claimNumber: c.claimNumber,
        chargeCents: c.chargeCents,
        rejection: isRejected(c) ? MOCK_REJECTION : null,
        payerClaimNumber: isRejected(c) ? null : mockPayerClaimNumber(c.claimNumber),
        patient: c.patient,
        serviceDate: c.serviceDate
      }))
    },
    options
  );
  const byPayer = Map.groupBy(accepted, (c) => c.payer?.id ?? '');
  const remit835 = accepted.length
    ? build835(
        [...byPayer.values()].map((claims) => ({
          ...(claims[0]?.payer ? { payer: claims[0].payer } : {}),
          ...(inbound.provider ? { payee: inbound.provider } : {}),
          claims: claims.map((c) => ({
            claimNumber: c.claimNumber,
            chargeCents: c.chargeCents,
            paidCents: Math.round(c.chargeCents * MOCK_PAID_SHARE),
            payerClaimNumber: mockPayerClaimNumber(c.claimNumber),
            ...(c.claimFiling ? { claimFiling: c.claimFiling } : {})
          }))
        })),
        options
      )
    : null;
  return {
    inbound,
    error: null,
    ack999,
    ack277,
    remit835,
    accepted: accepted.map((c) => c.claimNumber),
    rejected: inbound.claims.filter(isRejected).map((c) => c.claimNumber)
  };
};
