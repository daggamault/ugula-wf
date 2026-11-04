import { nameKey } from '@ugula/billing';
import type { ReactNode } from 'react';
import { formatCents, formatDate } from '../../shared/format.ts';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { queueInfo } from '../../shared/task-queues.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions, WorkLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { Tabs } from '../../shared/ui/tabs.tsx';
import { type TableState, useTableState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import type { ClaimSearch, ClaimSummary, ClaimsClient } from './client.ts';

export type ClaimsTab = 'queue' | 'search';

type ClaimsPageProps = {
  client: ClaimsClient;
  live: Live;
  tab: ClaimsTab;
  search: ClaimSearch;
  me: string;
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
    status: 'asc',
    waiting: 'asc'
  },
  sort: 'created'
} as const;

const QUEUE_TABLE = { ...CLAIM_TABLE, sort: 'waiting' } as const;

export const CLAIMS_TABS: readonly { value: ClaimsTab; label: string; href: string }[] = [
  { value: 'queue', label: 'Queue', href: PATH },
  { value: 'search', label: 'Search', href: `${PATH}?tab=search` }
];

export const CLAIM_SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'firstName', label: 'First Name' },
  { name: 'lastName', label: 'Last Name' },
  { name: 'birthDate', label: 'Birth Date', type: 'date' },
  { name: 'number', label: 'Number', placeholder: 'Claim, Patient or Encounter #' }
];

export const claimNumber = (n: number) => `#${n}`;

export const assigneeOf = (email: string | null, me: string) =>
  email ? (email === me ? 'You' : email) : 'Unassigned';

const taskName = (c: ClaimSummary) => `${c.task_title ?? 'task'} on claim ${claimNumber(c.number)}`;

const WaitingOn = ({ claim, me }: { claim: ClaimSummary; me: string }) =>
  claim.task_id ? (
    <span className="flex flex-col gap-0.5">
      <span className={claim.task_kind === 'fault' ? 'text-danger font-medium' : 'font-medium'}>
        {claim.task_title}
        {claim.open_tasks > 1 ? (
          <span className="text-surface-fg-muted font-normal"> +{claim.open_tasks - 1} more</span>
        ) : null}
      </span>
      <span className="text-surface-fg-muted text-xs">
        {queueInfo(claim.task_queue ?? '').label} · {assigneeOf(claim.task_assignee_email, me)}
      </span>
    </span>
  ) : (
    <span className="text-surface-fg-muted">{emptyValue}</span>
  );

export const ClaimsTable = ({
  claims,
  sorting,
  showPatient = true,
  back = '',
  names,
  me = ''
}: {
  claims: readonly ClaimSummary[];
  sorting?: TableSorting;
  showPatient?: boolean;
  back?: string;
  names?: { firstName: string; lastName: string };
  me?: string;
}) => (
  <Table
    label="Claims"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Claim', sort: 'number' },
      ...(showPatient ? [{ label: 'Patient', sort: 'patient' }] : []),
      { label: 'Encounter', isSecondary: true, sort: 'pcr' },
      { label: 'Service Date', sort: 'service' },
      { label: 'Total', sort: 'total' },
      { label: 'Balance', sort: 'balance' },
      { label: 'Payers', isSecondary: true },
      { label: 'Status', sort: 'status' },
      { label: 'Waiting On', sort: 'waiting' },
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
            {c.last_name !== null && c.patient_number !== null ? (
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  <Highlight
                    text={c.last_name}
                    query={names?.lastName ?? ''}
                    isPrefix
                    keyOf={nameKey}
                  />
                  , <Highlight text={c.first_name ?? ''} query={names?.firstName ?? ''} isPrefix />
                </span>
                <span className="text-surface-fg-muted text-xs">
                  Patient {claimNumber(c.patient_number)}
                </span>
              </span>
            ) : (
              <span className="text-surface-fg-muted">Not matched yet</span>
            )}
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
        <TableCell kind="wrap">
          <WaitingOn claim={c} me={me} />
        </TableCell>
        <TableCell kind="actions">
          <RowActions>
            {c.task_id ? (
              <WorkLink to={withBack(`/tasks/${c.task_id}`, back)} name={taskName(c)} />
            ) : null}
            <OpenLink
              to={withBack(`/claims/${c.id}`, back)}
              name={`claim ${claimNumber(c.number)}`}
            />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

const isSearching = (s: ClaimSearch) =>
  Boolean(s.firstName || s.lastName || s.birthDate || s.number);

const ClaimResults = ({
  client,
  live,
  query,
  table,
  me,
  names,
  empty
}: {
  client: ClaimsClient;
  live: Live;
  query: Parameters<ClaimsClient['list']>[0];
  table: TableState<keyof typeof CLAIM_TABLE.sorts>;
  me: string;
  names?: { firstName: string; lastName: string };
  empty: ReactNode;
}) => {
  const key = Object.values(query).join('|');
  const claims = useResource(
    `claims:${key}:${table.apiQuery}`,
    (signal) => client.list(query, table.apiQuery, signal),
    30_000
  );
  const items = claims.data?.items ?? [];
  useLive(
    live,
    (e) =>
      (e.kind === 'claim' &&
        isOnPage(
          e.id,
          table.page,
          items.map((c) => c.id)
        )) ||
      (e.kind === 'task' &&
        isOnPage(
          e.id,
          table.page,
          items.map((c) => c.task_id)
        )),
    claims.reload,
    LIST_RELOAD_MS
  );
  return (
    <>
      {claims.error ? <Alert>{claims.error.message}</Alert> : null}
      {items.length && claims.data ? (
        <>
          <ClaimsTable
            claims={items}
            sorting={table}
            back={table.href}
            me={me}
            {...(names ? { names } : {})}
          />
          <Pagination label="Claims" total={claims.data.total} state={table} />
        </>
      ) : claims.loading ? (
        <PageLoading />
      ) : claims.error ? null : (
        empty
      )}
    </>
  );
};

const ClaimQueue = ({ client, live, me }: Omit<ClaimsPageProps, 'tab' | 'search'>) => {
  const table = useTableState(PATH, QUEUE_TABLE);
  return (
    <ClaimResults
      client={client}
      live={live}
      me={me}
      query={{ status: 'open' }}
      table={table}
      empty={
        <EmptyState reason="clear" title="No Open Claims">
          Claims show up here as encounters are imported.
        </EmptyState>
      }
    />
  );
};

const ClaimSearchResults = ({ client, live, me, search }: Omit<ClaimsPageProps, 'tab'>) => {
  const table = useTableState(PATH, CLAIM_TABLE);
  return (
    <>
      <SearchForm label="Search claims" path={PATH} fields={CLAIM_SEARCH_FIELDS} />
      {isSearching(search) ? (
        <ClaimResults
          client={client}
          live={live}
          me={me}
          query={{ status: 'all', ...search }}
          table={table}
          names={{ firstName: search.firstName, lastName: search.lastName }}
          empty={
            <EmptyState reason="noMatches" title="No Matching Claims">
              No claim matches this search.
            </EmptyState>
          }
        />
      ) : (
        <EmptyState reason="empty" title="Search All Claims">
          Find any claim, open or closed, by patient name, birth date or number.
        </EmptyState>
      )}
    </>
  );
};

export const ClaimsPage = ({ tab, ...props }: ClaimsPageProps) => (
  <Page
    title="Claims"
    description="Work the open claims in the queue, or search every claim by patient or number."
  >
    <Tabs
      label="Claim views"
      tabs={CLAIMS_TABS.map((t) => ({ label: t.label, href: t.href, isSelected: t.value === tab }))}
    />
    {tab === 'search' ? <ClaimSearchResults {...props} /> : <ClaimQueue {...props} />}
  </Page>
);
