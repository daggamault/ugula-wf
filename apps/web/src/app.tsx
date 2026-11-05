import type { NodeDef } from '@ugula/graph';
import { Suspense, useEffect, useMemo } from 'react';
import { ChooseAgencyPage } from './features/agencies/choose-agency-page.tsx';
import { AuthGate } from './features/auth/auth-gate.tsx';
import { InvitationPage, PasswordPage } from './features/auth/token-pages.tsx';
import { HealthStatus } from './features/health/health-status.tsx';
import { ImportDrop } from './features/imports/import-drop.tsx';
import { useWorkAlerts } from './features/tasks/work-alerts.ts';
import { type AppClients, resolveRoute } from './routes.tsx';
import { COLLAPSIBLE_GROUPS, homeOf, SECTIONS } from './sections.ts';
import {
  AccessProvider,
  type Agency,
  rememberAgency,
  rememberedAgency,
  useAccess,
  useCan
} from './shared/access.tsx';
import { createLive, useLiveStatus } from './shared/live.ts';
import { agencyPath, navigate, useLocation } from './shared/router.tsx';
import { AgencyPicker } from './shared/ui/agency-picker.tsx';
import { NotificationsButton } from './shared/ui/notifications.tsx';
import { PageFailure, PageLoading } from './shared/ui/page.tsx';
import { Shell } from './shared/ui/shell.tsx';
import { ToastProvider, useToast } from './shared/ui/toast.tsx';
import { useResource } from './shared/use-resource.ts';

const NO_SECTIONS = 'Your role in this agency opens no sections. Ask an administrator for access.';

type WorkspaceProps = {
  clients: AppClients;
  nodes: NodeDef[];
  path: string;
  query: URLSearchParams;
  email: string;
  sseUrl: string;
  agencies: readonly Agency[];
  onSignOut: () => void;
};

export const Workspace = ({
  clients,
  nodes,
  path,
  query,
  email,
  sseUrl,
  agencies,
  onSignOut
}: WorkspaceProps) => {
  const access = useAccess();
  const can = useCan();
  const live = useMemo(
    () => createLive(sseUrl, { agencyId: access.agencyId }),
    [sseUrl, access.agencyId]
  );
  const liveStatus = useLiveStatus(live);
  const openTasks = useWorkAlerts(clients.tasks, live, useToast(), path.startsWith('/tasks/'));
  const page = resolveRoute(path, query, { ...clients, nodes, live, email });
  const missing = page === null;
  const home = homeOf(can);

  useEffect(() => () => live.close(), [live]);

  useEffect(() => {
    if (missing && home) navigate(home, { replace: true });
  }, [missing, home]);

  return (
    <Shell
      path={path}
      navItems={SECTIONS.filter((s) => can(s.permission)).map(({ permission: _, ...s }) => ({
        ...s,
        active: path.startsWith(s.href),
        ...(s.id === 'tasks' && openTasks ? { badge: openTasks } : {})
      }))}
      collapsibleGroups={COLLAPSIBLE_GROUPS}
      userEmail={email}
      status={<HealthStatus status={liveStatus} />}
      tools={<NotificationsButton client={clients.notifications} live={live} />}
      agencyPicker={
        <AgencyPicker
          agencies={agencies}
          current={{
            id: access.agencyId,
            name: access.agencyName,
            organizationName: access.organizationName
          }}
        />
      }
      onSignOut={onSignOut}
    >
      <Suspense fallback={<PageLoading />}>
        {page ?? (home ? null : <PageFailure message={NO_SECTIONS} />)}
      </Suspense>
      {can('imports:create') ? <ImportDrop client={clients.imports} /> : null}
    </Shell>
  );
};

const withQuery = (path: string, query: URLSearchParams) =>
  query.size ? `${path}?${query}` : path;

type AgencyGateProps = Omit<WorkspaceProps, 'agencies'> & {
  agencyId: string | null;
  userId: string;
};

export const AgencyGate = ({ agencyId, userId, ...workspace }: AgencyGateProps) => {
  const { clients, path, query, onSignOut } = workspace;
  const agencies = useResource(`agencies:${userId}`, clients.agencies.list);
  const access = useResource(`access:${agencyId ?? ''}`, (signal) =>
    agencyId ? clients.agencies.access(agencyId, signal) : Promise.resolve(null)
  );
  const list = agencies.data;
  const pick =
    !agencyId && list ? (list.length === 1 ? (list[0] ?? null) : rememberedAgency(list)) : null;
  const target = pick ? agencyPath(pick.id, withQuery(path, query)) : null;

  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);

  useEffect(() => {
    if (access.data) rememberAgency(access.data.agencyId);
  }, [access.data]);

  if (agencies.error) return <PageFailure message={agencies.error.message} />;
  if (!list) return <PageLoading />;
  if (!agencyId || access.error) {
    return target ? (
      <PageLoading />
    ) : (
      <ChooseAgencyPage
        agencies={list}
        notice={access.error ? 'You cannot open that agency. Choose another.' : undefined}
        onSignOut={onSignOut}
      />
    );
  }
  if (!access.data) return <PageLoading />;
  return (
    <AccessProvider access={access.data}>
      <Workspace key={agencyId} agencies={list} {...workspace} />
    </AccessProvider>
  );
};

export const App = ({ clients, nodes }: { clients: AppClients; nodes: NodeDef[] }) => {
  const { path, query, agencyId } = useLocation();
  if (path === '/invitation') {
    return <InvitationPage auth={clients.auth} token={query.get('token') ?? ''} />;
  }
  if (path === '/password') {
    return <PasswordPage auth={clients.auth} token={query.get('token') ?? ''} />;
  }
  return (
    <AuthGate auth={clients.auth}>
      {(session, signOut) => (
        <ToastProvider
          onNotify={(toast) => void clients.notifications.record(toast).catch(() => undefined)}
        >
          <AgencyGate
            clients={clients}
            nodes={nodes}
            path={path}
            query={query}
            agencyId={agencyId}
            userId={session.user.id}
            email={session.user.email}
            sseUrl={session.sseUrl}
            onSignOut={signOut}
          />
        </ToastProvider>
      )}
    </AuthGate>
  );
};
