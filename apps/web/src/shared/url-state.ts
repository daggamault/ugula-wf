import { useLocation } from './router.tsx';

export type SortDir = 'asc' | 'desc';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

const DEFAULT_PAGE_SIZE = 25;

type TableSpec<K extends string, F extends string> = {
  prefix?: string;
  sorts: Readonly<Record<K, SortDir>>;
  sort: NoInfer<K>;
  filters?: readonly F[];
  defaults?: Readonly<Partial<Record<F, readonly string[]>>>;
};

export type FilterValues<F extends string = string> = Readonly<Record<F, readonly string[]>>;

export type TableState<K extends string, F extends string = never> = {
  sort: K;
  dir: SortDir;
  page: number;
  pageSize: number;
  filters: FilterValues<F>;
  isFiltered: boolean;
  sortHref: (key: K) => string;
  sortTo: (key: K, dir: SortDir) => string;
  pageHref: (page: number) => string;
  sizeHref: (size: number) => string;
  filterHref: (key: F, values: readonly string[]) => string;
  clearFiltersHref: string;
  apiQuery: string;
  href: string;
};

export const hrefWith = (
  path: string,
  query: URLSearchParams,
  patch: Readonly<Record<string, string | null>>
) => {
  const next = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const search = next.toString();
  return search ? `${path}?${search}` : path;
};

const paramOf = (prefix: string | undefined, name: string) =>
  prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;

const isKey = <K extends string>(
  sorts: Readonly<Record<K, SortDir>>,
  key: string | null
): key is K => key !== null && Object.hasOwn(sorts, key);

const positive = (raw: string | null) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const valuesOf = (raw: string | null) => [...new Set((raw ?? '').split(',').filter(Boolean))];

export const tableStateOf = <K extends string, F extends string = never>(
  path: string,
  query: URLSearchParams,
  { prefix, sorts, sort: defaultSort, filters: keys = [], defaults }: TableSpec<K, F>
): TableState<K, F> => {
  const p = (name: string) => paramOf(prefix, name);
  const rawSort = query.get(p('sort'));
  const sort = isKey(sorts, rawSort) ? rawSort : defaultSort;
  const rawDir = query.get(p('dir'));
  const dir: SortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : sorts[sort];
  const page = positive(query.get(p('page'))) ?? 1;
  const size = positive(query.get(p('pageSize')));
  const pageSize = PAGE_SIZES.find((s) => s === size) ?? DEFAULT_PAGE_SIZE;
  const fallbackOf = (k: F): readonly string[] => defaults?.[k] ?? [];
  const filters = Object.fromEntries(
    keys.map((k) => [k, query.has(p(k)) ? valuesOf(query.get(p(k))) : [...fallbackOf(k)]])
  ) as Record<F, string[]>;
  const filterParam = (k: F, values: readonly string[]) => {
    const fallback = fallbackOf(k);
    const isDefault =
      values.length === fallback.length && values.every((v) => fallback.includes(v));
    return isDefault ? null : values.join(',');
  };
  const chosen = keys.filter((k) => filters[k].length);
  const href = (patch: Record<string, string | null>) =>
    hrefWith(path, query, Object.fromEntries(Object.entries(patch).map(([k, v]) => [p(k), v])));
  const sortTo = (key: K, next: SortDir) => {
    const isDefault = key === defaultSort && next === sorts[key];
    return href({ sort: isDefault ? null : key, dir: isDefault ? null : next, page: null });
  };
  return {
    sort,
    dir,
    page,
    pageSize,
    filters,
    isFiltered: chosen.length > 0,
    sortHref: (key) => sortTo(key, key === sort ? (dir === 'asc' ? 'desc' : 'asc') : sorts[key]),
    sortTo,
    pageHref: (n) => href({ page: n > 1 ? String(n) : null }),
    sizeHref: (n) => href({ pageSize: n === DEFAULT_PAGE_SIZE ? null : String(n), page: null }),
    filterHref: (key, values) => href({ [key]: filterParam(key, values), page: null }),
    clearFiltersHref: href({
      ...Object.fromEntries(keys.map((k) => [k, filterParam(k, [])])),
      page: null
    }),
    href: hrefWith(path, query, {}),
    apiQuery: new URLSearchParams([
      ['page', String(page)],
      ['pageSize', String(pageSize)],
      ['sort', sort],
      ['dir', dir],
      ...chosen.map((k) => [k, filters[k].join(',')])
    ]).toString()
  };
};

export const useTableState = <K extends string, F extends string = never>(
  path: string,
  spec: TableSpec<K, F>
) => tableStateOf(path, useLocation().query, spec);

export type FacetOption = { value: string; label?: string; count: number };

export type Facets = Readonly<Record<string, readonly FacetOption[]>>;

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  facets?: Facets;
};

const SEARCH_MAX = 80;

type SearchState<K extends string, F extends string> = TableState<K, F> & {
  q: string;
};

export const searchStateOf = <K extends string, F extends string = never>(
  path: string,
  query: URLSearchParams,
  spec: TableSpec<K, F>
): SearchState<K, F> => {
  const table = tableStateOf(path, query, spec);
  const q = (query.get('q') ?? '').trim().slice(0, SEARCH_MAX);
  return {
    ...table,
    q,
    apiQuery: q ? `q=${encodeURIComponent(q)}&${table.apiQuery}` : table.apiQuery
  };
};

export const useSearchState = <K extends string, F extends string = never>(
  path: string,
  spec: TableSpec<K, F>
) => searchStateOf(path, useLocation().query, spec);

const BACK = 'back';

export const withBack = (to: string, back: string) =>
  to.startsWith(`${back}/`)
    ? to
    : `${to}${to.includes('?') ? '&' : '?'}${BACK}=${encodeURIComponent(back)}`;

export const backOf = (query: URLSearchParams, list: string, ...also: readonly string[]) => {
  const back = query.get(BACK);
  const isAllowed =
    back !== null &&
    !back.startsWith('//') &&
    (back === list || back.startsWith(`${list}?`) || also.some((p) => back.startsWith(p)));
  return isAllowed ? back : list;
};

const BACK_LABELS: readonly (readonly [string, string])[] = [
  ['/claims/', 'Back to Claim'],
  ['/patients/', 'Back to Patient'],
  ['/runs/', 'Back to Run'],
  ['/imports/', 'Back to Import']
];

export const backLabelOf = (back: string) =>
  BACK_LABELS.find(([prefix]) => back.startsWith(prefix))?.[1] ?? 'Back to Claims';

export type SearchView = {
  q: string;
  href: string;
  sort: string;
  dir: SortDir;
  page: number;
  pageSize: number;
  filters: FilterValues;
  isFiltered: boolean;
  sortHref(key: string): string;
  sortTo(key: string, dir: SortDir): string;
  pageHref(page: number): string;
  sizeHref(size: number): string;
  filterHref(key: string, values: readonly string[]): string;
  clearFiltersHref: string;
};
