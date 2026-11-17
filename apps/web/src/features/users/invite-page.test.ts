import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { ToastProvider } from '../../shared/ui/toast.tsx';
import type { InviteInput, UsersClient } from './client.ts';
import { InvitePage, inviteProblem } from './invite-page.tsx';

const input = { email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', roleId: 'r1' };

const roles = [
  { id: 'r1', name: 'Biller', isGrantable: true },
  { id: 'r2', name: 'Admin', isGrantable: false },
  { id: 'r3', name: 'Auditor', isGrantable: true }
];

const fakeClient = (over: Partial<UsersClient> = {}) => {
  const invited: InviteInput[] = [];
  const client = {
    roles: async () => roles,
    invite: async (i: InviteInput) => {
      invited.push(i);
      return { id: 'i1', link: 'http://app.test/invitation?token=t1' };
    },
    ...over
  } as UsersClient;
  return { client, invited };
};

const show = (client: UsersClient) => {
  render(
    createElement(
      ToastProvider,
      { onNotify: () => undefined },
      createElement(InvitePage, { client, back: '/users?q=ann' })
    )
  );
  return userEvent.setup();
};

const form = () => screen.findByRole('form', { name: 'Invite user' });

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

const roleOptions = () =>
  within(screen.getByRole('listbox', { name: 'Role' }))
    .getAllByRole('option')
    .map((o) => o.textContent);

const fill = async (user: ReturnType<typeof userEvent.setup>, role = 'Biller') => {
  await user.type(textbox('First Name'), 'Ann');
  await user.type(textbox('Last Name'), 'Lee');
  await user.type(textbox('Email'), ' ann@example.com ');
  await user.click(
    within(screen.getByRole('listbox', { name: 'Role' })).getByRole('option', { name: role })
  );
};

describe('inviteProblem', () => {
  it('asks for a first and last name first', () => {
    assert.equal(inviteProblem({ ...input, firstName: ' ' }), 'Enter their first and last name.');
    assert.equal(inviteProblem({ ...input, lastName: '' }), 'Enter their first and last name.');
    assert.equal(
      inviteProblem({ email: '', firstName: '', lastName: '', roleId: '' }),
      'Enter their first and last name.'
    );
  });

  it('asks for an email address shaped like one', () => {
    assert.equal(inviteProblem({ ...input, email: 'ann' }), 'Enter their email address.');
    assert.equal(inviteProblem({ ...input, email: 'ann@example' }), 'Enter their email address.');
    assert.equal(inviteProblem({ ...input, email: 'a b@c.d' }), 'Enter their email address.');
    assert.equal(
      inviteProblem({ ...input, email: 'ann', roleId: '' }),
      'Enter their email address.'
    );
  });

  it('asks for a role last', () => {
    assert.equal(inviteProblem({ ...input, roleId: '' }), 'Choose a role.');
  });

  it('accepts a complete invitation, ignoring spaces around the email', () => {
    assert.equal(inviteProblem({ ...input, email: ' ann@example.com ' }), null);
  });
});

describe('InvitePage', () => {
  it('waits for the roles it can grant', () => {
    show({ roles: () => new Promise(() => undefined) } as unknown as UsersClient);
    assert.ok(screen.getByLabelText('Loading'));
    assert.ok(!screen.queryByRole('form', { name: 'Invite user' }));
  });

  it('says why the roles could not be loaded', async () => {
    const { client } = fakeClient({
      roles: async () => {
        throw new Error('Roles unavailable');
      }
    });
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Roles unavailable'));
  });

  it('offers only the roles the user may grant', async () => {
    const { client } = fakeClient();
    show(client);
    await form();
    assert.deepEqual(roleOptions(), ['Choose a role', 'Biller', 'Auditor']);
    assert.equal(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href'), '/users?q=ann');
  });

  it('invites the person with a trimmed email and shows the link to send them', async () => {
    const { client, invited } = fakeClient();
    const user = show(client);
    await form();
    await fill(user, 'Auditor');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    assert.deepEqual(invited, [
      { email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', roleId: 'r3' }
    ]);
    assert.ok(await screen.findByRole('heading', { name: 'Invitation for Ann Lee' }));
    assert.ok(screen.getByText('Send this link to them. It works once and expires in 7 days.'));
    assert.equal(
      (screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement).value,
      'http://app.test/invitation?token=t1'
    );
    assert.ok(!screen.queryByRole('form', { name: 'Invite user' }));
  });

  it('says what is missing instead of inviting', async () => {
    const { client, invited } = fakeClient();
    const user = show(client);
    await form();
    await user.type(textbox('First Name'), 'Ann');
    await user.type(textbox('Last Name'), 'Lee');
    await user.type(textbox('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    assert.equal(screen.getByRole('alert').textContent, 'Choose a role.');
    assert.deepEqual(invited, []);
  });

  it('shows why the server refused the invitation and keeps the form', async () => {
    const { client } = fakeClient({
      invite: async () => {
        throw new Error('Already a member');
      }
    });
    const user = show(client);
    await form();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Already a member'));
    assert.equal(textbox('First Name').value, 'Ann');
  });

  it('locks the form while inviting', async () => {
    let finish: (link: { id: string; link: string }) => void = () => undefined;
    const { client } = fakeClient({
      invite: () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    });
    const user = show(client);
    await form();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    assert.equal(screen.getByRole('button', { name: 'Invite' }).getAttribute('aria-busy'), 'true');
    assert.equal(textbox('Email').closest('fieldset')?.disabled, true);
    finish({ id: 'i1', link: 'l' });
    assert.ok(await screen.findByRole('heading', { name: 'Invitation for Ann Lee' }));
  });
});
