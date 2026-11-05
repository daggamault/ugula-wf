import {
  DEFAULT_PROVIDER,
  DEFAULT_RECEIVER,
  DEFAULT_SENDER,
  envelope,
  type MockOptions,
  mockDollars,
  type Party,
  stamp
} from './mock-envelope.ts';
import { clean, type Segment, yyyymmdd } from './x12.ts';

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
