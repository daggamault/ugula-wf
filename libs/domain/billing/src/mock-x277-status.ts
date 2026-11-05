import {
  DEFAULT_PAYER,
  DEFAULT_PROVIDER,
  envelope,
  type MockOptions,
  mockDollars,
  type Party,
  stamp
} from './mock-envelope.ts';
import { clean, type Segment } from './x12.ts';

type Mock277Status = {
  trace: string;
  claimNumber: string;
  category: string;
  code: string;
  chargeCents?: number;
  paidCents?: number;
  payerClaimNumber?: string | null;
  payer?: Party;
  message?: string;
};

export const build277Status = (answers: Mock277Status[], o: MockOptions = {}) => {
  const { date, time } = stamp(o);
  const provider = DEFAULT_PROVIDER;
  return envelope(o, { functional: 'HN', version: '005010X212' }, [
    {
      id: '277',
      version: '005010X212',
      body: [
        ['BHT', '0010', '08', 'MOCK', date, time, 'DG'],
        ...answers.flatMap((a, i): Segment[] => {
          const hl = i * 4 + 1;
          const payer = a.payer ?? DEFAULT_PAYER;
          return [
            ['HL', String(hl), '', '20', '1'],
            ['NM1', 'PR', '2', clean(payer.name), '', '', '', '', 'PI', payer.id],
            ['HL', String(hl + 1), String(hl), '21', '1'],
            ['NM1', '41', '2', clean(provider.name), '', '', '', '', '46', o.receiver ?? ''],
            ['HL', String(hl + 2), String(hl + 1), '19', '1'],
            ['NM1', '1P', '2', clean(provider.name), '', '', '', '', 'XX', provider.id],
            ['HL', String(hl + 3), String(hl + 2), '22', '0'],
            ['NM1', 'IL', '1', 'PATIENT'],
            ['TRN', '2', a.trace],
            [
              'STC',
              [a.category, a.code],
              date,
              '',
              mockDollars(a.chargeCents ?? 0),
              mockDollars(a.paidCents ?? 0),
              '',
              '',
              '',
              '',
              '',
              '',
              a.message ?? ''
            ],
            ...(a.payerClaimNumber ? [['REF', '1K', a.payerClaimNumber]] : []),
            ['REF', 'EJ', a.claimNumber]
          ];
        })
      ]
    }
  ]);
};
