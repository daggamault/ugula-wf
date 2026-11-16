import { type Adjustment, isAdjustmentGroup } from './claims.ts';
import {
  centsOf,
  componentsOf,
  dateOf,
  readX12,
  textOf,
  transactionsOf,
  type X12File
} from './x12.ts';

export type RemittanceClaim = {
  claimNumber: string;
  status: string;
  chargeCents: number;
  paidCents: number;
  patientCents: number;
  payerClaimNumber: string | null;
  adjustments: Adjustment[];
  remarks: string[];
  denied: boolean;
  reversal: boolean;
};

export type ProviderAdjustment = { reason: string; reference: string | null; cents: number };

export type Remittance = {
  payerName: string | null;
  payerId: string | null;
  checkNumber: string | null;
  paidOn: string | null;
  totalCents: number;
  providerAdjustments: ProviderAdjustment[];
  claims: RemittanceClaim[];
};

const DENIED = '4';

const REVERSAL = '22';

const CAS_TRIPLETS = 6;

const MOA_REMARKS = [3, 4, 5, 6, 7];

const MIA_REMARKS = [5, 20, 21, 22, 23];

const REMARK_QUALIFIER = 'HE';

const PLB_PAIRS = 6;

const providerAdjustmentsOf = (plb: string[], file: X12File): ProviderAdjustment[] =>
  Array.from({ length: PLB_PAIRS }, (_, i) => {
    const [reason, reference] = componentsOf(plb[3 + i * 2], file);
    const code = textOf(reason);
    return code
      ? [{ reason: code, reference: textOf(reference), cents: centsOf(plb[4 + i * 2]) }]
      : [];
  }).flat();

const adjustmentsOf = (cas: string[]): Adjustment[] => {
  const group = cas[1];
  if (!isAdjustmentGroup(group)) return [];
  return Array.from({ length: CAS_TRIPLETS }, (_, i) => {
    const reason = textOf(cas[2 + i * 3]);
    return reason ? [{ group, reason, cents: centsOf(cas[3 + i * 3]) }] : [];
  }).flat();
};

const addRemark = (claim: RemittanceClaim | null, value: string | undefined) => {
  const code = textOf(value)?.toUpperCase();
  if (claim && code && !claim.remarks.includes(code)) claim.remarks.push(code);
};

const claimOf = (clp: string[]): RemittanceClaim => ({
  claimNumber: clp[1]?.trim() ?? '',
  status: clp[2]?.trim() ?? '',
  chargeCents: centsOf(clp[3]),
  paidCents: centsOf(clp[4]),
  patientCents: centsOf(clp[5]),
  payerClaimNumber: textOf(clp[7]),
  adjustments: [],
  remarks: [],
  denied: clp[2] === DENIED,
  reversal: clp[2] === REVERSAL
});

const remittanceOf = (segments: string[][], file: X12File): Remittance => {
  const r: Remittance = {
    payerName: null,
    payerId: null,
    checkNumber: null,
    paidOn: null,
    totalCents: 0,
    providerAdjustments: [],
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
      case 'MOA':
      case 'MIA':
        for (const i of seg[0] === 'MOA' ? MOA_REMARKS : MIA_REMARKS) addRemark(claim, seg[i]);
        break;
      case 'LQ':
        if (seg[1] === REMARK_QUALIFIER) addRemark(claim, seg[2]);
        break;
      case 'PLB':
        r.providerAdjustments.push(...providerAdjustmentsOf(seg, file));
        break;
    }
  }
  return r;
};

export const read835 = (text: string): Remittance[] => {
  const file = readX12(text);
  return transactionsOf(file, '835').map((t) => remittanceOf(t, file));
};
