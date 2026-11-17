import type { Db } from '@ugula/db';
import { activityReport } from './activity-report.ts';
import { agingReport } from './aging-report.ts';
import { creditBalancesReport } from './credit-balances-report.ts';
import { denialsReport } from './denials-report.ts';
import { hcpcsReport } from './hcpcs-report.ts';
import { importsReport } from './imports-report.ts';
import { monthlyReport } from './monthly-report.ts';
import { payersReport } from './payers-report.ts';
import { paymentsReport } from './payments-report.ts';
import { productivityReport } from './productivity-report.ts';
import type { Report } from './report.ts';
import { unbilledReport } from './unbilled-report.ts';
import { workQueueReport } from './work-queue-report.ts';
import { writeOffsReport } from './write-offs-report.ts';

export const REPORTS = {
  aging: agingReport,
  unbilled: unbilledReport,
  monthly: monthlyReport,
  activity: activityReport,
  payments: paymentsReport,
  denials: denialsReport,
  'write-offs': writeOffsReport,
  'credit-balances': creditBalancesReport,
  payers: payersReport,
  hcpcs: hcpcsReport,
  'work-queue': workQueueReport,
  productivity: productivityReport,
  imports: importsReport
} as const satisfies Record<string, Report>;

type ReportId = keyof typeof REPORTS;

export const findReport = (id: string): Report | undefined =>
  Object.hasOwn(REPORTS, id) ? REPORTS[id as ReportId] : undefined;

export const findAgencyTimeZone = async (db: Db, agencyId: string) =>
  (
    await db
      .selectFrom('billing_profiles')
      .select('time_zone')
      .where('agency_id', '=', agencyId)
      .executeTakeFirst()
  )?.time_zone ?? null;
