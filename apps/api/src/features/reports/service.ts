import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { type DateRange, findReport } from './queries.ts';
import type { ReportQuery } from './schemas.ts';

type ReportServiceDeps = { db: Db; now: () => Date };

const DEFAULT_MONTHS = 12;

export const dayIn = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at);

export const rangeOf = (query: Pick<ReportQuery, 'from' | 'to'>, today: string): DateRange => {
  const to = query.to ?? today;
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (DEFAULT_MONTHS - 1), 1);
  return { from: query.from ?? start.toISOString().slice(0, 10), to };
};

export const createReportService = ({ db, now }: ReportServiceDeps) => ({
  run: async (tenantId: string, id: string, query: ReportQuery) => {
    const report = findReport(id);
    if (!report) return fail('not_found', `There is no report called “${id}”.`);
    const group = query.group ?? report.groups?.[0] ?? null;
    if (group !== null && !report.groups?.includes(group)) {
      return fail('invalid', `This report can't be grouped by “${group}”.`);
    }
    const at = now();
    const today = dayIn(at, query.tz);
    const range = rangeOf(query, today);
    const result = await report.run(
      db,
      { tenantId, tz: query.tz, now: at.toISOString(), today, range, group: group ?? '' },
      query.page
    );
    return ok({ asOf: today, range: report.dates ? range : null, group, ...result });
  }
});

export type ReportService = ReturnType<typeof createReportService>;
