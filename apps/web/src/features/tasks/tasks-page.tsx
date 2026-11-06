import { formatAgo, formatDay } from '../../shared/format.ts';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { assigneeOf, queueInfo } from '../../shared/task-queues.ts';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterSelect } from '../../shared/ui/filter-select.tsx';
import { Highlight, NumberHighlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import {
  type SearchView,
  useFilterHref,
  useSearchState,
  withBack
} from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { QueueSummary, TaskFilter, TaskRow, TasksClient } from './client.ts';

export const TASKS_PATH = '/tasks';

const TASK_TABLE = {
  sorts: {
    waiting: 'asc',
    priority: 'desc',
    due: 'asc',
    title: 'asc',
    queue: 'asc',
    claim: 'desc',
    assignee: 'asc'
  },
  sort: 'waiting'
} as const;

type TasksPageProps = {
  client: TasksClient;
  live: Live;
  me: string;
  filter: TaskFilter;
};

type FilterHref = (name: string, value: string | null) => string;

export const queueOptions = (
  queues: readonly QueueSummary[],
  current: string | null,
  href: FilterHref
) => [
  { value: '', label: 'All Queues', href: href('queue', null) },
  ...queues.map((q) => ({
    value: q.queue,
    label: `${queueInfo(q.queue).label} (${q.open})`,
    href: href('queue', q.queue)
  })),
  ...(current && !queues.some((q) => q.queue === current)
    ? [{ value: current, label: `${queueInfo(current).label} (0)`, href: href('queue', current) }]
    : [])
];

export const assigneeOptions = (href: FilterHref) => [
  { value: 'all', label: 'Anyone', href: href('assignee', null) },
  { value: 'mine', label: 'Assigned to Me', href: href('assignee', 'mine') },
  { value: 'unassigned', label: 'Unassigned', href: href('assignee', 'unassigned') }
];

const isOverdue = (due: string | null, now = Date.now()) =>
  due !== null && new Date(due).getTime() < now;

const patientOf = (t: TaskRow) => (t.last_name ? `${t.last_name}, ${t.first_name ?? ''}` : null);

export const TasksTable = ({
  tasks,
  search,
  me = ''
}: {
  tasks: readonly TaskRow[];
  search?: SearchView;
  me?: string;
}) => {
  const q = search?.q ?? '';
  const back = search?.href ?? TASKS_PATH;
  return (
    <Table
      label="Tasks"
      {...(search ? { sorting: search } : {})}
      head={[
        { label: 'Task', sort: 'title' },
        { label: 'Queue', isSecondary: true, sort: 'queue' },
        { label: 'Claim', sort: 'claim' },
        { label: 'Assignee', sort: 'assignee' },
        { label: 'Due', isSecondary: true, sort: 'due' },
        { label: 'Waiting', sort: 'waiting' },
        { label: 'Actions', isLabelHidden: true, isCompact: true }
      ]}
    >
      {tasks.map((t) => {
        const patient = patientOf(t);
        return (
          <TableRow key={t.id}>
            <TableCell kind="wrap">
              <span className="flex flex-col gap-0.5">
                <span className={t.kind === 'fault' ? 'text-danger font-medium' : 'font-medium'}>
                  <Highlight text={t.title} query={q} />
                </span>
                {t.subject ? (
                  <span className="text-surface-fg-muted text-xs">
                    <Highlight text={t.subject} query={q} />
                  </span>
                ) : null}
              </span>
            </TableCell>
            <TableCell isMuted isSecondary>
              {queueInfo(t.queue).label}
            </TableCell>
            <TableCell>
              {t.claim_number !== null ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    <NumberHighlight number={t.claim_number} query={q} />
                  </span>
                  <span className="text-surface-fg-muted text-xs">
                    {patient ? <Highlight text={patient} query={q} /> : 'Not matched yet'}
                  </span>
                </span>
              ) : (
                <span className="text-surface-fg-muted">{emptyValue}</span>
              )}
            </TableCell>
            <TableCell isMuted={!t.assignee_email}>{assigneeOf(t.assignee_email, me)}</TableCell>
            <TableCell kind="date" isSecondary>
              <span className={isOverdue(t.due_at) ? 'text-danger font-medium' : undefined}>
                {t.due_at ? formatDay(t.due_at) : emptyValue}
              </span>
            </TableCell>
            <TableCell kind="date" isMuted>
              {formatAgo(t.created_at)}
            </TableCell>
            <TableCell kind="actions">
              <RowActions>
                <OpenLink to={withBack(`/tasks/${t.id}`, back)} name={`task ${t.title}`} />
              </RowActions>
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
};

export const TasksPage = ({ client, live, me, filter }: TasksPageProps) => {
  const search = useSearchState(TASKS_PATH, TASK_TABLE);
  const filterHref = useFilterHref(TASKS_PATH);
  const queues = useResource('task-queues', client.queues, 60_000);
  const tasks = useResource(
    `tasks:${filter.queue ?? ''}:${filter.assignee}:${search.apiQuery}`,
    (signal) => client.list(filter, search.apiQuery, signal),
    30_000
  );
  const ids = tasks.data?.items.map((t) => t.id) ?? [];
  useLive(
    live,
    (e) => e.kind === 'task' && (e.id === null || isOnPage(e.id, search.page, ids)),
    () => {
      tasks.reload();
      queues.reload();
    },
    LIST_RELOAD_MS
  );
  return (
    <Page title="Tasks">
      <Search
        label="Tasks"
        path={TASKS_PATH}
        search={search}
        results={tasks}
        filters={
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              id="tasks-queue"
              label="Queue"
              value={filter.queue ?? ''}
              options={queueOptions(queues.data ?? [], filter.queue, filterHref)}
            />
            <FilterSelect
              id="tasks-assignee"
              label="Assignee"
              value={filter.assignee}
              options={assigneeOptions(filterHref)}
            />
          </div>
        }
        isFiltered={filter.queue !== null || filter.assignee !== 'all'}
        empty={{ title: 'All Caught Up', children: 'New tasks show up here as claims need work.' }}
      >
        {(items) => <TasksTable tasks={items} search={search} me={me} />}
      </Search>
    </Page>
  );
};
