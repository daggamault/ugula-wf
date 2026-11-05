import type { NodeDef } from '@ugula/graph';
import { lazy, type ReactNode } from 'react';
import type { AuthClient } from './features/auth/client.ts';
import { CLAIM_TABS, ClaimPage } from './features/claims/claim-page.tsx';
import { CLAIMS_TABS, ClaimsPage } from './features/claims/claims-page.tsx';
import { type ClaimsClient, claimSearchOf } from './features/claims/client.ts';
import { PatientClaims } from './features/claims/patient-claims.tsx';
import type { FeesClient } from './features/fees/client.ts';
import { FeePage } from './features/fees/fee-page.tsx';
import { FEES_PATH, FeesPage } from './features/fees/fees-page.tsx';
import type { ImportsClient } from './features/imports/client.ts';
import { ImportPage } from './features/imports/import-page.tsx';
import { ImportsPage } from './features/imports/imports-page.tsx';
import { type PatientsClient, searchOf } from './features/patients/client.ts';
import { PatientPage } from './features/patients/patient-page.tsx';
import { PatientsPage } from './features/patients/patients-page.tsx';
import type { PayerFilesClient } from './features/payer-files/client.ts';
import { PayerFilePage } from './features/payer-files/payer-file-page.tsx';
import { PayerFilesPage } from './features/payer-files/payer-files-page.tsx';
import type { ReportsClient } from './features/reports/client.ts';
import {
  ReportOptionsPage,
  ReportResultsPage,
  ReportsPage
} from './features/reports/reports-page.tsx';
import type { RolesClient } from './features/roles/client.ts';
import { RolePage } from './features/roles/role-page.tsx';
import { ROLES_PATH, RolesPage } from './features/roles/roles-page.tsx';
import type { RunsClient } from './features/runs/client.ts';
import { parseAt } from './features/runs/inspect.ts';
import { RunsPage } from './features/runs/runs-page.tsx';
import { StartRunPage } from './features/runs/start-run-page.tsx';
import type { SettingsClient } from './features/settings/client.ts';
import { FACILITIES_PATH, FacilitiesPage } from './features/settings/facilities-page.tsx';
import { FacilityPage } from './features/settings/facility-page.tsx';
import { PayerPage } from './features/settings/payer-page.tsx';
import { PAYERS_PATH, PayersPage } from './features/settings/payers-page.tsx';
import { SettingsPage } from './features/settings/settings-page.tsx';
import type { TasksClient } from './features/tasks/client.ts';
import { TaskPage } from './features/tasks/task-page.tsx';
import type { UsersClient } from './features/users/client.ts';
import { InvitePage } from './features/users/invite-page.tsx';
import { UserPage } from './features/users/user-page.tsx';
import { INVITATIONS_PATH, USERS_PATH, UsersPage } from './features/users/users-page.tsx';
import type { WorkflowsClient } from './features/workflows/client.ts';
import { CustomizationMapPage } from './features/workflows/customization-map-page.tsx';
import { graphKindOf, NewWorkflowPage } from './features/workflows/new-workflow-page.tsx';
import { TablePage } from './features/workflows/table-page.tsx';
import { TABLES_PATH, TablesPage, tableFilterOf } from './features/workflows/tables-page.tsx';
import { parseTrail } from './features/workflows/trail.ts';
import {
  CUSTOMIZED_PATH,
  graphFilterOf,
  WORKFLOWS_PATH,
  WorkflowsPage
} from './features/workflows/workflows-page.tsx';
import type { AgenciesClient } from './shared/access.tsx';
import type { Live } from './shared/live.ts';
import type { NotificationsClient } from './shared/notifications.ts';
import { matchPath } from './shared/router.tsx';
import { RUN_STATUSES } from './shared/ui/run-status-badge.tsx';
import { backOf } from './shared/url-state.ts';

export type AppClients = {
  auth: AuthClient;
  agencies: AgenciesClient;
  users: UsersClient;
  roles: RolesClient;
  workflows: WorkflowsClient;
  runs: RunsClient;
  tasks: TasksClient;
  imports: ImportsClient;
  payerFiles: PayerFilesClient;
  fees: FeesClient;
  claims: ClaimsClient;
  patients: PatientsClient;
  settings: SettingsClient;
  reports: ReportsClient;
  notifications: NotificationsClient;
};

export type RouteContext = AppClients & {
  nodes: NodeDef[];
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

const statusParam = (query: URLSearchParams) =>
  RUN_STATUSES.find((s) => s === query.get('status')) ?? null;

const versionParam = (query: URLSearchParams) => {
  const version = Number(query.get('version'));
  return Number.isInteger(version) && version > 0 ? version : null;
};

const routes: readonly Route[] = [
  {
    pattern: '/workflows',
    render: (_, q, c) => (
      <WorkflowsPage client={c.workflows} live={c.live} show={graphFilterOf(q)} />
    )
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
    pattern: CUSTOMIZED_PATH,
    render: (_, q, c) => (
      <CustomizationMapPage client={c.workflows} live={c.live} showAll={q.get('all') === 'shown'} />
    )
  },
  {
    pattern: TABLES_PATH,
    render: (_, q, c) => <TablesPage client={c.workflows} live={c.live} show={tableFilterOf(q)} />
  },
  {
    pattern: `${TABLES_PATH}/:id`,
    render: (p, q, c) => (
      <TablePage
        client={c.workflows}
        live={c.live}
        tableId={p.id ?? ''}
        version={versionParam(q)}
      />
    )
  },
  {
    pattern: '/workflows/:id',
    render: (p, q, c) => (
      <EditorPage
        client={c.workflows}
        live={c.live}
        nodes={c.nodes}
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
    render: (_, q, c) => (
      <StartRunPage client={c.runs} live={c.live} graphId={q.get('graph') ?? ''} />
    )
  },
  {
    pattern: '/runs/:id',
    render: (p, q, c) => (
      <RunPage
        client={c.runs}
        nodes={c.nodes}
        live={c.live}
        runId={p.id ?? ''}
        at={parseAt(q.get('at'))}
      />
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
    pattern: '/payer-files',
    render: (_, __, c) => <PayerFilesPage client={c.payerFiles} live={c.live} />
  },
  {
    pattern: '/payer-files/:id',
    render: (p, q, c) => (
      <PayerFilePage
        client={c.payerFiles}
        live={c.live}
        fileId={p.id ?? ''}
        back={backOf(q, '/payer-files')}
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
        tab={CLAIMS_TABS.find((t) => t.value === q.get('tab'))?.value ?? 'queue'}
        search={claimSearchOf(q)}
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
    render: (_, q, c) => <PatientsPage client={c.patients} live={c.live} search={searchOf(q)} />
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
    render: (p, q, c) => (
      <ReportResultsPage client={c.reports} live={c.live} reportId={p.id ?? ''} query={q} />
    )
  },
  { pattern: FEES_PATH, render: (_, __, c) => <FeesPage client={c.fees} live={c.live} /> },
  {
    pattern: `${FEES_PATH}/new`,
    render: (_, q, c) => (
      <FeePage client={c.fees} live={c.live} feeId={null} back={backOf(q, FEES_PATH)} />
    )
  },
  {
    pattern: `${FEES_PATH}/:id`,
    render: (p, q, c) => (
      <FeePage
        key={p.id}
        client={c.fees}
        live={c.live}
        feeId={p.id ?? ''}
        back={backOf(q, FEES_PATH)}
      />
    )
  },
  {
    pattern: PAYERS_PATH,
    render: (_, __, c) => <PayersPage client={c.settings} live={c.live} />
  },
  {
    pattern: `${PAYERS_PATH}/new`,
    render: (_, q, c) => (
      <PayerPage client={c.settings} live={c.live} payerId={null} back={backOf(q, PAYERS_PATH)} />
    )
  },
  {
    pattern: `${PAYERS_PATH}/:id`,
    render: (p, q, c) => (
      <PayerPage
        key={p.id}
        client={c.settings}
        live={c.live}
        payerId={p.id ?? ''}
        back={backOf(q, PAYERS_PATH)}
      />
    )
  },
  {
    pattern: FACILITIES_PATH,
    render: (_, __, c) => <FacilitiesPage client={c.settings} live={c.live} />
  },
  {
    pattern: `${FACILITIES_PATH}/new`,
    render: (_, q, c) => (
      <FacilityPage
        client={c.settings}
        live={c.live}
        facilityId={null}
        back={backOf(q, FACILITIES_PATH)}
      />
    )
  },
  {
    pattern: `${FACILITIES_PATH}/:id`,
    render: (p, q, c) => (
      <FacilityPage
        key={p.id}
        client={c.settings}
        live={c.live}
        facilityId={p.id ?? ''}
        back={backOf(q, FACILITIES_PATH)}
      />
    )
  },
  {
    pattern: USERS_PATH,
    render: (_, __, c) => <UsersPage client={c.users} live={c.live} tab="users" />
  },
  {
    pattern: INVITATIONS_PATH,
    render: (_, __, c) => <UsersPage client={c.users} live={c.live} tab="invitations" />
  },
  {
    pattern: `${USERS_PATH}/invite`,
    render: (_, q, c) => <InvitePage client={c.users} back={backOf(q, USERS_PATH)} />
  },
  {
    pattern: `${USERS_PATH}/:id`,
    render: (p, q, c) => (
      <UserPage key={p.id} client={c.users} userId={p.id ?? ''} back={backOf(q, USERS_PATH)} />
    )
  },
  { pattern: ROLES_PATH, render: (_, __, c) => <RolesPage client={c.roles} live={c.live} /> },
  {
    pattern: `${ROLES_PATH}/new`,
    render: (_, q, c) => <RolePage client={c.roles} roleId={null} back={backOf(q, ROLES_PATH)} />
  },
  {
    pattern: `${ROLES_PATH}/:id`,
    render: (p, q, c) => (
      <RolePage key={p.id} client={c.roles} roleId={p.id ?? ''} back={backOf(q, ROLES_PATH)} />
    )
  },
  {
    pattern: '/settings',
    render: (_, __, c) => <SettingsPage client={c.settings} live={c.live} />
  },
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
