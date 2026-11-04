import { RefreshCwIcon, UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { messageOf } from '../../shared/api.ts';
import { formatDateTime } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { ConfirmDialog, DeleteDialog } from '../../shared/ui/dialog.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import {
  DeleteButton,
  EditLink,
  IconButton,
  OpenLink,
  RowActions
} from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { type SearchView, useSearchState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { type AgencyUser, fullName, type Invitation, type UsersClient } from './client.ts';
import { LinkPanel } from './link-panel.tsx';

export const USERS_PATH = '/users';

export const USER_TABLE = {
  sorts: { name: 'asc', email: 'asc', role: 'asc' },
  sort: 'name'
} as const;

export const UsersTable = ({
  users,
  search,
  canEdit
}: {
  users: readonly AgencyUser[];
  search: SearchView;
  canEdit: boolean;
}) => (
  <Table
    label="Users"
    sorting={search}
    head={[
      { label: 'Name', sort: 'name' },
      { label: 'Email', sort: 'email' },
      { label: 'Role', sort: 'role' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {users.map((u) => {
      const to = withBack(`${USERS_PATH}/${u.id}`, search.href);
      return (
        <TableRow key={u.id}>
          <TableCell>
            <span className="flex flex-wrap items-center gap-2 font-medium">
              <Highlight text={fullName(u)} query={search.q} />
              {u.blockedReason === 'self' ? <Badge>You</Badge> : null}
              {u.isOwner ? <Badge intent="primary">Owner</Badge> : null}
            </span>
          </TableCell>
          <TableCell isMuted>
            <Highlight text={u.email} query={search.q} />
          </TableCell>
          <TableCell>{u.role.name}</TableCell>
          <TableCell kind="actions">
            <RowActions>
              {canEdit && !u.blockedReason ? (
                <EditLink to={to} name={fullName(u)} />
              ) : (
                <OpenLink to={to} name={fullName(u)} />
              )}
            </RowActions>
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

const InvitationsTable = ({
  invitations,
  canInvite,
  canRemove,
  onResend,
  onRemove
}: {
  invitations: readonly Invitation[];
  canInvite: boolean;
  canRemove: boolean;
  onResend: (i: Invitation) => void;
  onRemove: (i: Invitation) => void;
}) => (
  <Table
    label="Invitations"
    head={[
      { label: 'Name' },
      { label: 'Email' },
      { label: 'Role' },
      { label: 'Expires', isSecondary: true },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {invitations.map((i) => (
      <TableRow key={i.id}>
        <TableCell>
          <span className="font-medium">{fullName(i)}</span>
        </TableCell>
        <TableCell isMuted>{i.email}</TableCell>
        <TableCell>{i.role.name}</TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {i.isExpired ? <Badge intent="warning">Expired</Badge> : formatDateTime(i.expiresAt)}
        </TableCell>
        <TableCell kind="actions">
          <RowActions>
            {canInvite && i.isGrantable ? (
              <IconButton
                label={`New Link for ${fullName(i)}`}
                icon={RefreshCwIcon}
                onClick={() => onResend(i)}
              />
            ) : null}
            {canRemove && i.isGrantable ? (
              <DeleteButton name={`invitation for ${fullName(i)}`} onClick={() => onRemove(i)} />
            ) : null}
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const UsersPage = ({ client, live }: { client: UsersClient; live: Live }) => {
  const can = useCan();
  const notify = useToast();
  const search = useSearchState(USERS_PATH, USER_TABLE);
  const users = useResource(`users:${search.apiQuery}`, () => client.search(search.apiQuery));
  const invitations = useResource('invitations', client.invitations);
  useReconnect(live, () => {
    users.reload();
    invitations.reload();
  });
  const [link, setLink] = useState<{ name: string; link: string } | null>(null);
  const [resending, setResending] = useState<Invitation | null>(null);
  const [removing, setRemoving] = useState<Invitation | null>(null);
  const resend = async (i: Invitation) => {
    try {
      const res = await client.resend(i.id);
      setLink({ name: fullName(i), link: res.link });
      invitations.reload();
    } catch (err) {
      notify({
        intent: 'danger',
        title: 'Could not renew invitation',
        description: messageOf(err)
      });
    }
  };
  const remove = async (i: Invitation) => {
    try {
      await client.removeInvitation(i.id);
      notify({ title: `Invitation for ${fullName(i)} deleted` });
      invitations.reload();
    } catch (err) {
      notify({
        intent: 'danger',
        title: 'Could not delete invitation',
        description: messageOf(err)
      });
    }
  };
  const invite = withBack(`${USERS_PATH}/invite`, search.href);
  const pending = invitations.data ?? [];
  return (
    <Page
      title="Users"
      description="Who can work in this agency, and the role each one has."
      actions={
        can('users:create') ? (
          <ButtonLink to={invite}>
            <UserPlusIcon aria-hidden="true" className="size-4" />
            Invite User
          </ButtonLink>
        ) : undefined
      }
    >
      {link ? (
        <LinkPanel
          title={`Invitation for ${link.name}`}
          description="Send this link to the person you invited. It works once and expires in 7 days."
          link={link.link}
        />
      ) : null}
      <Search
        label="Users"
        path={USERS_PATH}
        search={search}
        results={users}
        empty={{ title: 'No Users Yet', children: 'Invite someone to work in this agency.' }}
      >
        {(items) => <UsersTable users={items} search={search} canEdit={can('users:update')} />}
      </Search>
      <SectionPanel
        title="Invitations"
        description="People who were invited and have not joined yet."
      >
        {pending.length ? (
          <InvitationsTable
            invitations={pending}
            canInvite={can('users:create')}
            canRemove={can('users:delete')}
            onResend={setResending}
            onRemove={setRemoving}
          />
        ) : (
          <EmptyText>No one is waiting to join.</EmptyText>
        )}
      </SectionPanel>
      <ConfirmDialog
        open={resending !== null}
        title="Make a new invitation link?"
        confirmLabel="Make Link"
        confirmIcon={RefreshCwIcon}
        onClose={() => setResending(null)}
        onConfirm={() => {
          const i = resending;
          setResending(null);
          if (i) void resend(i);
        }}
      >
        The old link stops working and the invitation lasts another 7 days.
      </ConfirmDialog>
      <DeleteDialog
        open={removing !== null}
        name={removing ? `invitation for ${fullName(removing)}` : ''}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const i = removing;
          setRemoving(null);
          if (i) void remove(i);
        }}
      >
        Their link stops working.
      </DeleteDialog>
    </Page>
  );
};
