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
  status?: string;
  patientCents?: number;
  payerClaimNumber?: string | null;
  claimFiling?: string;
  adjustments?: Adjustment[];
  remarks?: string[];
  crossover?: Party;
};

type Mock835ProviderAdjustment = { reason: string; reference?: string; cents: number };

type Mock835 = {
  payer?: Party;
  payee?: Party;
  checkNumber?: string;
  claims: Mock835Claim[];
  providerAdjustments?: Mock835ProviderAdjustment[];
};

const CAS_TRIPLETS = 6;

const MOA_REMARKS = 5;

const PLB_PAIRS = 6;

const adjustmentsOf = (c: Mock835Claim): Adjustment[] => {
  if (c.adjustments) return c.adjustments;
  const rest = c.chargeCents - c.paidCents - (c.patientCents ?? 0);
  return rest ? [{ group: 'CO', reason: '45', cents: rest }] : [];
};

const casOf = (adjustments: Adjustment[]): Segment[] =>
  [...Map.groupBy(adjustments, (a) => a.group)].map(([group, items]) => [
    'CAS',
    group,
    ...items.slice(0, CAS_TRIPLETS).flatMap((a) => [a.reason, mockDollars(a.cents), ''])
  ]);

const claimSegments = (c: Mock835Claim): Segment[] => [
  [
    'CLP',
    c.claimNumber,
    c.status ?? (c.paidCents === 0 ? '4' : '1'),
    mockDollars(c.chargeCents),
    mockDollars(c.paidCents),
    mockDollars(c.patientCents ?? 0),
    c.claimFiling ?? 'MB',
    c.payerClaimNumber ?? ''
  ],
  ...casOf(adjustmentsOf(c)),
  ...(c.crossover
    ? [['NM1', 'TT', '2', clean(c.crossover.name), '', '', '', '', 'PI', c.crossover.id]]
    : []),
  ...(c.remarks?.length ? [['MOA', '', '', ...c.remarks.slice(0, MOA_REMARKS)]] : [])
];

const plbOf = (provider: string, date: string, items: Mock835ProviderAdjustment[]): Segment[] =>
  Array.from({ length: Math.ceil(items.length / PLB_PAIRS) }, (_, k) => [
    'PLB',
    provider,
    `${date.slice(0, 4)}1231`,
    ...items
      .slice(k * PLB_PAIRS, (k + 1) * PLB_PAIRS)
      .flatMap((a) => [
        a.reference ? [a.reason, clean(a.reference, 50)] : a.reason,
        mockDollars(a.cents)
      ])
  ]);

export const build835 = (remits: Mock835[], o: MockOptions = {}) => {
  const { date } = stamp(o);
  const control = o.controlNumber ?? randomControl();
  return envelope({ ...o, controlNumber: control }, { functional: 'HP', version: '005010X221A1' }, [
    ...remits.map((r, i): Transaction => {
      const payer = r.payer ?? DEFAULT_PAYER;
      const payee = r.payee ?? DEFAULT_PROVIDER;
      const provider = r.providerAdjustments ?? [];
      const total =
        r.claims.reduce((sum, c) => sum + c.paidCents, 0) -
        provider.reduce((sum, a) => sum + a.cents, 0);
      return {
        id: '835',
        version: '005010X221A1',
        body: [
          [
            'BPR',
            total > 0 ? 'I' : 'H',
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
          ...r.claims.flatMap(claimSegments),
          ...plbOf(payee.id, date, provider)
        ]
      };
    })
  ]);
};
