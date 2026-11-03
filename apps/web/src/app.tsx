import {
  ActivityIcon,
  BadgeDollarSignIcon,
  Building2Icon,
  ChartColumnIcon,
  FileUpIcon,
  ReceiptTextIcon,
  SettingsIcon,
  UsersIcon,
  WorkflowIcon
} from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useMemo } from 'react';
import { AuthGate } from './features/auth/auth-gate.tsx';
import type { AuthClient } from './features/auth/client.ts';
import { CLAIM_TABS, ClaimPage } from './features/claims/claim-page.tsx';
import { ClaimsPage } from './features/claims/claims-page.tsx';
import { type ClaimsClient, claimSearchOf } from './features/claims/client.ts';
import { PatientClaims } from './features/claims/patient-claims.tsx';
import type { FeesClient } from './features/fees/client.ts';
import { FeePage } from './features/fees/fee-page.tsx';
import { FEES_PATH, FeesPage } from './features/fees/fees-page.tsx';
import { HealthStatus } from './features/health/health-status.tsx';
import type { ImportsClient } from './features/imports/client.ts';
import { ImportDrop } from './features/imports/import-drop.tsx';
import { ImportPage } from './features/imports/import-page.tsx';
import { ImportsPage } from './features/imports/imports-page.tsx';
import { type PatientsClient, searchOf } from './features/patients/client.ts';
import { PatientPage } from './features/patients/patient-page.tsx';
import { PatientsPage } from './features/patients/patients-page.tsx';
import type { ReportsClient } from './features/reports/client.ts';
import {
  ReportOptionsPage,
  ReportResultsPage,
  ReportsPage
} from './features/reports/reports-page.tsx';
import type { RunsClient } from './features/runs/client.ts';
import { parseAt } from './features/runs/inspect.ts';
import { RunsPage } from './features/runs/runs-page.tsx';
import { StartRunPage } from './features/runs/start-run-page.tsx';
import type { SettingsClient } from './features/settings/client.ts';
import { PayerPage } from './features/settings/payer-page.tsx';
import { PAYERS_PATH, PayersPage } from './features/settings/payers-page.tsx';
import { SettingsPage } from './features/settings/settings-page.tsx';
import type { TasksClient } from './features/tasks/client.ts';
import { TaskPage } from './features/tasks/task-page.tsx';
import { useWorkAlerts } from './features/tasks/work-alerts.ts';
import type { WorkflowsClient } from './features/workflows/client.ts';
import { graphKindOf, NewWorkflowPage } from './features/workflows/new-workflow-page.tsx';
import { parseTrail } from './features/workflows/trail.ts';
import {
  graphFilterOf,
  WORKFLOWS_PATH,
  WorkflowsPage
} from './features/workflows/workflows-page.tsx';
import { createLive, type Live, useLiveStatus } from './shared/live.ts';
import type { NotificationsClient } from './shared/notifications.ts';
import { matchPath, navigate, useLocation } from './shared/router.tsx';
import { NotificationsButton } from './shared/ui/notifications.tsx';
import { PageLoading } from './shared/ui/page.tsx';
import { RUN_STATUSES } from './shared/ui/run-status-badge.tsx';
import { Shell } from './shared/ui/shell.tsx';
import { ToastProvider, useToast } from './shared/ui/toast.tsx';
import { backOf } from './shared/url-state.ts';

export type AppClients = {
  auth: AuthClient;
  workflows: WorkflowsClient;
  runs: RunsClient;
  tasks: TasksClient;
  imports: ImportsClient;
  fees: FeesClient;
  claims: ClaimsClient;
  patients: PatientsClient;
  settings: SettingsClient;
  reports: ReportsClient;
  notifications: NotificationsClient;
};

export type RouteContext = AppClients & {
  live: Live;
  email: string;
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

export const HOME = '/claims';

export const SECTIONS = [
  { id: 'claims', label: 'Claims', href: '/claims', icon: ReceiptTextIcon, group: 'Work' },
  { id: 'patients', label: 'Patients', href: '/patients', icon: UsersIcon, group: 'Work' },
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
  { id: 'payers', label: 'Payers', href: '/payers', icon: Building2Icon, group: 'Admin' },
  { id: 'fees', label: 'Fees', href: '/fees', icon: BadgeDollarSignIcon, group: 'Admin' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: SettingsIcon, group: 'Admin' }
] as const;

const statusParam = (query: URLSearchParams) =>
  RUN_STATUSES.find((s) => s === query.get('status')) ?? null;

const versionParam = (query: URLSearchParams) => {
  const version = Number(query.get('version'));
  return Number.isInteger(version) && version > 0 ? version : null;
};

const routes: readonly Route[] = [
  {
    pattern: '/workflows',
    render: (_, q, c) => <WorkflowsPage client={c.workflows} show={graphFilterOf(q)} />
  },
  {
    pattern: `${WORKFLOWS_PATH}/new`,
    render: (_, q, c) => (
      <NewWorkflowPage
        client={c.workflows}
        kind={graphKindOf(q)}
        back={backOf(q, WORKFLOWS_PATH)}
      />
    )
  },
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
    pattern: '/imports/:id',
    render: (p, q, c) => (
      <ImportPage
        client={c.imports}
        live={c.live}
        importId={p.id ?? ''}
        back={backOf(q, '/imports')}
      />
    )
  },
  {
    pattern: '/claims',
    render: (_, q, c) => (
      <ClaimsPage
        client={c.claims}
        live={c.live}
        me={c.email}
        search={claimSearchOf(q)}
        startWork={async (queue) => (await c.tasks.next(queue))?.id ?? null}
      />
    )
  },
  {
    pattern: '/claims/:id',
    render: (p, q, c) => (
      <ClaimPage
        client={c.claims}
        live={c.live}
        me={c.email}
        claimId={p.id ?? ''}
        back={backOf(q, '/claims', '/patients/')}
        tab={CLAIM_TABS.find((t) => t.value === q.get('tab'))?.value ?? 'overview'}
      />
    )
  },
  {
    pattern: '/patients',
    render: (_, q, c) => <PatientsPage client={c.patients} search={searchOf(q)} />
  },
  {
    pattern: '/patients/:id',
    render: (p, q, c) => (
      <PatientPage
        client={c.patients}
        back={backOf(q, '/patients')}
        live={c.live}
        patientId={p.id ?? ''}
        claims={<PatientClaims client={c.claims} live={c.live} patientId={p.id ?? ''} />}
      />
    )
  },
  { pattern: '/reports', render: () => <ReportsPage /> },
  {
    pattern: '/reports/:id',
    render: (p, q) => <ReportOptionsPage key={p.id} reportId={p.id ?? ''} query={q} />
  },
  {
    pattern: '/reports/:id/results',
    render: (p, q, c) => <ReportResultsPage client={c.reports} reportId={p.id ?? ''} query={q} />
  },
  { pattern: FEES_PATH, render: (_, __, c) => <FeesPage client={c.fees} /> },
  {
    pattern: `${FEES_PATH}/new`,
    render: (_, q, c) => <FeePage client={c.fees} feeId={null} back={backOf(q, FEES_PATH)} />
  },
  {
    pattern: `${FEES_PATH}/:id`,
    render: (p, q, c) => (
      <FeePage key={p.id} client={c.fees} feeId={p.id ?? ''} back={backOf(q, FEES_PATH)} />
    )
  },
  { pattern: PAYERS_PATH, render: (_, __, c) => <PayersPage client={c.settings} /> },
  {
    pattern: `${PAYERS_PATH}/new`,
    render: (_, q, c) => (
      <PayerPage client={c.settings} payerId={null} back={backOf(q, PAYERS_PATH)} />
    )
  },
  {
    pattern: `${PAYERS_PATH}/:id`,
    render: (p, q, c) => (
      <PayerPage
        key={p.id}
        client={c.settings}
        payerId={p.id ?? ''}
        back={backOf(q, PAYERS_PATH)}
      />
    )
  },
  { pattern: '/settings', render: (_, __, c) => <SettingsPage client={c.settings} /> },
  {
    pattern: '/tasks/:id',
    render: (p, q, c) => (
      <TaskPage
        key={p.id}
        client={c.tasks}
        live={c.live}
        taskId={p.id ?? ''}
        back={q.has('back') ? backOf(q, '/claims', '/claims/', '/runs/', '/imports/') : null}
      />
    )
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
  const openTasks = useWorkAlerts(clients.tasks, live, useToast(), path.startsWith('/tasks/'));
  const page = resolveRoute(path, query, { ...clients, live, email });
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
        ...(s.id === 'claims' && openTasks ? { badge: openTasks } : {})
      }))}
      userEmail={email}
      status={<HealthStatus status={liveStatus} />}
      tools={<NotificationsButton client={clients.notifications} live={live} />}
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
        <ToastProvider
          onNotify={(toast) => void clients.notifications.record(toast).catch(() => undefined)}
        >
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
