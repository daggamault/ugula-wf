import { formatAgo, formatDay, patientName } from '../../shared/format.ts';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { assigneeOf, queueInfo } from '../../shared/task-queues.ts';
import type { ColumnFilter } from '../../shared/ui/column-filters.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight, NumberHighlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useSearchState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { TaskRow, TasksClient } from './client.ts';

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
  sort: 'waiting',
  filters: ['queue', 'assignee']
} as const;

type TasksPageProps = {
  client: TasksClient;
  live: Live;
  me: string;
};

const UNASSIGNED = 'none';

const taskFilters = (me: string): readonly ColumnFilter[] => [
  { key: 'queue', label: 'Queue', labelOf: (o) => queueInfo(o.value).label },
  {
    key: 'assignee',
    label: 'Assignee',
    labelOf: (o) => assigneeOf(o.value === UNASSIGNED ? null : (o.label ?? o.value), me)
  }
];

const isOverdue = (due: string | null, now = Date.now()) =>
  due !== null && new Date(due).getTime() < now;

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
        const patient = patientName(t.last_name, t.first_name);
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

export const TasksPage = ({ client, live, me }: TasksPageProps) => {
  const search = useSearchState(TASKS_PATH, TASK_TABLE);
  const tasks = useResource(
    `tasks:${search.apiQuery}`,
    (signal) => client.list(search.apiQuery, signal),
    30_000
  );
  const ids = tasks.data?.items.map((t) => t.id) ?? [];
  useLive(
    live,
    (e) => e.kind === 'task' && (e.id === null || isOnPage(e.id, search.page, ids)),
    tasks.reload,
    LIST_RELOAD_MS
  );
  return (
    <Page title="Tasks">
      <Search
        label="Tasks"
        path={TASKS_PATH}
        search={search}
        results={tasks}
        filters={taskFilters(me)}
        empty={{ title: 'All Caught Up', children: 'New tasks show up here as claims need work.' }}
      >
        {(items) => <TasksTable tasks={items} search={search} me={me} />}
      </Search>
    </Page>
  );
};
