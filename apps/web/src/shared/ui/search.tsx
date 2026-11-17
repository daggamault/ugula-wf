import { XIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Facets, Page, SearchView } from '../url-state.ts';
import type { Resource } from '../use-resource.ts';
import { Alert } from './alert.tsx';
import { ButtonLink } from './button.tsx';
import { type ColumnFilter, ColumnFilters } from './column-filters.tsx';
import { EmptyState } from './empty-state.tsx';
import { PageLoading } from './page.tsx';
import { Pagination } from './pagination.tsx';
import { type SearchField, SearchForm } from './search-form.tsx';

type SearchProps<T> = {
  label: string;
  path: string;
  search: SearchView;
  results: Resource<Page<T>>;
  filters?: readonly ColumnFilter[];
  empty: { title: string; children?: ReactNode; action?: ReactNode };
  children: (items: readonly T[]) => ReactNode;
};

const searchFieldsOf = (label: string): readonly SearchField[] => [
  { name: 'q', label: 'Search', placeholder: `Search ${label.toLowerCase()}` }
];

export const useLastFacets = (facets: Facets | undefined) => {
  const [last, setLast] = useState(facets);
  if (facets && facets !== last) setLast(facets);
  return facets ?? last;
};

export const Search = <T,>({
  label,
  path,
  search,
  results,
  filters = [],
  empty,
  children
}: SearchProps<T>) => {
  const facets = useLastFacets(results.data?.facets);
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <SearchForm label={`Search ${label}`} path={path} fields={searchFieldsOf(label)} />
        {filters.length ? (
          <ColumnFilters filters={filters} facets={facets} search={search} />
        ) : null}
      </div>
      {results.error ? (
        <Alert>{results.error.message}</Alert>
      ) : results.data?.items.length ? (
        <>
          {children(results.data.items)}
          <Pagination label={label} total={results.data.total} state={search} />
        </>
      ) : results.loading ? (
        <PageLoading />
      ) : search.page > 1 ? (
        <EmptyState
          reason="noMatches"
          title="Past the Last Page"
          action={
            <ButtonLink to={search.pageHref(1)} variant="outline">
              Go to First Page
            </ButtonLink>
          }
        >
          There are no more {label.toLowerCase()} after this page.
        </EmptyState>
      ) : search.q ? (
        <EmptyState reason="noMatches" title={`No Matching ${label}`}>
          Nothing matches “{search.q}”. Try fewer letters or another word.
        </EmptyState>
      ) : search.isFiltered ? (
        <EmptyState
          reason="noMatches"
          title={`No Matching ${label}`}
          action={
            <ButtonLink to={search.clearFiltersHref} variant="outline">
              <XIcon aria-hidden="true" className="size-4" />
              Clear Filters
            </ButtonLink>
          }
        >
          Nothing matches these filters.
        </EmptyState>
      ) : (
        <EmptyState title={empty.title} action={empty.action}>
          {empty.children}
        </EmptyState>
      )}
    </>
  );
};
