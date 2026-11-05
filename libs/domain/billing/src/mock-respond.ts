import type { MockOptions } from './mock-envelope.ts';
import { build277 } from './mock-x277.ts';
import { build835 } from './mock-x835.ts';
import { type Mock837, type Mock837Claim, read837 } from './mock-x837.ts';
import { build999 } from './mock-x999.ts';
import { readX12 } from './x12.ts';

const MOCK_REJECT_PREFIX = 'REJECT';

const MOCK_REJECTION = 'Invalid member ID';

export const MOCK_PAID_SHARE = 0.8;

export type MockResponse = {
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

export const mockPayerClaimNumber = (claimNumber: string) => `MOCK-${claimNumber}`;

const isRejected = (c: Mock837Claim) =>
  (c.memberId ?? '').toUpperCase().startsWith(MOCK_REJECT_PREFIX);

export const respond = (
  text837: string,
  now: Date,
  { remits = () => true }: { remits?: (claim: Mock837Claim) => boolean } = {}
): MockResponse => {
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
  const paid = accepted.filter(remits);
  const byPayer = Map.groupBy(paid, (c) => c.payer?.id ?? '');
  const remit835 = paid.length
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
