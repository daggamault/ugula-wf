import { SendIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { usePending } from '../../shared/use-pending.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { InviteInput, UsersClient } from './client.ts';
import { LinkPanel } from './link-panel.tsx';

const EMPTY: InviteInput = { email: '', firstName: '', lastName: '', roleId: '' };

export const inviteProblem = (input: InviteInput) =>
  !input.firstName.trim() || !input.lastName.trim()
    ? 'Enter their first and last name.'
    : !/^\S+@\S+\.\S+$/.test(input.email.trim())
      ? 'Enter their email address.'
      : !input.roleId
        ? 'Choose a role.'
        : null;

export const InvitePage = ({ client, back }: { client: UsersClient; back: string }) => {
  const roles = useResource('invite-roles', client.roles);
  const [draft, setDraft] = useState(EMPTY);
  const { busy, error, setError, run } = usePending();
  const [link, setLink] = useState('');
  if (roles.error) return <PageFailure message={roles.error.message} />;
  if (!roles.data) return <PageLoading />;
  const grantable = roles.data.filter((r) => r.isGrantable);
  const choice = (key: keyof InviteInput) => ({
    value: draft[key],
    onChange: (v: string) => setDraft({ ...draft, [key]: v })
  });
  const field = (key: keyof InviteInput) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => choice(key).onChange(e.target.value)
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = inviteProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      setLink((await client.invite({ ...draft, email: draft.email.trim() })).link);
    });
  };
  return (
    <Page title="Invite User" backTo={back}>
      {link ? (
        <LinkPanel
          title={`Invitation for ${draft.firstName} ${draft.lastName}`}
          description="Send this link to them. It works once and expires in 7 days."
          link={link}
        />
      ) : (
        <form onSubmit={submit} aria-label="Invite user" className="flex flex-col gap-6">
          <SectionPanel title="Person">
            <fieldset disabled={busy}>
              <FieldGrid>
                <Input id="invite-first" label="First Name" span={2} {...field('firstName')} />
                <Input id="invite-last" label="Last Name" span={2} {...field('lastName')} />
                <Input id="invite-email" label="Email" type="email" span={2} {...field('email')} />
                <Select
                  id="invite-role"
                  label="Role"
                  span={2}
                  hint="You can only give roles whose permissions you hold."
                  options={[
                    { value: '', label: 'Choose a role' },
                    ...grantable.map((r) => ({ value: r.id, label: r.name }))
                  ]}
                  {...choice('roleId')}
                />
              </FieldGrid>
            </fieldset>
          </SectionPanel>
          {error ? <Alert>{error}</Alert> : null}
          <FormActions>
            <ButtonLink to={back} variant="outline">
              <XIcon aria-hidden="true" className="size-4" />
              Cancel
            </ButtonLink>
            <Button type="submit" isPending={busy}>
              <SendIcon aria-hidden="true" className="size-4" />
              Invite
            </Button>
          </FormActions>
        </form>
      )}
    </Page>
  );
};
