import type { Permission } from '@ugula/access';
import { SaveIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { messageOf } from '../../shared/api.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { PermissionGrant, Role, RoleInput, RolesClient } from './client.ts';
import { PermissionGrid } from './permission-grid.tsx';

type RoleFormProps = {
  role: Role | null;
  grants: readonly PermissionGrant[];
  readOnly: boolean;
  back: string;
  onSave: (input: RoleInput) => Promise<string | null>;
};

export const RoleForm = ({ role, grants, readOnly, back, onSave }: RoleFormProps) => {
  const [name, setName] = useState(role?.name ?? '');
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    setBusy(true);
    setError('');
    const failure = await onSave({ name: name.trim(), permissions });
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <form onSubmit={submit} aria-label="Save role" className="flex flex-col gap-6">
      <SectionPanel title="Role">
        <fieldset disabled={busy || readOnly}>
          <FieldGrid>
            <Input
              id="role-name"
              label="Name"
              span={2}
              value={name}
              readOnly={readOnly}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldGrid>
        </fieldset>
      </SectionPanel>
      <SectionPanel title="Permissions" description="You can only grant permissions you hold.">
        <fieldset disabled={busy}>
          <PermissionGrid
            grants={grants}
            selected={permissions}
            readOnly={readOnly}
            onChange={setPermissions}
          />
        </fieldset>
      </SectionPanel>
      {error ? <Alert>{error}</Alert> : null}
      {readOnly ? null : (
        <FormActions>
          <ButtonLink to={back} variant="outline">
            <XIcon aria-hidden="true" className="size-4" />
            Cancel
          </ButtonLink>
          <Button type="submit" isPending={busy}>
            <SaveIcon aria-hidden="true" className="size-4" />
            Save Role
          </Button>
        </FormActions>
      )}
    </form>
  );
};

type RolePageProps = {
  client: RolesClient;
  roleId: string | null;
  back: string;
};

export const RolePage = ({ client, roleId, back }: RolePageProps) => {
  const can = useCan();
  const notify = useToast();
  const data = useResource(`role:${roleId ?? 'new'}`, async (signal) => ({
    grants: await client.grants(signal),
    role: roleId ? await client.role(roleId, signal) : null
  }));
  if (data.error) return <PageFailure message={data.error.message} />;
  if (!data.data) return <PageLoading />;
  const { role, grants } = data.data;
  const readOnly = role ? !can('roles:update') || !role.isGrantable : !can('roles:create');
  const save = async (input: RoleInput) => {
    try {
      if (role) await client.update(role.id, { ...input, version: role.version });
      else await client.create(input);
      notify({ title: `${input.name} saved` });
      navigate(back);
      return null;
    } catch (err) {
      return messageOf(err);
    }
  };
  return (
    <Page
      title={role ? role.name : 'New Role'}
      description={
        role
          ? `${role.users} ${role.users === 1 ? 'user has' : 'users have'} this role.`
          : undefined
      }
      backTo={back}
    >
      <RoleForm role={role} grants={grants} readOnly={readOnly} back={back} onSave={save} />
    </Page>
  );
};
