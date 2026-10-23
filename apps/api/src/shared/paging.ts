import { type Expression, type SelectQueryBuilder, sql } from 'kysely';
import * as v from 'valibot';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export type SortDir = 'asc' | 'desc';

export type PageRequest<K extends string> = {
  page: number;
  pageSize: number;
  sort: K;
  dir: SortDir;
};

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

const toNumber = v.pipe(v.string(), v.transform(Number));

export const pageEntries = <K extends string>(
  sorts: readonly [K, ...K[]],
  sort: K,
  dir: SortDir
) => ({
  page: v.optional(v.pipe(toNumber, v.integer(), v.minValue(1), v.maxValue(1_000_000)), '1'),
  pageSize: v.optional(v.pipe(toNumber, v.picklist(PAGE_SIZES)), '25'),
  sort: v.optional(v.picklist(sorts), sort),
  dir: v.optional(v.picklist(['asc', 'desc'] as const), dir)
});

export type Orderings<K extends string> = Readonly<Record<K, Expression<unknown>>>;

export const paged = async <DB, TB extends keyof DB, O, K extends string>(
  query: SelectQueryBuilder<DB, TB, O>,
  req: PageRequest<K>,
  orderings: Orderings<K>,
  tiebreak: Expression<unknown>
): Promise<Page<O>> => {
  const direction = sql.raw(req.dir);
  const rows = (await query
    .select(sql<string>`count(*) over ()`.as('total'))
    .orderBy(sql`${orderings[req.sort]} ${direction} nulls last`)
    .orderBy(sql`${tiebreak} ${direction}`)
    .limit(req.pageSize)
    .offset((req.page - 1) * req.pageSize)
    .execute()) as (O & { total: string })[];
  const [first] = rows;
  const total = first
    ? Number(first.total)
    : req.page > 1
      ? Number(
          (
            (await query
              .clearSelect()
              .select(sql<string>`count(*)`.as('total'))
              .executeTakeFirst()) as { total: string } | undefined
          )?.total ?? 0
        )
      : 0;
  return {
    items: rows.map(({ total: _, ...row }) => row as unknown as O),
    total,
    page: req.page,
    pageSize: req.pageSize
  };
};
