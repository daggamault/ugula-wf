import type { Db } from '@ugula/db';
import { ok } from '../../shared/result.ts';
import {
  agingReport,
  type DateRange,
  hcpcsReport,
  monthlyReport,
  patientPayments,
  payerReport
} from './queries.ts';
import type { RangeQuery } from './schemas.ts';

export type ReportServiceDeps = { db: Db; now: () => Date };

const DEFAULT_MONTHS = 12;

const day = (d: Date) => d.toISOString().slice(0, 10);

export const rangeOf = (query: RangeQuery, now: Date): DateRange => {
  const to = query.to ?? day(now);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (DEFAULT_MONTHS - 1), 1);
  return { from: query.from ?? day(start), to };
};

export const createReportService = ({ db, now }: ReportServiceDeps) => ({
  aging: async (tenantId: string) => {
    const asOf = day(now());
    return ok({ asOf, rows: await agingReport(db, tenantId, asOf) });
  },

  monthly: async (tenantId: string, query: RangeQuery) => {
    const range = rangeOf(query, now());
    return ok({ range, rows: await monthlyReport(db, tenantId, range) });
  },

  hcpcs: async (tenantId: string, query: RangeQuery) => {
    const range = rangeOf(query, now());
    return ok({ range, rows: await hcpcsReport(db, tenantId, range) });
  },

  payers: async (tenantId: string, query: RangeQuery) => {
    const range = rangeOf(query, now());
    const [rows, patient] = await Promise.all([
      payerReport(db, tenantId, range),
      patientPayments(db, tenantId, range)
    ]);
    return ok({ range, rows, patient });
  }
});

export type ReportService = ReturnType<typeof createReportService>;
