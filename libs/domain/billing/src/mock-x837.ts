import type { Party } from './mock-envelope.ts';
import { centsOf, dateOf, readX12, textOf } from './x12.ts';

export type Mock837Claim = {
  claimNumber: string;
  chargeCents: number;
  memberId: string | null;
  serviceDate: string | null;
  patient: { lastName: string; firstName: string | null };
  payer: Party | null;
  claimFiling: string | null;
};

export type Mock837 = {
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
