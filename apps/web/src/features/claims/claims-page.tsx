import { nameKey } from '@ugula/billing';
import { PlayIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatCents, formatDate } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { queueInfo, TASK_FILTERS } from '../../shared/task-queues.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions, WorkLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useTableState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { CLAIM_FILTERS, ClaimStatusBadge } from './claim-status-badge.tsx';
import type { ClaimSearch, ClaimSummary, ClaimsClient } from './client.ts';

export type ClaimsPageProps = {
  client: ClaimsClient;
  live: Live;
  search: ClaimSearch;
  me: string;
  startWork: (queue: string | null) => Promise<string | null>;
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

export const CLAIM_SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'firstName', label: 'First Name' },
  { name: 'lastName', label: 'Last Name' },
  { name: 'birthDate', label: 'Birth Date', type: 'date' },
  { name: 'number', label: 'Number', placeholder: 'Claim, Patient or Encounter #' },
  { name: 'status', label: 'Status', type: 'select', options: CLAIM_FILTERS, defaultValue: 'open' },
  {
    name: 'task',
    label: 'Waiting On',
    type: 'select',
    options: [{ value: '', label: 'Anything or Nothing' }, ...TASK_FILTERS]
  },
  {
    name: 'assignee',
    label: 'Assigned To',
    type: 'select',
    options: [
      { value: 'anyone', label: 'Anyone' },
      { value: 'me', label: 'Me' },
      { value: 'unassigned', label: 'Unassigned' }
    ],
    defaultValue: 'anyone'
  }
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
      { label: 'Total', isNumeric: true, sort: 'total' },
      { label: 'Balance', isNumeric: true, sort: 'balance' },
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

const isFiltered = (s: ClaimSearch) =>
  Boolean(s.firstName || s.lastName || s.birthDate || s.number || s.task) ||
  s.status !== 'open' ||
  s.assignee !== 'anyone';

export const ClaimsPage = ({ client, live, search, me, startWork }: ClaimsPageProps) => {
  const table = useTableState(PATH, CLAIM_TABLE);
  const back = table.href;
  const key = Object.values(search).join('|');
  const claims = useResource(
    `claims:${key}:${table.apiQuery}`,
    () => client.list(search, table.apiQuery),
    30_000
  );
  const [starting, setStarting] = useState(false);
  const notify = useToast();
  useLive(live, (e) => e.kind === 'claim' || e.kind === 'task', claims.reload);
  const queue = search.task && search.task !== 'any' ? search.task : null;

  const start = async () => {
    setStarting(true);
    try {
      const taskId = await startWork(queue);
      if (taskId) navigate(withBack(`/tasks/${taskId}`, back));
      else notify({ intent: 'info', title: 'Nothing is waiting on you right now' });
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not start', description: messageOf(err) });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Page
      title="Claims"
      description="Every claim from draft to paid, and the task each one is waiting on. Start Working opens the next task for you."
      actions={
        <Button isPending={starting} onClick={() => void start()}>
          <PlayIcon aria-hidden="true" className="size-4" />
          Start Working
        </Button>
      }
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
            me={me}
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
