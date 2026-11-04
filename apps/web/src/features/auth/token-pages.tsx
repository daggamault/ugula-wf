import { CheckIcon, KeyRoundIcon } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { BrandHeader } from '../../shared/ui/brand.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Card } from '../../shared/ui/card.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { PageLoading } from '../../shared/ui/page.tsx';
import { ThemeToggle } from '../../shared/ui/theme-toggle.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { AuthClient } from './client.ts';

const Centered = ({ children }: { children: ReactNode }) => (
  <main className="grid min-h-dvh place-items-center p-4">
    <div className="fixed top-4 right-4">
      <ThemeToggle tooltipSide="left" />
    </div>
    {children}
  </main>
);

export const MIN_PASSWORD = 12;

export const passwordProblem = (password: string, confirm: string) =>
  password.length < MIN_PASSWORD
    ? `Use at least ${MIN_PASSWORD} characters.`
    : password !== confirm
      ? 'The passwords do not match.'
      : null;

const usePending = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
};

export const InvitationPage = ({ auth, token }: { auth: AuthClient; token: string }) => {
  const preview = useResource(`invitation:${token}`, () => auth.previewInvitation(token));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, setError, run } = usePending();
  if (preview.loading && !preview.data) return <PageLoading />;
  const invite = preview.data;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = invite?.hasAccount ? null : passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      await auth.acceptInvitation(token, password);
      window.location.assign('/');
    });
  };
  return (
    <Centered>
      <Card labelledBy="invitation-heading">
        <BrandHeader id="invitation-heading">
          {invite ? `Join ${invite.agencyName}` : 'Invitation'}
        </BrandHeader>
        {invite ? (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <p className="text-surface-fg-muted text-sm">
              {invite.firstName}, you were invited to {invite.organizationName} as {invite.roleName}
              .{' '}
              {invite.hasAccount
                ? `Enter the password for ${invite.email} to accept.`
                : `Choose a password for ${invite.email}.`}
            </p>
            <fieldset disabled={busy} className="flex flex-col gap-5">
              <Input
                id="invitation-password"
                label="Password"
                type="password"
                autoComplete={invite.hasAccount ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {invite.hasAccount ? null : (
                <Input
                  id="invitation-confirm"
                  label="Confirm Password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </fieldset>
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" isBlock isPending={busy}>
              <CheckIcon aria-hidden="true" className="size-4" />
              Accept Invitation
            </Button>
          </form>
        ) : (
          <Alert>{preview.error?.message ?? 'This link is invalid or has expired.'}</Alert>
        )}
      </Card>
    </Centered>
  );
};

export const PasswordPage = ({ auth, token }: { auth: AuthClient; token: string }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = usePending();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      await auth.setPassword(token, password);
      setDone(true);
    });
  };
  return (
    <Centered>
      <Card labelledBy="password-heading">
        <BrandHeader id="password-heading">Set Your Password</BrandHeader>
        {done ? (
          <div className="flex flex-col gap-5">
            <Alert intent="success">Your password is set. Sign in with it now.</Alert>
            <Button isBlock onClick={() => navigate('/', { replace: true })}>
              Sign In
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <fieldset disabled={busy} className="flex flex-col gap-5">
              <Input
                id="new-password"
                label="New Password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                id="confirm-password"
                label="Confirm Password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </fieldset>
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" isBlock isPending={busy}>
              <KeyRoundIcon aria-hidden="true" className="size-4" />
              Set Password
            </Button>
          </form>
        )}
      </Card>
    </Centered>
  );
};
