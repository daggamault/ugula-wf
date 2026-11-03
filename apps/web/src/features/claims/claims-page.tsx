import { nameKey } from '@ugula/billing';
import { formatCents, formatDate } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useTableState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { CLAIM_FILTERS, ClaimStatusBadge } from './claim-status-badge.tsx';
import type { ClaimSearch, ClaimSummary, ClaimsClient } from './client.ts';

export type ClaimsPageProps = {
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
    total: 'desc',
    balance: 'desc',
    status: 'asc'
  },
  sort: 'created'
} as const;

export const CLAIM_SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'firstName', label: 'First Name' },
  { name: 'lastName', label: 'Last Name' },
  { name: 'birthDate', label: 'Birth Date', type: 'date' },
  { name: 'number', label: 'Number', placeholder: 'Claim, Patient or Encounter #' },
  { name: 'status', label: 'Status', type: 'select', options: CLAIM_FILTERS, defaultValue: 'open' }
];

export const claimNumber = (n: number) => `#${n}`;

export const ClaimsTable = ({
  claims,
  sorting,
  showPatient = true,
  back = '',
  names
}: {
  claims: readonly ClaimSummary[];
  sorting?: TableSorting;
  showPatient?: boolean;
  back?: string;
  names?: { firstName: string; lastName: string };
}) => (
  <Table
    label="Claims"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Claim', sort: 'number' },
      ...(showPatient ? [{ label: 'Patient', sort: 'patient' }] : []),
      { label: 'Encounter', isSecondary: true, sort: 'pcr' },
      { label: 'Service Date', sort: 'service' },
      { label: 'Total', isNumeric: true, sort: 'total' },
      { label: 'Balance', isNumeric: true, sort: 'balance' },
      { label: 'Payers', isSecondary: true },
      { label: 'Status', sort: 'status' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {claims.map((c) => (
      <TableRow key={c.id}>
        <TableCell>
          <span className="font-medium">{claimNumber(c.number)}</span>
        </TableCell>
        {showPatient ? (
          <TableCell>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                <Highlight
                  text={c.last_name}
                  query={names?.lastName ?? ''}
                  isPrefix
                  keyOf={nameKey}
                />
                , <Highlight text={c.first_name} query={names?.firstName ?? ''} isPrefix />
              </span>
              <span className="text-surface-fg-muted text-xs">
                Patient {claimNumber(c.patient_number)}
              </span>
            </span>
          </TableCell>
        ) : null}
        <TableCell isMuted isSecondary>
          {c.pcr_number ?? emptyValue}
        </TableCell>
        <TableCell kind="date">{formatDate(c.service_date)}</TableCell>
        <TableCell kind="numeric">{formatCents(c.total_cents)}</TableCell>
        <TableCell kind="numeric">
          <span className="font-semibold">{formatCents(c.balance_cents)}</span>
        </TableCell>
        <TableCell kind="wrap" isMuted={!c.payers.length} isSecondary>
          {c.payers.length ? c.payers.join(' → ') : 'Patient only'}
        </TableCell>
        <TableCell>
          <ClaimStatusBadge status={c.status} />
        </TableCell>
        <TableCell kind="actions">
          <OpenLink
            to={withBack(`/claims/${c.id}`, back)}
            name={`claim ${claimNumber(c.number)}`}
          />
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

const isFiltered = (s: ClaimSearch) =>
  Boolean(s.firstName || s.lastName || s.birthDate || s.number) || s.status !== 'open';

export const ClaimsPage = ({ client, live, search }: ClaimsPageProps) => {
  const table = useTableState(PATH, CLAIM_TABLE);
  const back = table.href;
  const key = Object.values(search).join('|');
  const claims = useResource(
    `claims:${key}:${table.apiQuery}`,
    () => client.list(search, table.apiQuery),
    30_000
  );
  useLive(live, (e) => e.kind === 'claim', claims.reload);
  return (
    <Page
      title="Claims"
      description="Every claim from draft to paid. Open a claim to review, submit or post payments."
    >
      <SearchForm
        label="Filter claims"
        path={PATH}
        fields={CLAIM_SEARCH_FIELDS}
        collapsibleTitle="Filters"
      />
      {claims.error ? <Alert>{claims.error.message}</Alert> : null}
      {claims.data?.items.length ? (
        <>
          <ClaimsTable
            claims={claims.data.items}
            sorting={table}
            back={back}
            names={{ firstName: search.firstName, lastName: search.lastName }}
          />
          <Pagination label="Claims" total={claims.data.total} state={table} />
        </>
      ) : claims.loading ? (
        <PageLoading />
      ) : claims.error ? null : isFiltered(search) ? (
        <EmptyState reason="noMatches" title="No Matching Claims">
          Nothing matches these filters.
        </EmptyState>
      ) : (
        <EmptyState reason="clear" title="No Open Claims">
          Claims show up here as encounters are imported.
        </EmptyState>
      )}
    </Page>
  );
};
