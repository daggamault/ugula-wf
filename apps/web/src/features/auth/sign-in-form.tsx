import { type FormEvent, useState } from 'react';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { ThemeToggle } from '../../shared/ui/theme-toggle.tsx';
import type { AuthClient, AuthSession } from './client.ts';

export type SignInFormProps = {
  auth: AuthClient;
  onSuccess: (session: AuthSession) => void;
};

export const SignInForm = ({ auth, onSuccess }: SignInFormProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = await auth.signIn(email, password);
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="sign-in-heading"
      className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-neutral-200 bg-white p-7 transition-colors dark:border-neutral-800 dark:bg-neutral-900"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h1
            id="sign-in-heading"
            className="text-2xl font-extrabold tracking-tight text-neutral-950 select-none sm:text-3xl dark:text-neutral-50"
          >
            ugula
          </h1>
          <ThemeToggle />
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Sign in to your account.</p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error ? <Alert intent="danger">{error}</Alert> : null}

        <fieldset disabled={submitting} className="flex flex-col gap-5">
          <Input
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <Input
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button type="submit" intent="primary" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign In'}
          </Button>
        </fieldset>
      </form>
    </section>
  );
};
