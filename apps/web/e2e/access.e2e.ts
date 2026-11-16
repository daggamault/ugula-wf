import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { importEncounter } from './shared/claims.ts';
import { chooseOption, listboxByLabel } from './shared/listbox.ts';
import {
  api,
  config,
  go,
  heading,
  rowWith,
  type Session,
  STEP_MS,
  SUITE_MS,
  send,
  signIn,
  signInAs,
  toast,
  uniqueId,
  until
} from './shared/session.ts';

const PASSWORD = 'E2e-Biller-Password-2026!';
const RESET_PASSWORD = 'E2e-Reset-Password-2026!';

const roleName = uniqueId('E2E Viewer');
const person = { first: 'Erin', last: uniqueId('Viewer') };
const pending = { first: 'Pat', last: uniqueId('Pending') };
const emailOf = (p: { last: string }) => `${p.last.toLowerCase()}@example.test`;
const fullName = (p: { first: string; last: string }) => `${p.first} ${p.last}`;

let s: Session;
let claimId = '';

const freshPage = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_MS);
  return page;
};

const withPage = async (run: (page: Page) => Promise<void>) => {
  const page = await freshPage(s.browser);
  try {
    await run(page);
  } finally {
    await page.context().close();
  }
};

const expired = async (page: Page) => {
  await page.getByRole('alert').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Accept Invitation' }).count(), 0);
};

const linkShown = async (page: Page) => {
  const link = await page.getByRole('textbox', { name: 'Link' }).inputValue();
  assert.match(link, /token=/);
  return link;
};

const invite = async (p: { first: string; last: string }) => {
  await go(s.page, '/users/invite');
  await heading(s.page, 'Invite User').waitFor();
  await s.page.getByLabel('First Name').fill(p.first);
  await s.page.getByLabel('Last Name').fill(p.last);
  await s.page.getByLabel('Email').fill(emailOf(p));
  const role = listboxByLabel(s.page, 'Role');
  const roleId = (
    await api<{ items: { id: string; name: string }[] }>(
      s,
      `/api/roles?q=${encodeURIComponent(roleName)}`
    )
  ).items.find((r) => r.name === roleName)?.id;
  assert.ok(roleId, 'the role exists');
  await chooseOption(role, roleId);
  await s.page.getByRole('button', { name: 'Invite', exact: true }).click();
  await s.page.getByRole('heading', { name: `Invitation for ${fullName(p)}` }).waitFor();
  return linkShown(s.page);
};

const users = () =>
  api<{ items: { id: string; email: string }[] }>(
    s,
    `/api/users?q=${encodeURIComponent(person.last)}`
  );

const removeLeftovers = async () => {
  for (const u of (await users()).items.filter((u) => u.email === emailOf(person))) {
    await send(s, 'DELETE', `/api/users/${u.id}`);
  }
  const invitations = await api<{ items: { id: string; email: string }[] }>(
    s,
    `/api/invitations?q=${encodeURIComponent(pending.last)}`
  );
  for (const i of invitations.items.filter((i) => i.email === emailOf(pending))) {
    await send(s, 'DELETE', `/api/invitations/${i.id}`);
  }
  const roles = await api<{ items: { id: string; name: string }[] }>(
    s,
    `/api/roles?q=${encodeURIComponent(roleName)}`
  );
  for (const r of roles.items.filter((r) => r.name === roleName)) {
    await send(s, 'DELETE', `/api/roles/${r.id}`);
  }
};

describe('an administrator manages roles, users and invitations', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    claimId = await importEncounter(s, uniqueId('E2E-ACC'));
  });

  after(async () => {
    if (s) await removeLeftovers();
    await s?.browser.close();
  });

  it('creates a role with a few permissions and changes it', async () => {
    await go(s.page, '/roles');
    await heading(s.page, 'Roles').waitFor();
    await s.page.getByRole('link', { name: 'Add Role' }).first().click();
    await heading(s.page, 'New Role').waitFor();
    await s.page.getByLabel('Name').fill(roleName);
    const grid = s.page.getByRole('table', { name: 'Permissions' });
    await grid.getByRole('checkbox', { name: 'View Claims' }).check();
    await grid.getByRole('checkbox', { name: 'View Tasks' }).check();
    await grid.getByRole('checkbox', { name: 'View Patients' }).check();
    await s.page.getByRole('button', { name: 'Save Role' }).click();
    await toast(s.page, `${roleName} saved`);
    await go(s.page, `/roles?q=${encodeURIComponent(roleName)}`);
    const row = rowWith(s.page, roleName);
    await row.getByRole('cell', { name: '3', exact: true }).waitFor();
    await row.getByRole('link', { name: `Edit ${roleName}` }).click();
    await heading(s.page, roleName).waitFor();
    assert.equal(await grid.getByRole('checkbox', { name: 'View Claims' }).isChecked(), true);
    await grid.getByRole('checkbox', { name: 'View Patients' }).uncheck();
    await s.page.getByRole('button', { name: 'Save Role' }).click();
    await toast(s.page, `${roleName} saved`);
    await go(s.page, `/roles?q=${encodeURIComponent(roleName)}`);
    await rowWith(s.page, roleName).getByRole('cell', { name: '2', exact: true }).waitFor();
  });

  it('invites a user who accepts with a password and sees only what the role allows', async () => {
    const link = await invite(person);
    await go(s.page, '/users/invitations');
    await rowWith(s.page, emailOf(person)).waitFor();
    await withPage(async (page) => {
      await page.goto(link);
      await page.getByText(`Join ${'Development North'}`).waitFor();
      await page.getByText(`as ${roleName}`).waitFor();
      assert.ok(!page.url().includes('token='), 'the token leaves the address bar');
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByLabel('Confirm Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Accept Invitation' }).click();
      await heading(page, /^(Claims|Tasks)$/).waitFor();
    });
    await withPage(async (page) => {
      await page.goto(link);
      await expired(page);
    });
    await withPage(async (page) => {
      const viewer = await signInAs(page, emailOf(person), PASSWORD);
      const nav = page.getByRole('navigation', { name: 'Primary' });
      await nav.getByRole('link', { name: 'Claims' }).waitFor();
      await nav.getByRole('link', { name: 'Tasks' }).waitFor();
      for (const hidden of ['Imports', 'Workflows', 'Users', 'Roles', 'Settings', 'Fees']) {
        assert.equal(
          await nav.getByRole('link', { name: hidden }).count(),
          0,
          `${hidden} is hidden`
        );
      }
      await page.goto(
        new URL(`/agencies/${viewer.agencyId}/claims/${claimId}`, config.E2E_WEB_URL).href
      );
      await heading(page, /^Claim \d{8}-\d{4,}$/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Start Task' }).count(), 0);
      const write = await page.request.post(
        `${viewer.apiUrl}/api/agencies/${viewer.agencyId}/claims/${claimId}/tasks`,
        {
          headers: { origin: new URL(config.E2E_WEB_URL).origin },
          data: { workflow: 'billing.correct-claim-data' }
        }
      );
      assert.equal(write.status(), 403);
      const read = await page.request.get(
        `${viewer.apiUrl}/api/agencies/${viewer.agencyId}/claims/${claimId}`
      );
      assert.equal(read.status(), 200);
    });
    await go(s.page, `/users?q=${encodeURIComponent(person.last)}`);
    await rowWith(s.page, emailOf(person)).getByText(roleName).waitFor();
  });

  it('sends a password link that sets a new password', async () => {
    await go(s.page, `/users?q=${encodeURIComponent(person.last)}`);
    await rowWith(s.page, emailOf(person))
      .getByRole('link', { name: `Edit ${fullName(person)}` })
      .click();
    await heading(s.page, fullName(person)).waitFor();
    await s.page.getByRole('button', { name: 'Password Link' }).click();
    const link = await until(
      s.page,
      async () => (await s.page.getByRole('textbox', { name: 'Link' }).count()) > 0,
      Boolean,
      'the password link'
    ).then(() => linkShown(s.page));
    assert.match(link, /\/password\?token=/);
    await withPage(async (page) => {
      await page.goto(link);
      await page.getByText('Set Your Password').waitFor();
      await page.getByLabel('New Password').fill(RESET_PASSWORD);
      await page.getByLabel('Confirm Password').fill(RESET_PASSWORD);
      await page.getByRole('button', { name: 'Set Password' }).click();
      await page.getByText('Your password is set. Sign in with it now.').waitFor();
    });
    await withPage(async (page) => {
      await signInAs(page, emailOf(person), RESET_PASSWORD);
    });
  });

  it('renews an invitation link, retiring the old one, and deletes the invitation', async () => {
    const first = await invite(pending);
    await go(s.page, '/users/invitations');
    const row = rowWith(s.page, emailOf(pending));
    await row.getByRole('button', { name: `New Link for ${fullName(pending)}` }).click();
    await s.page
      .getByRole('dialog', { name: 'Make a new invitation link?' })
      .getByRole('button', { name: 'Make Link' })
      .click();
    await s.page.getByRole('heading', { name: `Invitation for ${fullName(pending)}` }).waitFor();
    const renewed = await linkShown(s.page);
    assert.notEqual(renewed, first);
    await withPage(async (page) => {
      await page.goto(first);
      await expired(page);
      await page.goto(renewed);
      await page.getByRole('button', { name: 'Accept Invitation' }).waitFor();
    });
    await row.getByRole('button', { name: `Delete invitation for ${fullName(pending)}` }).click();
    await s.page
      .getByRole('dialog', { name: `Delete invitation for ${fullName(pending)}?` })
      .getByRole('button', { name: 'Delete' })
      .click();
    await toast(s.page, `Invitation for ${fullName(pending)} deleted`);
    await until(
      s.page,
      () => row.count(),
      (n) => n === 0,
      'the invitation to leave the list'
    );
  });

  it('removes the user and then the role', async () => {
    await go(s.page, `/users?q=${encodeURIComponent(person.last)}`);
    await rowWith(s.page, emailOf(person))
      .getByRole('link', { name: `Edit ${fullName(person)}` })
      .click();
    await s.page.getByRole('button', { name: 'Remove User' }).click();
    await s.page
      .getByRole('dialog', { name: `Remove ${fullName(person)}?` })
      .getByRole('button', { name: 'Remove User' })
      .click();
    await toast(s.page, `${fullName(person)} removed`);
    await go(s.page, `/roles?q=${encodeURIComponent(roleName)}`);
    await rowWith(s.page, roleName)
      .getByRole('button', { name: `Delete ${roleName}` })
      .click();
    await s.page
      .getByRole('dialog', { name: `Delete ${roleName}?` })
      .getByRole('button', { name: 'Delete' })
      .click();
    await toast(s.page, `${roleName} deleted`);
    await withPage(async (page) => {
      await page.goto(new URL('/claims', config.E2E_WEB_URL).href);
      await page.getByLabel('Email').fill(emailOf(person));
      await page.getByLabel('Password').fill(RESET_PASSWORD);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page
        .getByText('Choose an Agency', { exact: true })
        .or(page.getByRole('alert'))
        .first()
        .waitFor();
      assert.equal(await heading(page, /^(Claims|Tasks)$/).count(), 0);
    });
  });
});
