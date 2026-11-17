import { type Expression, type SelectQueryBuilder, type SqlBool, sql } from 'kysely';
import * as v from 'valibot';
import type { Page } from './paging.ts';

const FACET_SELECTED_MAX = 50;

const FACET_OPTIONS_MAX = 200;

export type FacetOption = { value: string; label?: string; count: number };

export type Facets<K extends string> = Record<K, FacetOption[]>;

export type FacetedPage<T, K extends string> = Page<T> & { facets: Facets<K> };

type FacetDef = { value: Expression<unknown>; label?: Expression<unknown> };

export type FacetDefs<K extends string> = Readonly<Record<K, FacetDef>>;

export type FacetFilters<K extends string> = Readonly<Record<K, readonly string[]>>;

type ValueSchema = v.GenericSchema<string, string>;

export const facetValues = <S extends ValueSchema>(value: S) =>
  v.optional(
    v.pipe(
      v.string(),
      v.maxLength(4000),
      v.transform((s) => [...new Set(s.split(',').filter(Boolean))]),
      v.maxLength(FACET_SELECTED_MAX),
      v.array(value)
    ),
    ''
  );

const keysOf = <K extends string>(defs: FacetDefs<K>) => Object.keys(defs) as K[];

export const whereFacets = <DB, TB extends keyof DB, O, K extends string>(
  query: SelectQueryBuilder<DB, TB, O>,
  defs: FacetDefs<K>,
  filters: FacetFilters<K>,
  except?: K
) =>
  keysOf(defs).reduce((q, k) => {
    const values = filters[k];
    return k === except || !values.length
      ? q
      : q.where(sql<SqlBool>`${defs[k].value} in (${sql.join(values)})`);
  }, query);

type FacetRow = { value: string; label: string | null; count: string };

export const facetCounts = async <DB, TB extends keyof DB, O, K extends string>(
  filtered: (except: K) => SelectQueryBuilder<DB, TB, O>,
  defs: FacetDefs<K>
): Promise<Facets<K>> =>
  Object.fromEntries(
    await Promise.all(
      keysOf(defs).map(async (k) => {
        const { value, label } = defs[k];
        const rows = (await filtered(k)
          .clearSelect()
          .clearOrderBy()
          .select([
            sql<string>`${value}::text`.as('value'),
            sql<string | null>`${label ? sql`min(${label}::text)` : sql`null`}`.as('label'),
            sql<string>`count(*)`.as('count')
          ])
          .where(sql<SqlBool>`${value} is not null`)
          .groupBy(sql`1`)
          .orderBy(sql`count(*) desc, 1`)
          .limit(FACET_OPTIONS_MAX)
          .execute()) as unknown as FacetRow[];
        return [
          k,
          rows.map((r) => ({
            value: r.value,
            ...(r.label === null ? {} : { label: r.label }),
            count: Number(r.count)
          }))
        ];
      })
    )
  ) as Facets<K>;
