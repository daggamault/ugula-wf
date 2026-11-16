import {
  build271,
  build277,
  build277Status,
  build835,
  build999,
  buildTA1
} from '@ugula/billing/testing';

type Adjustment = { group: 'CO' | 'PR' | 'OA' | 'PI' | 'CR'; reason: string; cents: number };

export const PAYERS = {
  Medicare: { name: 'MEDICARE', id: 'DEMOMCR', filing: 'MB' },
  Medicaid: { name: 'MEDICAID', id: 'DEMOMCD', filing: 'MC' },
  'Blue Plan': { name: 'BLUE PLAN', id: 'DEMOBCBS', filing: 'BL' },
  'Keystone Comp': { name: 'KEYSTONE COMP', id: 'DEMOWC', filing: 'WC' },
  'Keystone Auto': { name: 'KEYSTONE AUTO', id: 'DEMOAUTO', filing: 'CI' }
} as const;

export type PayerName = keyof typeof PAYERS;

export const payerClaimNumberOf = (claimNumber: string, payer: PayerName = 'Medicare') =>
  `${PAYERS[payer].id}-${claimNumber.replace('-', '')}`;

export const eligibility271 = (trace: string, active: boolean) =>
  build271({ trace, active, ...(active ? {} : { message: 'Coverage terminated 2026-08-31' }) });

export const batchAcknowledgment999 = (batchControl: number, accepted: boolean) =>
  build999({
    groupControlNumber: String(batchControl),
    transactions: [
      {
        controlNumber: '0001',
        accepted,
        errors: accepted
          ? []
          : [
              {
                segment: 'NM1',
                position: 12,
                loop: '2010',
                code: '8',
                element: { position: '9', code: '7' }
              }
            ]
      }
    ]
  });

export const interchangeRejectedTA1 = (control: number, noteCode = '024') =>
  buildTA1(
    { sender: 'DEVEMS02', receiver: 'WAYSTAR', controlNumber: String(control), production: false },
    noteCode,
    new Date()
  );

type Patient = { number: string; last_name: string | null; first_name: string | null };

export const claimAcknowledgment277 = (
  claim: Patient,
  rejection: string | null,
  payer: PayerName = 'Medicare'
) =>
  build277({
    claims: [
      {
        claimNumber: claim.number,
        rejection,
        payerClaimNumber: rejection ? null : payerClaimNumberOf(claim.number, payer),
        patient: { lastName: claim.last_name ?? 'PATIENT', firstName: claim.first_name }
      }
    ]
  });

export const providerRejection277 = (claim: Patient, reason: string) =>
  build277({
    providerRejection: reason,
    claims: [
      {
        claimNumber: claim.number,
        rejection: null,
        patient: { lastName: claim.last_name ?? 'PATIENT', firstName: claim.first_name }
      }
    ]
  });

export const claimStatus277 = (
  claimNumber: string,
  status: { category: string; code: string; message?: string; payer?: PayerName }
) =>
  build277Status([
    {
      trace: `E2E${claimNumber.replace('-', '')}`,
      claimNumber,
      category: status.category,
      code: status.code,
      payerClaimNumber: payerClaimNumberOf(claimNumber, status.payer),
      ...(status.message ? { message: status.message } : {}),
      payer: {
        name: PAYERS[status.payer ?? 'Medicare'].name,
        id: PAYERS[status.payer ?? 'Medicare'].id
      }
    }
  ]);

export type Remittance = {
  claimNumber: string;
  chargeCents: number;
  paidCents: number;
  payer?: PayerName;
  status?: string;
  patientCents?: number;
  payerClaimNumber?: string | null;
  adjustments?: Adjustment[];
  remarks?: string[];
  crossover?: PayerName;
  lines?: {
    code: string;
    modifiers?: string[];
    chargeCents: number;
    paidCents: number;
    units?: number;
    lineNumber?: string;
    adjustments?: Adjustment[];
  }[];
};

const claimOf = (r: Remittance) => {
  const payer = r.payer ?? 'Medicare';
  return {
    claimNumber: r.claimNumber,
    chargeCents: r.chargeCents,
    paidCents: r.paidCents,
    claimFiling: PAYERS[payer].filing,
    payerClaimNumber:
      r.payerClaimNumber === undefined
        ? payerClaimNumberOf(r.claimNumber, payer)
        : r.payerClaimNumber,
    ...(r.status ? { status: r.status } : {}),
    ...(r.patientCents === undefined ? {} : { patientCents: r.patientCents }),
    ...(r.adjustments ? { adjustments: r.adjustments } : {}),
    ...(r.remarks ? { remarks: r.remarks } : {}),
    ...(r.lines ? { lines: r.lines } : {}),
    ...(r.crossover
      ? { crossover: { name: PAYERS[r.crossover].name, id: PAYERS[r.crossover].id } }
      : {})
  };
};

export const remittance835 = (
  claims: Remittance | Remittance[],
  providerAdjustments: { reason: string; reference?: string; cents: number }[] = []
) => {
  const list = Array.isArray(claims) ? claims : [claims];
  const payer = PAYERS[list[0]?.payer ?? 'Medicare'];
  return build835([
    {
      payer: { name: payer.name, id: payer.id },
      claims: list.map(claimOf),
      ...(providerAdjustments.length ? { providerAdjustments } : {})
    }
  ]);
};

export type BilledLine = {
  code: string;
  modifiers: string[];
  chargeCents: number;
  units: number;
  lineNumber: string;
};

const cents = (dollars: string | undefined) => Math.round(Number(dollars ?? 0) * 100);

export const billedLines = (file: string): BilledLine[] => {
  const segments = file.split('~').map((x) => x.trim().split('*'));
  return segments.flatMap((seg, i) => {
    if (seg[0] !== 'SV1') return [];
    const [, code = '', ...modifiers] = (seg[1] ?? '').split(':');
    const lx = segments.slice(0, i).findLast((x) => x[0] === 'LX');
    return [
      {
        code,
        modifiers,
        chargeCents: cents(seg[2]),
        units: Number(seg[4] ?? 1),
        lineNumber: lx?.[1] ?? String(i)
      }
    ];
  });
};

export const adjudicated = (
  file: string,
  share: { paid: number; patient?: number; patientReason?: string }
) =>
  billedLines(file).map((l) => {
    const paidCents = Math.round(l.chargeCents * share.paid);
    const patientCents = Math.round(l.chargeCents * (share.patient ?? 0));
    const rest = l.chargeCents - paidCents - patientCents;
    return {
      code: l.code,
      modifiers: l.modifiers,
      chargeCents: l.chargeCents,
      paidCents,
      units: l.units,
      lineNumber: l.lineNumber,
      adjustments: [
        ...(rest ? [{ group: 'CO' as const, reason: '45', cents: rest }] : []),
        ...(patientCents
          ? [{ group: 'PR' as const, reason: share.patientReason ?? '1', cents: patientCents }]
          : [])
      ]
    };
  });

export const remittanceFor = (
  claimNumber: string,
  file: string,
  share: { paid: number; patient?: number; patientReason?: string },
  payer: PayerName = 'Medicare'
): Remittance => {
  const lines = adjudicated(file, share);
  const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((t, l) => t + f(l), 0);
  return {
    claimNumber,
    payer,
    chargeCents: sum((l) => l.chargeCents),
    paidCents: sum((l) => l.paidCents),
    patientCents: sum((l) =>
      l.adjustments.filter((a) => a.group === 'PR').reduce((t, a) => t + a.cents, 0)
    ),
    lines
  };
};
