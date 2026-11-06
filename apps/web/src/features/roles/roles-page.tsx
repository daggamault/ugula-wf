import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { messageOf } from '../../shared/api.ts';
import { formatDateTime } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { DeleteDialog } from '../../shared/ui/dialog.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { DeleteButton, EditLink, OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { type SearchView, useSearchState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Role, RolesClient } from './client.ts';

export const ROLES_PATH = '/roles';

export const ROLE_TABLE = {
  sorts: { name: 'asc', users: 'desc', updated: 'desc' },
  sort: 'name'
} as const;

type RolesTableProps = {
  roles: readonly Role[];
  search: SearchView;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (role: Role) => void;
};

export const RolesTable = ({ roles, search, canEdit, canDelete, onDelete }: RolesTableProps) => (
  <Table
    label="Roles"
    sorting={search}
    head={[
      { label: 'Name', sort: 'name' },
      { label: 'Permissions' },
      { label: 'Users', sort: 'users' },
      { label: 'Updated', isSecondary: true, sort: 'updated' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {roles.map((r) => {
      const to = withBack(`${ROLES_PATH}/${r.id}`, search.href);
      return (
        <TableRow key={r.id}>
          <TableCell>
            <span className="font-medium">
              <Highlight text={r.name} query={search.q} />
            </span>
          </TableCell>
          <TableCell kind="numeric">{r.permissions.length}</TableCell>
          <TableCell kind="numeric">{r.users}</TableCell>
          <TableCell kind="date" isMuted isSecondary>
            {formatDateTime(r.updatedAt)}
          </TableCell>
          <TableCell kind="actions">
            <RowActions>
              {canEdit && r.isGrantable ? (
                <EditLink to={to} name={r.name} />
              ) : (
                <OpenLink to={to} name={r.name} />
              )}
              {canDelete && r.isGrantable ? (
                <DeleteButton name={r.name} onClick={() => onDelete(r)} />
              ) : null}
            </RowActions>
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

export const RolesPage = ({ client, live }: { client: RolesClient; live: Live }) => {
  const can = useCan();
  const search = useSearchState(ROLES_PATH, ROLE_TABLE);
  const roles = useResource(`roles:${search.apiQuery}`, () => client.search(search.apiQuery));
  useReconnect(live, roles.reload);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const notify = useToast();
  const remove = async (role: Role) => {
    try {
      await client.remove(role.id);
      notify({ title: `${role.name} deleted` });
      roles.reload();
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not delete role', description: messageOf(err) });
    }
  };
  const add = withBack(`${ROLES_PATH}/new`, search.href);
  const addButton = (variant?: 'outline') =>
    can('roles:create') ? (
      <ButtonLink to={add} variant={variant}>
        <PlusIcon aria-hidden="true" className="size-4" />
        Add Role
      </ButtonLink>
    ) : undefined;
  return (
    <Page title="Roles" actions={addButton()}>
      <Search
        label="Roles"
        path={ROLES_PATH}
        search={search}
        results={roles}
        empty={{
          title: 'No Roles Yet',
          children: 'Add a role before inviting users.',
          action: addButton('outline')
        }}
      >
        {(items) => (
          <RolesTable
            roles={items}
            search={search}
            canEdit={can('roles:update')}
            canDelete={can('roles:delete')}
            onDelete={setDeleting}
          />
        )}
      </Search>
      <DeleteDialog
        open={deleting !== null}
        name={deleting?.name ?? ''}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const role = deleting;
          setDeleting(null);
          if (role) void remove(role);
        }}
      >
        Users with this role must be given another role first.
      </DeleteDialog>
    </Page>
  );
};
