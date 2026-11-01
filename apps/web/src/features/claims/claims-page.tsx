import { DownloadIcon, FileCogIcon, FolderOpenIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatCents, formatDate } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink, buttonClasses } from '../../shared/ui/button.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { pageOf, useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import type { Batch, ClaimSummary, ClaimsClient, ClaimView, PendingClaim } from './client.ts';

export type ClaimsPageProps = {
  client: ClaimsClient;
  live: Live;
  view: ClaimView;
  q: string;
};

const PATH = '/claims';

export const CLAIM_VIEWS: readonly { value: ClaimView; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'ready', label: 'Ready to submit' },
  { value: 'paid', label: 'Paid' },
  { value: 'written_off', label: 'Written off' },
  { value: 'collections', label: 'Collections' },
  { value: 'all', label: 'All' }
];

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

export const READY_TABLE = {
  sorts: { readiness: 'asc', patient: 'asc', service: 'desc', payer: 'asc', total: 'desc' },
  sort: 'readiness'
} as const;

export const READY_VALUES = {
  readiness: (c: PendingClaim) => c.issues.length,
  patient: (c: PendingClaim) => c.patient,
  service: (c: PendingClaim) => c.serviceDate,
  payer: (c: PendingClaim) => c.payer,
  total: (c: PendingClaim) => c.totalCents
};

export const matchesSearch = (c: PendingClaim, q: string) => {
  const text = `${c.patient} ${c.pcrNumber ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
};

export const selectedIds = (claims: readonly PendingClaim[], excluded: ReadonlySet<string>) =>
  claims.filter((c) => !c.issues.length && !excluded.has(c.id)).map((c) => c.id);

export const ClaimsTable = ({
  claims,
  sorting,
  showPatient = true
}: {
  claims: readonly ClaimSummary[];
  sorting?: TableSorting;
  showPatient?: boolean;
}) => (
  <Table
    label="Claims"
    {...(sorting ? { sorting } : {})}
    head={[
      ...(showPatient
        ? [
            { label: 'Patient', sort: 'patient' },
            { label: 'PCR', isSecondary: true, sort: 'pcr' },
            { label: 'Service Date', isSecondary: true, sort: 'service' }
          ]
        : [
            { label: 'Service Date', sort: 'service' },
            { label: 'PCR', isSecondary: true, sort: 'pcr' }
          ]),
      { label: 'Total', isNumeric: true, sort: 'total' },
      { label: 'Balance', isNumeric: true, sort: 'balance' },
      'Payers',
      'Status'
    ]}
  >
    {claims.map((c) => (
      <TableRow key={c.id}>
        {showPatient ? (
          <TableCell>
            <TextLink to={`/claims/${c.id}`}>
              {c.last_name}, {c.first_name}
            </TextLink>
          </TableCell>
        ) : (
          <TableCell kind="date">
            <TextLink to={`/claims/${c.id}`}>{formatDate(c.service_date)}</TextLink>
          </TableCell>
        )}
        <TableCell isMuted isSecondary>
          {c.pcr_number ?? emptyValue}
        </TableCell>
        {showPatient ? (
          <TableCell kind="date" isMuted isSecondary>
            {formatDate(c.service_date)}
          </TableCell>
        ) : null}
        <TableCell kind="numeric">{formatCents(c.total_cents)}</TableCell>
        <TableCell kind="numeric">
          <span className="font-semibold">{formatCents(c.balance_cents)}</span>
        </TableCell>
        <TableCell kind="wrap" isMuted={!c.payers.length}>
          {c.payers.length ? c.payers.join(' → ') : 'Patient only'}
        </TableCell>
        <TableCell>
          <ClaimStatusBadge status={c.status} />
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const ReadyTable = ({
  claims,
  excluded,
  sorting,
  onToggle
}: {
  claims: readonly PendingClaim[];
  excluded: ReadonlySet<string>;
  sorting?: TableSorting;
  onToggle: (id: string) => void;
}) => (
  <Table
    label="Claims ready to submit"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Include', isCompact: true },
      { label: 'Patient', sort: 'patient' },
      { label: 'PCR', isSecondary: true },
      { label: 'Service Date', isSecondary: true, sort: 'service' },
      { label: 'Payer', sort: 'payer' },
      { label: 'Total', isNumeric: true, sort: 'total' },
      { label: 'Readiness', sort: 'readiness' }
    ]}
  >
    {claims.map((c) => (
      <TableRow key={c.id}>
        <TableCell>
          <input
            type="checkbox"
            aria-label={`Include ${c.patient} in the 837P file`}
            disabled={c.issues.length > 0}
            checked={!c.issues.length && !excluded.has(c.id)}
            onChange={() => onToggle(c.id)}
            className="accent-primary size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          />
        </TableCell>
        <TableCell>
          <TextLink to={`/claims/${c.id}`}>{c.patient}</TextLink>
        </TableCell>
        <TableCell isMuted isSecondary>
          {c.pcrNumber ?? emptyValue}
        </TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDate(c.serviceDate)}
        </TableCell>
        <TableCell kind="wrap">
          <span className="flex flex-wrap items-center gap-2">
            {c.payer}
            {c.resubmission ? <Badge intent="info">Resubmission</Badge> : null}
          </span>
        </TableCell>
        <TableCell kind="numeric">{formatCents(c.totalCents)}</TableCell>
        <TableCell kind="wrap">
          {c.issues.length ? (
            <ul className="text-warning-fg flex max-w-md min-w-56 list-disc flex-col gap-1 pl-4 text-xs">
              {c.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <Badge intent="success">Ready</Badge>
          )}
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const BatchDownload = ({ batch, href }: { batch: Batch; href: string }) => (
  <a href={href} download className={buttonClasses({ variant: 'outline', size: 'sm' })}>
    <DownloadIcon aria-hidden="true" className="size-4" />
    Download #{batch.control_number}
  </a>
);

const ReadyView = ({
  client,
  claims,
  setupIssues,
  loading,
  onChanged
}: {
  client: ClaimsClient;
  claims: readonly PendingClaim[];
  setupIssues: readonly string[];
  loading: boolean;
  onChanged: () => void;
}) => {
  const table = useTableState(PATH, READY_TABLE);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<Batch | null>(null);
  const ids = selectedIds(claims, excluded);

  const generate = async () => {
    setBusy(true);
    setError('');
    setMade(null);
    try {
      setMade(await client.createBatch(ids));
      setExcluded(new Set());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  };

  return (
    <>
      {setupIssues.length ? (
        <Alert
          intent="warning"
          action={
            <ButtonLink to="/settings" variant="outline" size="sm">
              Open settings
            </ButtonLink>
          }
        >
          Finish the billing setup before submitting: {setupIssues.join('. ')}.
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {made ? (
        <Alert
          intent="success"
          action={<BatchDownload batch={made} href={client.fileUrl(made.id)} />}
        >
          837P file #{made.control_number} holds {made.claim_count}{' '}
          {made.claim_count === 1 ? 'claim' : 'claims'}. Upload it to your clearinghouse.
        </Alert>
      ) : null}
      {claims.length ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-surface-fg-muted text-sm">
              Ready claims are included unless you uncheck them. Fix the rest from their claim page.
            </p>
            <Button
              isPending={busy}
              disabledReason={
                setupIssues.length
                  ? 'Finish the billing setup first.'
                  : ids.length
                    ? undefined
                    : 'Select at least one ready claim.'
              }
              onClick={() => void generate()}
            >
              <FileCogIcon aria-hidden="true" className="size-4" />
              Create 837P file ({ids.length})
            </Button>
          </div>
          <ReadyTable
            claims={pageOf(claims, table, READY_VALUES).items}
            excluded={excluded}
            sorting={table}
            onToggle={toggle}
          />
          <Pagination label="Ready claims" total={claims.length} state={table} />
        </>
      ) : loading ? (
        <PageLoading />
      ) : (
        <EmptyState reason="clear" title="Nothing to Submit">
          Claims show up here when their next payer is waiting for a claim.
        </EmptyState>
      )}
    </>
  );
};

const ListView = ({
  client,
  live,
  view,
  q
}: {
  client: ClaimsClient;
  live: Live;
  view: Exclude<ClaimView, 'ready'>;
  q: string;
}) => {
  const table = useTableState(PATH, CLAIM_TABLE);
  const claims = useResource(
    `claims:${view}:${q}:${table.apiQuery}`,
    () => client.list({ status: view, q }, table.apiQuery),
    30_000
  );
  useLive(live, (e) => e.kind === 'claim', claims.reload);
  return (
    <>
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
          {q ? `No claims match “${q}”.` : 'No claims match this filter.'}
        </EmptyState>
      )}
    </>
  );
};

export const ClaimsPage = ({ client, live, view, q }: ClaimsPageProps) => {
  const filterHref = useFilterHref(PATH);
  const pending = useResource('claims:pending', () => client.pending(), 30_000);
  useLive(live, (e) => e.kind === 'claim', pending.reload);
  const ready = pending.data?.claims.filter((c) => matchesSearch(c, q)) ?? [];
  const readyCount = pending.data?.claims.length;
  return (
    <Page
      title="Claims"
      description="Every claim and where it stands with its payers. Submit ready claims in one 837P file."
      actions={
        <ButtonLink to="/claims/files" variant="outline">
          <FolderOpenIcon aria-hidden="true" className="size-4" />
          837P files
        </ButtonLink>
      }
    >
      <div className="flex flex-col gap-3">
        <FilterPills
          label="Filter claims"
          options={CLAIM_VIEWS.map((f) => ({
            label:
              f.value === 'ready' && readyCount !== undefined
                ? `${f.label} (${readyCount})`
                : f.label,
            href: filterHref('view', f.value === 'open' ? null : f.value),
            isSelected: f.value === view
          }))}
        />
        <SearchForm
          label="Search claims"
          path={PATH}
          fields={[{ name: 'q', label: 'Patient or PCR', placeholder: 'Doe, Jane or PCR number' }]}
        />
      </div>
      {view === 'ready' ? (
        <ReadyView
          client={client}
          claims={ready}
          setupIssues={pending.data?.issues ?? []}
          loading={pending.loading}
          onChanged={pending.reload}
        />
      ) : (
        <ListView client={client} live={live} view={view} q={q} />
      )}
    </Page>
  );
};
