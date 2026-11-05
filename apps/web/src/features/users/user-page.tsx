import { KeyRoundIcon, SaveIcon, UserMinusIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { usePending } from '../../shared/use-pending.ts';
import { useResource } from '../../shared/use-resource.ts';
import { BLOCKED_MESSAGES, fullName, type UsersClient } from './client.ts';
import { LinkPanel } from './link-panel.tsx';

type UserPageProps = { client: UsersClient; userId: string; back: string };

export const UserPage = ({ client, userId, back }: UserPageProps) => {
  const can = useCan();
  const notify = useToast();
  const data = useResource(`user:${userId}`, async (signal) => ({
    user: await client.user(userId, signal),
    roles: await client.roles(signal)
  }));
  const [roleId, setRoleId] = useState<string | null>(null);
  const { busy, error, run } = usePending();
  const [link, setLink] = useState('');
  const [removing, setRemoving] = useState(false);
  if (data.error) return <PageFailure message={data.error.message} />;
  if (!data.data) return <PageLoading />;
  const { user, roles } = data.data;
  const blocked = user.blockedReason ? BLOCKED_MESSAGES[user.blockedReason] : undefined;
  const chosen = roleId ?? user.role.id;
  const options = roles.filter((r) => r.isGrantable || r.id === user.role.id);
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void run(async () => {
      await client.setRole(user.id, { roleId: chosen, version: user.version });
      notify({ title: `${fullName(user)} saved` });
      data.reload();
    });
  };
  const remove = () =>
    run(async () => {
      await client.remove(user.id);
      notify({ title: `${fullName(user)} removed` });
      navigate(back);
    });
  const resetLink = () =>
    run(async () => {
      setLink((await client.passwordLink(user.id)).link);
    });
  const editable = can('users:update') && !blocked;
  return (
    <Page
      title={fullName(user)}
      description={user.email}
      backTo={back}
      actions={
        <>
          {can('users:update') && user.blockedReason !== 'outranked' ? (
            <Button variant="outline" isPending={busy} onClick={() => void resetLink()}>
              <KeyRoundIcon aria-hidden="true" className="size-4" />
              Password Link
            </Button>
          ) : null}
          {can('users:delete') && !blocked ? (
            <Button variant="outline" intent="danger" onClick={() => setRemoving(true)}>
              <UserMinusIcon aria-hidden="true" className="size-4" />
              Remove User
            </Button>
          ) : null}
        </>
      }
    >
      {link ? (
        <LinkPanel
          title="Password Link"
          description="Send this link so they can set a new password. It expires in 24 hours."
          link={link}
        />
      ) : null}
      {blocked ? <Alert intent="info">{blocked}</Alert> : null}
      <form onSubmit={save} aria-label="Save user" className="flex flex-col gap-6">
        <SectionPanel title="Access" description="The role decides what they can do here.">
          <DetailList>
            <Detail label="Email">{user.email}</Detail>
            {user.isOwner ? (
              <Detail label="Organization">Owner, with full access to every agency</Detail>
            ) : null}
          </DetailList>
          <fieldset disabled={busy || !editable}>
            <FieldGrid>
              <Select
                id="user-role"
                label="Role"
                span={2}
                options={options.map((r) => ({ value: r.id, label: r.name }))}
                value={chosen}
                onChange={(e) => setRoleId(e.target.value)}
              />
            </FieldGrid>
          </fieldset>
        </SectionPanel>
        {error ? <Alert>{error}</Alert> : null}
        {editable ? (
          <FormActions>
            <Button
              type="submit"
              isPending={busy}
              disabledReason={
                chosen === user.role.id ? 'Choose a different role first.' : undefined
              }
            >
              <SaveIcon aria-hidden="true" className="size-4" />
              Save User
            </Button>
          </FormActions>
        ) : null}
      </form>
      <ConfirmDialog
        open={removing}
        title={`Remove ${fullName(user)}?`}
        intent="danger"
        confirmLabel="Remove User"
        confirmIcon={UserMinusIcon}
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false);
          void remove();
        }}
      >
        They lose access to this agency. Tasks assigned to them become unassigned.
      </ConfirmDialog>
    </Page>
  );
};
