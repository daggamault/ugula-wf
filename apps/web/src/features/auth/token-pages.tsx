import { isLongEnoughPassword, PASSWORD_TOO_SHORT } from '@ugula/access';
import { CheckIcon, KeyRoundIcon, LogInIcon } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { BrandHeader } from '../../shared/ui/brand.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Card } from '../../shared/ui/card.tsx';
import { Centered } from '../../shared/ui/centered.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { PageLoading } from '../../shared/ui/page.tsx';
import { usePending } from '../../shared/use-pending.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { AuthClient } from './client.ts';

export const passwordProblem = (password: string, confirm: string) =>
  !isLongEnoughPassword(password)
    ? `${PASSWORD_TOO_SHORT}.`
    : password !== confirm
      ? 'The passwords do not match.'
      : null;

export const pathWithoutToken = (location: { pathname: string; search: string }) => {
  const query = new URLSearchParams(location.search);
  if (!query.has('token')) return null;
  query.delete('token');
  return query.size ? `${location.pathname}?${query}` : location.pathname;
};

const useLinkToken = (token: string) => {
  const [kept] = useState(token);
  useEffect(() => {
    const clean = pathWithoutToken(window.location);
    if (clean) navigate(clean, { replace: true });
  }, []);
  return kept;
};

export const InvitationPage = ({ auth, token }: { auth: AuthClient; token: string }) => {
  const link = useLinkToken(token);
  const preview = useResource(`invitation:${link}`, () => auth.previewInvitation(link));
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
      await auth.acceptInvitation(link, password);
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
  const link = useLinkToken(token);
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
      await auth.setPassword(link, password);
      setDone(true);
    });
  };
  return (
    <Centered>
      <Card labelledBy="password-heading">
        <BrandHeader
          id="password-heading"
          description="Choose the password you will sign in with from now on."
        >
          Set Your Password
        </BrandHeader>
        {done ? (
          <div className="flex flex-col gap-5">
            <Alert intent="success">Your password is set. Sign in with it now.</Alert>
            <Button isBlock onClick={() => navigate('/', { replace: true })}>
              <LogInIcon aria-hidden="true" className="size-4" />
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
