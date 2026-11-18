import type { Db } from '@ugula/db';
import { ok } from '../../shared/result.ts';
import {
  findRemittances,
  findUnmatchedPayments,
  type Period,
  REPORT_ROW_LIMIT
} from './queries.ts';
import type { RemittanceReportQuery } from './schemas.ts';

const DEFAULT_DAYS = 30;

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export const periodOf = (q: RemittanceReportQuery, today: Date): Period => {
  const to = q.to ?? (q.from && q.from > dayOf(today) ? q.from : dayOf(today));
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (DEFAULT_DAYS - 1));
  return { from: q.from ?? dayOf(start), to, payer: q.payer || undefined };
};

type Remittance = Awaited<ReturnType<typeof findRemittances>>[number];

const sum = (rows: readonly Remittance[], pick: (r: Remittance) => number) =>
  rows.reduce((total, r) => total + pick(r), 0);

export const totalsOf = (rows: readonly Remittance[]) => ({
  remittances: rows.length,
  totalCents: sum(rows, (r) => r.total_cents),
  claimPaidCents: sum(rows, (r) => r.claim_paid_cents),
  providerAdjustmentCents: sum(rows, (r) => r.provider_adjustment_cents),
  unbalanced: rows.filter((r) => !r.is_balanced).length,
  unmatched: sum(rows, (r) => r.unmatched_count),
  open: rows.filter((r) => r.reconciled_at === null).length
});

export const createReportService = ({ db, now }: { db: Db; now: () => Date }) => ({
  remittances: async (agencyId: string, query: RemittanceReportQuery) => {
    const period = periodOf(query, now());
    const [found, unmatched] = await Promise.all([
      findRemittances(db, agencyId, period),
      findUnmatchedPayments(db, agencyId, period)
    ]);
    const remittances = found.slice(0, REPORT_ROW_LIMIT);
    return ok({
      period,
      totals: totalsOf(remittances),
      remittances,
      unmatched,
      truncated: found.length > REPORT_ROW_LIMIT
    });
  }
});

export type ReportService = ReturnType<typeof createReportService>;
