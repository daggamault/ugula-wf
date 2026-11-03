import { useLocation } from './router.tsx';

export type SortDir = 'asc' | 'desc';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

export type TableSpec<K extends string> = {
  prefix?: string;
  sorts: Readonly<Record<K, SortDir>>;
  sort: NoInfer<K>;
};

export type TableState<K extends string> = {
  sort: K;
  dir: SortDir;
  page: number;
  pageSize: number;
  sortHref: (key: K) => string;
  sortTo: (key: K, dir: SortDir) => string;
  pageHref: (page: number) => string;
  sizeHref: (size: number) => string;
  apiQuery: string;
  /** This list as it is now (filters, sort and page), for links back to it. */
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

export const paramOf = (prefix: string | undefined, name: string) =>
  prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;

const isKey = <K extends string>(
  sorts: Readonly<Record<K, SortDir>>,
  key: string | null
): key is K => key !== null && Object.hasOwn(sorts, key);

const positive = (raw: string | null) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const tableStateOf = <K extends string>(
  path: string,
  query: URLSearchParams,
  { prefix, sorts, sort: defaultSort }: TableSpec<K>
): TableState<K> => {
  const p = (name: string) => paramOf(prefix, name);
  const rawSort = query.get(p('sort'));
  const sort = isKey(sorts, rawSort) ? rawSort : defaultSort;
  const rawDir = query.get(p('dir'));
  const dir: SortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : sorts[sort];
  const page = positive(query.get(p('page'))) ?? 1;
  const size = positive(query.get(p('pageSize')));
  const pageSize = PAGE_SIZES.find((s) => s === size) ?? DEFAULT_PAGE_SIZE;
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
    sortHref: (key) => sortTo(key, key === sort ? (dir === 'asc' ? 'desc' : 'asc') : sorts[key]),
    sortTo,
    pageHref: (n) => href({ page: n > 1 ? String(n) : null }),
    sizeHref: (n) => href({ pageSize: n === DEFAULT_PAGE_SIZE ? null : String(n), page: null }),
    href: hrefWith(path, query, {}),
    apiQuery: new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      dir
    }).toString()
  };
};

export const useTableState = <K extends string>(path: string, spec: TableSpec<K>) =>
  tableStateOf(path, useLocation().query, spec);

export const useFilterHref = (path: string, prefix?: string) => {
  const { query } = useLocation();
  return (name: string, value: string | null) =>
    hrefWith(path, query, { [name]: value, [paramOf(prefix, 'page')]: null });
};

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export type SortValue = string | number | null;

const compare = (a: SortValue, b: SortValue) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

export const pageOf = <T, K extends string>(
  rows: readonly T[],
  state: Pick<TableState<K>, 'sort' | 'dir' | 'page' | 'pageSize'>,
  values: Readonly<Record<K, (row: T) => SortValue>>
): Page<T> => {
  const value = values[state.sort];
  const sign = state.dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return x === null || y === null ? compare(x, y) : sign * compare(x, y);
  });
  const start = (state.page - 1) * state.pageSize;
  return {
    items: sorted.slice(start, start + state.pageSize),
    total: rows.length,
    page: state.page,
    pageSize: state.pageSize
  };
};

export const SEARCH_MAX = 80;

export type SearchState<K extends string> = TableState<K> & {
  /** The trimmed free text being searched for; blank shows everything. */
  q: string;
};

/** A searchable list: the `q` text plus its table state, all kept in the URL. */
export const searchStateOf = <K extends string>(
  path: string,
  query: URLSearchParams,
  spec: TableSpec<K>
): SearchState<K> => {
  const table = tableStateOf(path, query, spec);
  // The API accepts up to 80 characters of search text.
  const q = (query.get('q') ?? '').trim().slice(0, SEARCH_MAX);
  return {
    ...table,
    q,
    apiQuery: q ? `q=${encodeURIComponent(q)}&${table.apiQuery}` : table.apiQuery
  };
};

export const useSearchState = <K extends string>(path: string, spec: TableSpec<K>) =>
  searchStateOf(path, useLocation().query, spec);

const BACK = 'back';

/** Links `to` a page that should return to `back` (a list with its search and page) when done. */
export const withBack = (to: string, back: string) =>
  to.startsWith(`${back}/`)
    ? to
    : `${to}${to.includes('?') ? '&' : '?'}${BACK}=${encodeURIComponent(back)}`;

/**
 * Where a page opened with `withBack` returns to: the list it came from, or the list itself.
 * `also` names other pages (by path prefix, like `/patients/`) that may open it.
 */
export const backOf = (query: URLSearchParams, list: string, ...also: readonly string[]) => {
  const back = query.get(BACK);
  const isAllowed =
    back !== null &&
    !back.startsWith('//') &&
    (back === list || back.startsWith(`${list}?`) || also.some((p) => back.startsWith(p)));
  return isAllowed ? back : list;
};

/** Any search state, whatever its sort keys, as tables and pagers read it. */
export type SearchView = {
  q: string;
  href: string;
  sort: string;
  dir: SortDir;
  page: number;
  pageSize: number;
  sortHref(key: string): string;
  sortTo(key: string, dir: SortDir): string;
  pageHref(page: number): string;
  sizeHref(size: number): string;
};
