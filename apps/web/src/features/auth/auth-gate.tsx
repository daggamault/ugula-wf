import { type ReactNode, useEffect, useState } from 'react';
import { Centered } from '../../shared/ui/centered.tsx';
import type { AuthClient, AuthSession } from './client.ts';
import { SignInForm } from './sign-in-form.tsx';

type Authenticated = (session: AuthSession, signOut: () => void) => ReactNode;

type AuthGateProps = {
  auth: AuthClient;
  children: Authenticated;
};

type AuthGateViewProps = AuthGateProps & {
  ready: boolean;
  session: AuthSession | null;
  onSessionChange: (session: AuthSession | null) => void;
};

export const AuthGateView = ({
  ready,
  session,
  auth,
  onSessionChange,
  children
}: AuthGateViewProps) => {
  if (!ready) return null;

  if (!session) {
    return (
      <Centered>
        <SignInForm auth={auth} onSuccess={onSessionChange} />
      </Centered>
    );
  }

  return children(session, () => {
    auth
      .signOut()
      .catch(() => undefined)
      .finally(() => onSessionChange(null));
  });
};

export const AuthGate = ({ auth, children }: AuthGateProps) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    auth
      .getMe()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setReady(true));
  }, [auth]);

  useEffect(() => auth.onExpired(() => setSession(null)), [auth]);

  return (
    <AuthGateView ready={ready} session={session} auth={auth} onSessionChange={setSession}>
      {children}
    </AuthGateView>
  );
};
