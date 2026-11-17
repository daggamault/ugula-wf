import { CLAIM_STATUS_LABELS, CLAIM_STATUSES, nameKey } from '@ugula/billing';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ClaimSummary } from '../../shared/claims/claim-detail.ts';
import { formatCents, formatDate } from '../../shared/format.ts';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { type ColumnFilter, ColumnFilters } from '../../shared/ui/column-filters.tsx';
import { EmptyState, EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight, NumberHighlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { useLastFacets } from '../../shared/ui/search.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { type TableState, useTableState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import type { ClaimSearch, ClaimsClient } from './client.ts';

type ClaimsPageProps = {
  client: ClaimsClient;
  live: Live;
  search: ClaimSearch;
};

const PATH = '/claims';

export const CLAIM_TABLE = {
  sorts: {
    number: 'desc',
    created: 'desc',
    service: 'desc',
    patient: 'asc',
    pcr: 'asc',
    encounter: 'desc',
    total: 'desc',
    status: 'asc'
  },
  sort: 'created'
} as const;

const CLAIMS_PAGE_TABLE = { ...CLAIM_TABLE, filters: ['status'] } as const;

export const CLAIM_FILTERS: readonly ColumnFilter[] = [
  {
    key: 'status',
    label: 'Status',
    labelOf: (o) => {
      const status = CLAIM_STATUSES.find((s) => s === o.value);
      return status ? CLAIM_STATUS_LABELS[status] : o.value;
    }
  }
];

export const CLAIM_SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'firstName', label: 'First Name' },
  { name: 'lastName', label: 'Last Name' },
  { name: 'birthDate', label: 'Birth Date', type: 'date' },
  { name: 'number', label: 'Number', placeholder: 'Claim, Patient or Encounter #' }
];

export const ClaimsTable = ({
  claims,
  sorting,
  showPatient = true,
  back = '',
  search
}: {
  claims: readonly ClaimSummary[];
  sorting?: TableSorting;
  showPatient?: boolean;
  back?: string;
  search?: ClaimSearch;
}) => (
  <Table
    label="Claims"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Claim', sort: 'number' },
      ...(showPatient ? [{ label: 'Patient', sort: 'patient' }] : []),
      { label: 'Encounter', isSecondary: true, sort: 'encounter' },
      { label: 'Service Date', sort: 'service' },
      { label: 'Total', sort: 'total' },
      { label: 'Payers', isSecondary: true },
      { label: 'Status', sort: 'status' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {claims.map((c) => (
      <TableRow key={c.id}>
        <TableCell>
          <span className="font-medium">
            <NumberHighlight number={c.number} query={search?.number ?? ''} />
          </span>
        </TableCell>
        {showPatient ? (
          <TableCell>
            {c.last_name !== null && c.patient_number !== null ? (
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  <Highlight
                    text={c.last_name}
                    query={search?.lastName ?? ''}
                    isPrefix
                    keyOf={nameKey}
                  />
                  {c.first_name ? (
                    <>
                      , <Highlight text={c.first_name} query={search?.firstName ?? ''} isPrefix />
                    </>
                  ) : null}
                </span>
                <span className="text-surface-fg-muted text-xs">
                  Patient <NumberHighlight number={c.patient_number} query={search?.number ?? ''} />
                </span>
              </span>
            ) : (
              <span className="text-surface-fg-muted">Not matched yet</span>
            )}
          </TableCell>
        ) : null}
        <TableCell isSecondary>
          {c.encounter_number || c.pcr_number ? (
            <span className="flex flex-col gap-0.5">
              <span>
                {c.encounter_number ? (
                  <NumberHighlight number={c.encounter_number} query={search?.number ?? ''} />
                ) : (
                  emptyValue
                )}
              </span>
              {c.pcr_number ? (
                <span className="text-surface-fg-muted text-xs">
                  PCR{' '}
                  <Highlight
                    text={c.pcr_number}
                    query={search?.number.trim() === c.pcr_number ? c.pcr_number : ''}
                  />
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-surface-fg-muted">{emptyValue}</span>
          )}
        </TableCell>
        <TableCell kind="date">{formatDate(c.service_date)}</TableCell>
        <TableCell kind="numeric">{formatCents(c.total_cents)}</TableCell>
        <TableCell kind="wrap" isMuted={!c.payers.length} isSecondary>
          {c.payers.length ? c.payers.join(' → ') : 'Patient only'}
        </TableCell>
        <TableCell>
          <ClaimStatusBadge status={c.status} />
        </TableCell>
        <TableCell kind="actions">
          <RowActions>
            <OpenLink to={withBack(`/claims/${c.id}`, back)} name={`claim ${c.number}`} />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

const isSearching = (s: ClaimSearch) =>
  Boolean(s.firstName || s.lastName || s.birthDate || s.number);

type ClaimsTableState = TableState<
  keyof typeof CLAIM_TABLE.sorts,
  (typeof CLAIMS_PAGE_TABLE.filters)[number]
>;

const ClaimResults = ({
  client,
  live,
  query,
  table,
  search,
  empty
}: {
  client: ClaimsClient;
  live: Live;
  query: Parameters<ClaimsClient['list']>[0];
  table: ClaimsTableState;
  search: ClaimSearch;
  empty: ReactNode;
}) => {
  const key = Object.values(query).join('|');
  const claims = useResource(
    `claims:${key}:${table.apiQuery}`,
    (signal) => client.list(query, table.apiQuery, signal),
    30_000
  );
  const items = claims.data?.items ?? [];
  const facets = useLastFacets(claims.data?.facets);
  useLive(
    live,
    (e) =>
      e.kind === 'claim' &&
      isOnPage(
        e.id,
        table.page,
        items.map((c) => c.id)
      ),
    claims.reload,
    LIST_RELOAD_MS
  );
  return (
    <>
      <ColumnFilters filters={CLAIM_FILTERS} facets={facets} search={{ ...table, q: '' }} />
      {claims.error ? <Alert>{claims.error.message}</Alert> : null}
      {items.length && claims.data ? (
        <>
          <ClaimsTable claims={items} sorting={table} back={table.href} search={search} />
          <Pagination label="Claims" total={claims.data.total} state={table} />
        </>
      ) : claims.loading ? (
        <PageLoading />
      ) : claims.error ? null : table.isFiltered ? (
        <EmptyState
          reason="noMatches"
          title="No Matching Claims"
          action={
            <ButtonLink to={table.clearFiltersHref} variant="outline">
              <XIcon aria-hidden="true" className="size-4" />
              Clear Filters
            </ButtonLink>
          }
        >
          Nothing matches these filters.
        </EmptyState>
      ) : (
        empty
      )}
    </>
  );
};

export const ClaimsPage = ({ client, live, search }: ClaimsPageProps) => {
  const table = useTableState(PATH, CLAIMS_PAGE_TABLE);
  return (
    <Page title="Claims">
      <SearchForm label="Search claims" path={PATH} fields={CLAIM_SEARCH_FIELDS} />
      {isSearching(search) || table.isFiltered ? (
        <ClaimResults
          client={client}
          live={live}
          query={search}
          table={table}
          search={search}
          empty={
            <EmptyState reason="noMatches" title="No Matching Claims">
              Names match from the start, so “Sm” finds Smith. Try fewer letters or another number.
            </EmptyState>
          }
        />
      ) : (
        <EmptyText>
          Enter a name, birth date, or a claim, patient or encounter number. Names match from the
          start.
        </EmptyText>
      )}
    </Page>
  );
};
