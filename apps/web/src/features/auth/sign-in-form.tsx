import { LogInIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { BrandHeader } from '../../shared/ui/brand.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Card } from '../../shared/ui/card.tsx';
import { Input } from '../../shared/ui/input.tsx';
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
      setError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card labelledBy="sign-in-heading">
      <BrandHeader id="sign-in-heading">Sign in to your account</BrandHeader>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" isBlock isPending={submitting}>
          <LogInIcon aria-hidden="true" className="size-4" />
          Sign in
        </Button>
      </form>
    </Card>
  );
};
