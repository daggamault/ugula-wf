import { type ClaimEvent, type ClaimLedger, claimProgress, PATIENT_KIND } from './claims.ts';

const dayOf = (e: ClaimEvent) => e.paidOn ?? e.at.slice(0, 10);

const MEDICAID = 'MC';

const MEDICARE: readonly string[] = ['MA', 'MB'];

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
    costShareCents: responses
      .filter((e) => e.coverageId === lastPayer?.id)
      .flatMap((e) => e.adjustments)
      .filter((a) => a.group === 'PR')
      .reduce((sum, a) => sum + a.cents, 0),
    state: ledger.pickupState ?? null,
    serviceDate: ledger.serviceDate ?? null,
    planType: lastPayer?.planType ?? null,
    payerKind: lastPayer ? (lastPayer.claimFiling ?? null) : PATIENT_KIND,
    dualEligible:
      ledger.coverages.some((c) => c.claimFiling === MEDICAID) &&
      ledger.coverages.some((c) => MEDICARE.includes(c.claimFiling ?? '')),
    protectedCents: ledger.events
      .filter((e) => e.kind === 'balance_protected')
      .reduce((sum, e) => sum + e.adjustedCents, 0)
  };
};

const SEQUESTRATION = 'CO-253';

const COST_SHARE = ['PR-1', 'PR-2', 'PR-3'];

export const responseFactsOf = (ledger: ClaimLedger, coverageId: string) => {
  if (!coverageOf(ledger, coverageId)) throw new Error(`Payer ${coverageId} is not on the claim`);
  const responses = ledger.events.filter(
    (e) => e.coverageId === coverageId && e.kind === 'response'
  );
  const adjustments = responses.flatMap((e) => e.adjustments);
  const sum = (cents: number[]) => cents.reduce((total, c) => total + c, 0);
  const paidCents = sum(responses.map((e) => e.paidCents));
  const centsOf = (codes: readonly string[]) =>
    sum(adjustments.filter((a) => codes.includes(`${a.group}-${a.reason}`)).map((a) => a.cents));
  const patientCents = centsOf(COST_SHARE);
  return {
    paidCents,
    patientCents,
    allowedCents: paidCents + patientCents + centsOf([SEQUESTRATION]),
    reasonCoded: adjustments.length > 0
  };
};
