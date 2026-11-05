import type { Adjustment } from './claims.ts';
import {
  DEFAULT_PAYER,
  DEFAULT_PROVIDER,
  envelope,
  type MockOptions,
  mockDollars,
  type Party,
  randomControl,
  stamp,
  type Transaction
} from './mock-envelope.ts';
import { clean, type Segment } from './x12.ts';

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
