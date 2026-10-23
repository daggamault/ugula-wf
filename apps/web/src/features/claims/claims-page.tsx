import { formatCents, formatDate } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import type { ClaimStatus, ClaimSummary, ClaimsClient } from './client.ts';

export type ClaimsPageProps = {
  client: ClaimsClient;
  live: Live;
  status: ClaimStatus;
};

export const CLAIM_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'paid', label: 'Paid' },
  { value: 'written_off', label: 'Written off' },
  { value: 'collections', label: 'Collections' }
] as const;

export const CLAIM_TABLE = {
  sorts: {
    created: 'desc',
    service: 'desc',
    patient: 'asc',
    pcr: 'asc',
    total: 'desc',
    balance: 'desc'
  },
  sort: 'created'
} as const;

export const ClaimsTable = ({
  claims,
  sorting
}: {
  claims: readonly ClaimSummary[];
  sorting?: TableSorting;
}) => (
  <Table
    label="Claims"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Patient', sort: 'patient' },
      { label: 'PCR', isSecondary: true, sort: 'pcr' },
      { label: 'Level', isSecondary: true },
      { label: 'Total', isNumeric: true, sort: 'total' },
      { label: 'Balance', isNumeric: true, sort: 'balance' },
      'Payers',
      'Status',
      { label: 'Service Date', isSecondary: true, sort: 'service' }
    ]}
  >
    {claims.map((c) => (
      <TableRow key={c.id}>
        <TableCell>
          <TextLink to={`/claims/${c.id}`}>
            {c.last_name}, {c.first_name}
          </TextLink>
        </TableCell>
        <TableCell isMuted isSecondary>
          {c.pcr_number ?? emptyValue}
        </TableCell>
        <TableCell isMuted isSecondary>
          {c.level}
        </TableCell>
        <TableCell kind="numeric">{formatCents(c.total_cents)}</TableCell>
        <TableCell kind="numeric">
          <span className="font-semibold">{formatCents(c.balance_cents)}</span>
        </TableCell>
        <TableCell isMuted={!c.payers.length}>
          {c.payers.length ? c.payers.join(' → ') : 'None yet'}
        </TableCell>
        <TableCell>
          <ClaimStatusBadge status={c.status} />
        </TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDate(c.service_date)}
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const ClaimsPage = ({ client, live, status }: ClaimsPageProps) => {
  const table = useTableState('/claims', CLAIM_TABLE);
  const filterHref = useFilterHref('/claims');
  const claims = useResource(
    `claims:${status}:${table.apiQuery}`,
    () => client.list(status, table.apiQuery),
    30_000
  );
  useLive(live, (e) => e.kind === 'claim', claims.reload);
  return (
    <Page title="Claims" description="Priced claims and where each one is in its payer cycle.">
      <FilterPills
        label="Filter claims by status"
        options={CLAIM_FILTERS.map((f) => ({
          label: f.label,
          href: filterHref('status', f.value === 'open' ? null : f.value),
          isSelected: f.value === status
        }))}
      />
      {claims.error ? <Alert>{claims.error.message}</Alert> : null}
      {claims.data?.items.length ? (
        <>
          <ClaimsTable claims={claims.data.items} sorting={table} />
          <Pagination label="Claims" total={claims.data.total} state={table} />
        </>
      ) : claims.loading ? (
        <PageLoading />
      ) : (
        <EmptyState reason="noMatches" title="No Claims">
          No claims match this filter.
        </EmptyState>
      )}
    </Page>
  );
};
