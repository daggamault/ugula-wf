import { type ClaimEvent, type ClaimLedger, claimProgress, PATIENT_KIND } from './claims.ts';

const dayOf = (e: ClaimEvent) => e.paidOn ?? e.at.slice(0, 10);

const codesOf = (e: ClaimEvent | undefined) =>
  (e?.adjustments ?? []).map((a) => `${a.group}-${a.reason}`);

const coverageOf = (ledger: ClaimLedger, coverageId: string | null) =>
  ledger.coverages.find((c) => c.id === coverageId) ?? null;

export const denialFactsOf = (ledger: ClaimLedger, coverageId: string) => {
  const coverage = coverageOf(ledger, coverageId);
  if (!coverage) throw new Error(`Payer ${coverageId} is not on the claim`);
  const own = ledger.events.filter((e) => e.coverageId === coverageId);
  const response = own.findLast((e) => e.kind === 'response');
  const denied = own.findLast((e) => e.kind === 'denied');
  return {
    coverageId,
    payer: coverage.payer,
    payerKind: coverage.claimFiling ?? null,
    route: denied?.route ?? 'denial',
    note: denied?.note ?? '',
    codes: codesOf(response),
    remarks: response?.remarks ?? [],
    paidCents: own.reduce((sum, e) => sum + e.paidCents, 0),
    balanceCents: claimProgress(ledger).balanceCents,
    deniedOn: response ? dayOf(response) : null,
    appeals: own.filter((e) => e.kind === 'appealed').length,
    payerClaimNumber:
      own.findLast((e) => e.kind === 'response' && e.payerClaimNumber !== null)?.payerClaimNumber ??
      null,
    correctionMethod: coverage.correctionMethod ?? null,
    appealDays: coverage.appealDays ?? null
  };
};

export const payerFactsOf = (ledger: ClaimLedger, coverageId: string | null) => {
  if (coverageId === null) return { payer: null, payerKind: PATIENT_KIND };
  const coverage = coverageOf(ledger, coverageId);
  if (!coverage) throw new Error(`Payer ${coverageId} is not on the claim`);
  return { payer: coverage.payer, payerKind: coverage.claimFiling ?? null };
};

export const appealOutcomeOf = (ledger: ClaimLedger, coverageId: string) => {
  const appealed = ledger.events.findLastIndex(
    (e) => e.coverageId === coverageId && e.kind === 'appealed'
  );
  const after = ledger.events
    .slice(appealed + 1)
    .filter((e) => appealed >= 0 && e.coverageId === coverageId);
  const responses = after.filter((e) => e.kind === 'response');
  return {
    decided: responses.length > 0,
    paidCents: responses.reduce((sum, e) => sum + e.paidCents, 0),
    deniedAgain: after.some((e) => e.kind === 'denied'),
    balanceCents: claimProgress(ledger).balanceCents
  };
};

const creditStart = ({ totalCents, events }: ClaimLedger) => {
  let balance = totalCents;
  let start = -1;
  events.forEach((e, i) => {
    const before = balance;
    balance -= e.paidCents + e.adjustedCents;
    if (balance >= 0) start = -1;
    else if (before >= 0) start = i;
  });
  return start;
};

export const refundFactsOf = (ledger: ClaimLedger) => {
  const { balanceCents } = claimProgress(ledger);
  const start = creditStart(ledger);
  const identified = ledger.events[start];
  const last = ledger.events.slice(0, start + 1).findLast((e) => e.paidCents > 0);
  const coverageId = last?.coverageId ?? null;
  const coverage = coverageOf(ledger, coverageId);
  return {
    overpaidCents: Math.max(0, -balanceCents),
    coverageId,
    payer: coverage?.payer ?? null,
    payerKind: coverage ? (coverage.claimFiling ?? null) : PATIENT_KIND,
    paidCents: ledger.events
      .filter((e) => e.coverageId === coverageId)
      .reduce((sum, e) => sum + e.paidCents, 0),
    identifiedOn: identified ? dayOf(identified) : null
  };
};

export const patientBalanceFactsOf = (ledger: ClaimLedger) => {
  const { balanceCents } = claimProgress(ledger);
  const responses = ledger.events.filter((e) => e.kind === 'response' && e.coverageId !== null);
  const lastPayer = coverageOf(ledger, responses.at(-1)?.coverageId ?? null);
  return {
    balanceCents,
    adjustments: responses
      .filter((e) => e.coverageId === lastPayer?.id)
      .flatMap((e) => e.adjustments),
    claimFilings: ledger.coverages.flatMap((c) => (c.claimFiling ? [c.claimFiling] : [])),
    state: ledger.pickupState ?? null,
    serviceDate: ledger.serviceDate ?? null,
    planType: lastPayer?.planType ?? null,
    payerKind: lastPayer ? (lastPayer.claimFiling ?? null) : PATIENT_KIND,
    protectedCents: ledger.events
      .filter((e) => e.kind === 'balance_protected')
      .reduce((sum, e) => sum + e.adjustedCents, 0)
  };
};

export const responseFactsOf = (ledger: ClaimLedger, coverageId: string) => {
  if (!coverageOf(ledger, coverageId)) throw new Error(`Payer ${coverageId} is not on the claim`);
  const responses = ledger.events.filter(
    (e) => e.coverageId === coverageId && e.kind === 'response'
  );
  return {
    paidCents: responses.reduce((sum, e) => sum + e.paidCents, 0),
    adjustments: responses.flatMap((e) => e.adjustments)
  };
};
