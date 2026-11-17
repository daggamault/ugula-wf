import type { ClaimEvent } from './claims.ts';
import { startOfLocalDay } from './statements.ts';

export const PLAN_STATUSES = ['active', 'completed', 'defaulted', 'cancelled'] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type EndedPlanStatus = Exclude<PlanStatus, 'active'>;

export const isEndedPlanStatus = (x: unknown): x is EndedPlanStatus =>
  x !== 'active' && PLAN_STATUSES.includes(x as PlanStatus);

export type LedgerPlan = {
  installmentCents: number;
  intervalDays: number;
  firstDueOn: string;
  missedCount: number;
  startedAt: string;
  timeZone: string;
};

const DAY_MS = 86_400_000;

export const addDays = (on: string, days: number) =>
  new Date(Date.parse(`${on}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const PLAN_KINDS: readonly ClaimEvent['kind'][] = ['plan_started', 'plan_ended'];

export const billingStatements = (events: readonly ClaimEvent[]) =>
  events
    .filter((e) => e.kind === 'statement' || PLAN_KINDS.includes(e.kind))
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .reduce<{ onPlan: boolean; statements: ClaimEvent[] }>(
      ({ onPlan, statements }, e) =>
        e.kind === 'statement'
          ? { onPlan, statements: onPlan ? statements : [...statements, e] }
          : { onPlan: e.kind === 'plan_started', statements },
      { onPlan: false, statements: [] }
    ).statements;

export const planProgress = (plan: LedgerPlan, events: readonly ClaimEvent[], now: Date) => {
  const started = Date.parse(plan.startedAt);
  const since = events
    .filter((e) => Date.parse(e.at) >= started)
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const installment = Math.max(1, plan.installmentCents);
  let paid = 0;
  let misses = 0;
  let covered = 0;
  let openedAt = started;
  for (const e of since) {
    if (e.coverageId === null) paid += e.paidCents;
    if (e.kind === 'plan_missed') misses += 1;
    const count = Math.max(0, Math.floor(paid / installment)) + misses;
    if (count !== covered) {
      covered = count;
      openedAt = Date.parse(e.at);
    }
  }
  const dueOn = addDays(plan.firstDueOn, covered * plan.intervalDays);
  return {
    dueOn,
    untilDueMs: startOfLocalDay(addDays(dueOn, 1), plan.timeZone) - now.getTime(),
    paidCents: Math.max(0, paid - Math.max(0, Math.floor(paid / installment)) * installment),
    billed: since.some((e) => e.kind === 'statement' && Date.parse(e.at) >= openedAt)
  };
};
