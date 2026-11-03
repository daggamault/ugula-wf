import type { ReactNode } from 'react';
import type { Page, SearchView } from '../url-state.ts';
import type { Resource } from '../use-resource.ts';
import { Alert } from './alert.tsx';
import { ButtonLink } from './button.tsx';
import { EmptyState } from './empty-state.tsx';
import { PageLoading } from './page.tsx';
import { Pagination } from './pagination.tsx';
import { type SearchField, SearchForm } from './search-form.tsx';

export type SearchProps<T> = {
  /** What is listed, plural and Title Cased ("Payers"). */
  label: string;
  path: string;
  search: SearchView;
  results: Resource<Page<T>>;
  /** Shown when there is nothing to list at all. */
  empty: { title: string; children: ReactNode; action?: ReactNode };
  /** Renders one page of results; highlight matches with `search.q`. */
  children: (items: readonly T[]) => ReactNode;
};

export const searchFieldsOf = (label: string): readonly SearchField[] => [
  { name: 'q', label: 'Search', placeholder: `Search ${label}` }
];

/**
 * The standard searchable list: one search box, server-side results a page at a time, and the
 * pager, with the search, sort and page all kept in the URL.
 */
export const Search = <T,>({ label, path, search, results, empty, children }: SearchProps<T>) => (
  <>
    <SearchForm label={`Search ${label}`} path={path} fields={searchFieldsOf(label)} />
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
    ) : (
      <EmptyState title={empty.title} action={empty.action}>
        {empty.children}
      </EmptyState>
    )}
  </>
);
