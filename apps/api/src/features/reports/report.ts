import type { Db } from '@ugula/db';
import { type AliasedExpression, sql } from 'kysely';
import { type Page, paged, type SortDir } from '../../shared/paging.ts';
import { cents } from './report-sql.ts';
import type { ReportPage } from './schemas.ts';

export type DateRange = { from: string; to: string };

type DateKind = 'service' | 'posted' | 'completed' | 'received';

export type ReportContext = {
  agencyId: string;
  tz: string;
  now: string;
  today: string;
  range: DateRange;
  group: string;
};

type ReportResult = Page<unknown> & { totals: Record<string, number> };

type Column<R> = keyof R & string;

type ReportSpec<R> = {
  dates: DateKind | null;
  groups?: readonly [string, ...string[]];
  rows: (db: Db, ctx: ReportContext) => AliasedExpression<R, 'r'>;
  columns: readonly Column<R>[];
  order: Column<R>;
  tiebreak: Column<R>;
  dir: SortDir;
  totals: readonly Column<R>[];
};

type EveryColumn<R, C extends readonly Column<R>[]> = [Exclude<Column<R>, C[number]>] extends [
  never
]
  ? unknown
  : { missingColumns: Exclude<Column<R>, C[number]> };

export type Report = {
  dates: DateKind | null;
  groups: readonly string[] | null;
  run: (db: Db, ctx: ReportContext, page: ReportPage) => Promise<ReportResult>;
};

const REPORT_PAGE_SIZE = 100;

export const report = <R, const C extends readonly Column<R>[]>(
  spec: ReportSpec<R> & { columns: C } & EveryColumn<R, C>
): Report => ({
  dates: spec.dates,
  groups: spec.groups ?? null,
  run: async (db, ctx, page) => {
    const order = sql.ref(`r.${spec.order}`);
    const tiebreak = sql.ref(`r.${spec.tiebreak}`);
    const rows = db
      .selectFrom(spec.rows(db, ctx))
      .select(spec.columns.map((c) => sql.ref(`r.${c}`).as(c)));
    const [listed, totals] = await Promise.all([
      page === 'all'
        ? rows
            .orderBy(sql`${order} ${sql.raw(spec.dir)} nulls last`)
            .orderBy(sql`${tiebreak} ${sql.raw(spec.dir)}`)
            .execute()
            .then((items) => ({ items, total: items.length, page: 1, pageSize: items.length }))
        : paged(
            rows,
            { page, pageSize: REPORT_PAGE_SIZE, sort: 'order', dir: spec.dir },
            { order },
            tiebreak
          ),
      spec.totals.length
        ? db
            .selectFrom(spec.rows(db, ctx))
            .select(spec.totals.map((k) => cents(sql.ref(`r.${k}`)).as(k)))
            .executeTakeFirstOrThrow()
        : {}
    ]);
    return { ...listed, totals: totals as Record<string, number> };
  }
});
