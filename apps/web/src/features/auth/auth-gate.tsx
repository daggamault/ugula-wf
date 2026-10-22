import { type ReactNode, useEffect, useState } from 'react';
import { type NavItem, Shell } from '../../shared/ui/shell.tsx';
import type { AuthClient, AuthSession } from './client.ts';
import { SignInForm } from './sign-in-form.tsx';

const OVERVIEW_NAV: readonly NavItem[] = [{ id: 'overview', label: 'Overview', active: true }];

export type AuthGateProps = {
  auth: AuthClient;
  status?: ReactNode;
  children?: ReactNode;
};

export type AuthGateViewProps = {
  ready: boolean;
  session: AuthSession | null;
  auth: AuthClient;
  status?: ReactNode;
  onSessionChange: (session: AuthSession | null) => void;
  children?: ReactNode;
};

export const AuthGateView = ({
  ready,
  session,
  auth,
  status,
  onSessionChange,
  children
}: AuthGateViewProps) => {
  if (!ready) return null;

  if (!session) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-4">
        <SignInForm auth={auth} onSuccess={onSessionChange} />
      </main>
    );
  }

  return (
    <Shell
      title="Overview"
      navItems={OVERVIEW_NAV}
      userEmail={session.user.email}
      status={status}
      onSignOut={() => {
        auth
          .signOut()
          .catch(() => undefined)
          .finally(() => onSessionChange(null));
      }}
    >
      {children}
    </Shell>
  );
};

export const AuthGate = ({ auth, status, children }: AuthGateProps) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    auth
      .getMe()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setReady(true));
  }, [auth]);

  return (
    <AuthGateView
      ready={ready}
      session={session}
      auth={auth}
      status={status}
      onSessionChange={setSession}
    >
      {children}
    </AuthGateView>
  );
};
