import {
  ActivityIcon,
  BadgeDollarSignIcon,
  ChartColumnIcon,
  FileUpIcon,
  ListTodoIcon,
  ReceiptTextIcon,
  SendIcon,
  SettingsIcon,
  WorkflowIcon
} from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useMemo } from 'react';
import { AuthGate } from './features/auth/auth-gate.tsx';
import type { AuthClient } from './features/auth/client.ts';
import { ClaimPage } from './features/claims/claim-page.tsx';
import { CLAIM_FILTERS, ClaimsPage } from './features/claims/claims-page.tsx';
import type { ClaimStatus, ClaimsClient } from './features/claims/client.ts';
import type { FeesClient } from './features/fees/client.ts';
import { FeesPage } from './features/fees/fees-page.tsx';
import { HealthStatus } from './features/health/health-status.tsx';
import type { ImportsClient } from './features/imports/client.ts';
import { ImportDrop } from './features/imports/import-drop.tsx';
import { ImportsPage } from './features/imports/imports-page.tsx';
import type { ReportsClient } from './features/reports/client.ts';
import { ReportPage, ReportsPage } from './features/reports/reports-page.tsx';
import type { RunStatus, RunsClient } from './features/runs/client.ts';
import { parseAt } from './features/runs/inspect.ts';
import { RunsPage } from './features/runs/runs-page.tsx';
import { StartRunPage } from './features/runs/start-run-page.tsx';
import type { SettingsClient } from './features/settings/client.ts';
import { SettingsPage } from './features/settings/settings-page.tsx';
import type { SubmissionsClient } from './features/submissions/client.ts';
import { SubmissionsPage } from './features/submissions/submissions-page.tsx';
import type { TasksClient } from './features/tasks/client.ts';
import { TaskPage } from './features/tasks/task-page.tsx';
import { TasksPage } from './features/tasks/tasks-page.tsx';
import { useWorkAlerts } from './features/tasks/work-alerts.ts';
import type { WorkflowsClient } from './features/workflows/client.ts';
import { parseTrail } from './features/workflows/trail.ts';
import { WorkflowsPage } from './features/workflows/workflows-page.tsx';
import { createLive, type Live, useLiveStatus } from './shared/live.ts';
import { matchPath, navigate, useLocation } from './shared/router.tsx';
import { PageLoading } from './shared/ui/page.tsx';
import { Shell } from './shared/ui/shell.tsx';
import { ToastProvider, useToast } from './shared/ui/toast.tsx';

export type AppClients = {
  auth: AuthClient;
  workflows: WorkflowsClient;
  runs: RunsClient;
  tasks: TasksClient;
  imports: ImportsClient;
  fees: FeesClient;
  claims: ClaimsClient;
  settings: SettingsClient;
  submissions: SubmissionsClient;
  reports: ReportsClient;
};

export type RouteContext = AppClients & {
  live: Live;
};

type Route = {
  pattern: string;
  render: (params: Record<string, string>, query: URLSearchParams, ctx: RouteContext) => ReactNode;
};

const EditorPage = lazy(() =>
  import('./features/workflows/editor-page.tsx').then((m) => ({ default: m.EditorPage }))
);

const RunPage = lazy(() =>
  import('./features/runs/run-page.tsx').then((m) => ({ default: m.RunPage }))
);

export const HOME = '/tasks';

export const SECTIONS = [
  { id: 'tasks', label: 'Tasks', href: '/tasks', icon: ListTodoIcon, group: 'Work' },
  { id: 'claims', label: 'Claims', href: '/claims', icon: ReceiptTextIcon, group: 'Work' },
  { id: 'submissions', label: 'Submissions', href: '/submissions', icon: SendIcon, group: 'Work' },
  { id: 'imports', label: 'Imports', href: '/imports', icon: FileUpIcon, group: 'Work' },
  { id: 'reports', label: 'Reports', href: '/reports', icon: ChartColumnIcon, group: 'Work' },
  {
    id: 'workflows',
    label: 'Workflows',
    href: '/workflows',
    icon: WorkflowIcon,
    group: 'Automation'
  },
  { id: 'runs', label: 'Runs', href: '/runs', icon: ActivityIcon, group: 'Automation' },
  { id: 'fees', label: 'Fees', href: '/fees', icon: BadgeDollarSignIcon, group: 'Admin' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: SettingsIcon, group: 'Admin' }
] as const;

const RUN_STATUSES: readonly RunStatus[] = [
  'running',
  'suspended',
  'completed',
  'faulted',
  'failed',
  'cancelled'
];

const statusParam = (query: URLSearchParams) =>
  RUN_STATUSES.find((s) => s === query.get('status')) ?? null;

const claimStatusParam = (query: URLSearchParams): ClaimStatus =>
  CLAIM_FILTERS.find((f) => f.value === query.get('status'))?.value ?? 'open';

const versionParam = (query: URLSearchParams) => {
  const version = Number(query.get('version'));
  return Number.isInteger(version) && version > 0 ? version : null;
};

const routes: readonly Route[] = [
  { pattern: '/workflows', render: (_, __, c) => <WorkflowsPage client={c.workflows} /> },
  {
    pattern: '/workflows/:id',
    render: (p, q, c) => (
      <EditorPage
        client={c.workflows}
        graphId={p.id ?? ''}
        version={versionParam(q)}
        trail={parseTrail(q.get('trail'))}
      />
    )
  },
  {
    pattern: '/runs',
    render: (_, q, c) => <RunsPage client={c.runs} live={c.live} status={statusParam(q)} />
  },
  {
    pattern: '/runs/new',
    render: (_, q, c) => <StartRunPage client={c.runs} graphId={q.get('graph') ?? ''} />
  },
  {
    pattern: '/runs/:id',
    render: (p, q, c) => (
      <RunPage client={c.runs} live={c.live} runId={p.id ?? ''} at={parseAt(q.get('at'))} />
    )
  },
  { pattern: '/imports', render: (_, __, c) => <ImportsPage client={c.imports} live={c.live} /> },
  {
    pattern: '/claims',
    render: (_, q, c) => <ClaimsPage client={c.claims} live={c.live} status={claimStatusParam(q)} />
  },
  {
    pattern: '/claims/:id',
    render: (p, _, c) => <ClaimPage client={c.claims} live={c.live} claimId={p.id ?? ''} />
  },
  {
    pattern: '/submissions',
    render: (_, __, c) => <SubmissionsPage client={c.submissions} live={c.live} />
  },
  { pattern: '/reports', render: () => <ReportsPage /> },
  {
    pattern: '/reports/:id',
    render: (p, q, c) => <ReportPage client={c.reports} reportId={p.id ?? ''} query={q} />
  },
  { pattern: '/fees', render: (_, __, c) => <FeesPage client={c.fees} /> },
  { pattern: '/settings', render: (_, __, c) => <SettingsPage client={c.settings} /> },
  {
    pattern: '/tasks',
    render: (_, q, c) => <TasksPage client={c.tasks} live={c.live} queue={q.get('queue')} />
  },
  {
    pattern: '/tasks/:id',
    render: (p, _, c) => <TaskPage client={c.tasks} live={c.live} taskId={p.id ?? ''} />
  }
];

export const resolveRoute = (path: string, query: URLSearchParams, ctx: RouteContext) => {
  for (const route of routes) {
    const params = matchPath(route.pattern, path);
    if (params) return route.render(params, query, ctx);
  }
  return null;
};

export type WorkspaceProps = {
  clients: AppClients;
  path: string;
  query: URLSearchParams;
  email: string;
  sseUrl: string;
  onSignOut: () => void;
};

export const Workspace = ({ clients, path, query, email, sseUrl, onSignOut }: WorkspaceProps) => {
  const live = useMemo(() => createLive(sseUrl), [sseUrl]);
  const liveStatus = useLiveStatus(live);
  const openTasks = useWorkAlerts(clients.tasks, live, useToast(), path.startsWith('/tasks'));
  const page = resolveRoute(path, query, { ...clients, live });
  const missing = page === null;

  useEffect(() => () => live.close(), [live]);

  useEffect(() => {
    if (missing) navigate(HOME, { replace: true });
  }, [missing]);

  return (
    <Shell
      path={path}
      navItems={SECTIONS.map((s) => ({
        ...s,
        active: path.startsWith(s.href),
        ...(s.id === 'tasks' && openTasks ? { badge: openTasks } : {})
      }))}
      userEmail={email}
      status={<HealthStatus status={liveStatus} />}
      onSignOut={onSignOut}
    >
      <Suspense fallback={<PageLoading />}>{page}</Suspense>
      <ImportDrop client={clients.imports} />
    </Shell>
  );
};

export const App = ({ clients }: { clients: AppClients }) => {
  const { path, query } = useLocation(HOME);
  return (
    <AuthGate auth={clients.auth}>
      {(session, signOut) => (
        <ToastProvider>
          <Workspace
            clients={clients}
            path={path}
            query={query}
            email={session.user.email}
            sseUrl={session.sseUrl}
            onSignOut={signOut}
          />
        </ToastProvider>
      )}
    </AuthGate>
  );
};
