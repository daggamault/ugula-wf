import { activityReport } from './activity-report.ts';
import { agingReport } from './aging-report.ts';
import { denialsReport } from './denials-report.ts';
import { hcpcsReport } from './hcpcs-report.ts';
import { importsReport } from './imports-report.ts';
import { levelsReport } from './levels-report.ts';
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
  payers: payersReport,
  hcpcs: hcpcsReport,
  levels: levelsReport,
  'work-queue': workQueueReport,
  productivity: productivityReport,
  imports: importsReport
} as const satisfies Record<string, Report>;

type ReportId = keyof typeof REPORTS;

export const findReport = (id: string): Report | undefined =>
  Object.hasOwn(REPORTS, id) ? REPORTS[id as ReportId] : undefined;
