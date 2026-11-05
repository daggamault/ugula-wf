import { type Expression, sql } from 'kysely';
import type { ReportContext } from './report.ts';

export const UNBILLED = ['draft', 'void'] as const;

export const SUBMISSIONS = ['submitted', 'resubmitted'] as const;

export const UNRECOVERED = ['written_off', 'collections'] as const;

export const cents = (expr: Expression<unknown>) => sql<number>`coalesce(sum(${expr}), 0)::float8`;

export const centsWhere = (expr: Expression<unknown>, where: Expression<unknown>) =>
  sql<number>`coalesce(sum(${expr}) filter (where ${where}), 0)::float8`;

export const countWhere = (where: Expression<unknown>) =>
  sql<number>`(count(*) filter (where ${where}))::int`;

export const count = sql<number>`count(*)::int`;

export const zero = sql<number>`0`;

const startOf = (day: string, tz: string) => sql`(${day}::date)::timestamp at time zone ${tz}`;

export const within = (at: Expression<unknown>, { range, tz }: ReportContext) =>
  sql<boolean>`${at} >= ${startOf(range.from, tz)} and ${at} < (${range.to}::date + 1)::timestamp at time zone ${tz}`;

export const servedIn = ({ range }: ReportContext) =>
  sql<boolean>`c.service_date between ${range.from}::date and ${range.to}::date`;

export const reasonCode = sql<string>`a.group_code || '-' || a.reason_code`;
