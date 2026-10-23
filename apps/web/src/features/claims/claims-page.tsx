import { formatCents, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
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

export const ClaimsTable = ({ claims }: { claims: readonly ClaimSummary[] }) => (
  <Table
    label="Claims"
    head={[
      'Patient',
      { label: 'PCR', isSecondary: true },
      { label: 'Level', isSecondary: true },
      { label: 'Total', isNumeric: true },
      { label: 'Balance', isNumeric: true },
      'Payers',
      'Status',
      { label: 'Opened', isSecondary: true }
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
          {formatDateTime(c.created_at)}
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const ClaimsPage = ({ client, live, status }: ClaimsPageProps) => {
  const claims = useResource(`claims:${status}`, () => client.list(status), 30_000);
  useLive(live, claims.reload);
  return (
    <Page title="Claims" description="Priced claims and where each one is in its payer cycle.">
      <FilterPills
        label="Filter claims by status"
        options={CLAIM_FILTERS.map((f) => ({
          label: f.label,
          href: `/claims?status=${f.value}`,
          isSelected: f.value === status
        }))}
      />
      {claims.error ? <Alert>{claims.error.message}</Alert> : null}
      {claims.data?.length ? (
        <ClaimsTable claims={claims.data} />
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
