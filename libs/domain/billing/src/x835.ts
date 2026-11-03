import { type Adjustment, isAdjustmentGroup } from './claims.ts';
import { centsOf, dateOf, readX12, textOf, transactionsOf } from './x12.ts';

export type RemittanceClaim = {
  claimNumber: string;
  status: string;
  chargeCents: number;
  paidCents: number;
  patientCents: number;
  payerClaimNumber: string | null;
  adjustments: Adjustment[];
  denied: boolean;
  reversal: boolean;
};

export type Remittance = {
  payerName: string | null;
  payerId: string | null;
  checkNumber: string | null;
  paidOn: string | null;
  totalCents: number;
  providerAdjustmentCents: number;
  claims: RemittanceClaim[];
};

const DENIED = '4';

const REVERSAL = '22';

const CAS_TRIPLETS = 6;

const PLB_AMOUNTS = [4, 6, 8, 10, 12, 14];

const adjustmentsOf = (cas: string[]): Adjustment[] => {
  const group = cas[1];
  if (!isAdjustmentGroup(group)) return [];
  return Array.from({ length: CAS_TRIPLETS }, (_, i) => {
    const reason = textOf(cas[2 + i * 3]);
    return reason ? [{ group, reason, cents: centsOf(cas[3 + i * 3]) }] : [];
  }).flat();
};

const claimOf = (clp: string[]): RemittanceClaim => ({
  claimNumber: clp[1]?.trim() ?? '',
  status: clp[2]?.trim() ?? '',
  chargeCents: centsOf(clp[3]),
  paidCents: centsOf(clp[4]),
  patientCents: centsOf(clp[5]),
  payerClaimNumber: textOf(clp[7]),
  adjustments: [],
  denied: clp[2] === DENIED,
  reversal: clp[2] === REVERSAL
});

const remittanceOf = (segments: string[][]): Remittance => {
  const r: Remittance = {
    payerName: null,
    payerId: null,
    checkNumber: null,
    paidOn: null,
    totalCents: 0,
    providerAdjustmentCents: 0,
    claims: []
  };
  let party: string | null = null;
  let claim: RemittanceClaim | null = null;
  for (const seg of segments) {
    switch (seg[0]) {
      case 'BPR':
        r.totalCents = centsOf(seg[2]);
        r.paidOn = dateOf(seg[16]);
        break;
      case 'TRN':
        r.checkNumber ??= textOf(seg[2]);
        break;
      case 'N1':
        party = seg[1] ?? null;
        if (party === 'PR') {
          r.payerName = textOf(seg[2]);
          r.payerId = textOf(seg[4]);
        }
        break;
      case 'REF':
        if (party === 'PR' && !claim && seg[1] === '2U') r.payerId ??= textOf(seg[2]);
        break;
      case 'CLP':
        claim = claimOf(seg);
        r.claims.push(claim);
        break;
      case 'CAS':
        claim?.adjustments.push(...adjustmentsOf(seg));
        break;
      case 'PLB':
        r.providerAdjustmentCents += PLB_AMOUNTS.reduce((sum, i) => sum + centsOf(seg[i]), 0);
        break;
    }
  }
  return r;
};

export const read835 = (text: string): Remittance[] =>
  transactionsOf(readX12(text), '835').map(remittanceOf);
