import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type {
  BillingProfile,
  BillingProfileInput,
  ClearinghouseConnection,
  SettingsClient
} from './client.ts';
import {
  fromProfileDraft,
  ProfileForm,
  SettingsPage,
  timeZoneOptions,
  toProfileDraft
} from './settings-page.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const profile: BillingProfile = {
  organization_name: 'Acme EMS',
  npi: '1234567893',
  tax_id: '123456789',
  address_line: '1 Rd',
  city: 'Springfield',
  state: 'IL',
  postal_code: '627041234',
  phone: '2175550100',
  submitter_id: 'SUB01',
  receiver_id: null,
  receiver_name: null,
  time_zone: 'America/Chicago',
  is_production: true
};

const profileInput: BillingProfileInput = {
  organizationName: 'Acme EMS',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '1 Rd',
  city: 'Springfield',
  state: 'IL',
  postalCode: '627041234',
  phone: '2175550100',
  submitterId: 'SUB01',
  receiverId: null,
  receiverName: null,
  timeZone: 'America/Chicago',
  isProduction: true
};

const connection: ClearinghouseConnection = {
  vendor: 'custom-sftp',
  is_active: true,
  sftp_host: 'sftp.example.com',
  sftp_port: 22,
  sftp_host_key: `SHA256:${'k'.repeat(43)}`,
  sftp_username: 'acme',
  secret_set: true,
  upload_path: '/in',
  download_paths: ['/out'],
  claim_extension: '.txt',
  eligibility_extension: '.txt',
  claim_status_extension: '.txt',
  after_download: 'delete',
  realtime_url: null
};

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

const pending = () => new Promise<never>(() => undefined);

describe('profile draft', () => {
  it('starts empty, in test mode and the given zone, without a saved profile', () => {
    assert.deepEqual(toProfileDraft(null, 'America/Denver'), {
      organizationName: '',
      npi: '',
      taxId: '',
      addressLine: '',
      city: '',
      state: '',
      postalCode: '',
      phone: '',
      submitterId: '',
      receiverId: '',
      receiverName: '',
      timeZone: 'America/Denver',
      usage: 'T'
    });
  });

  it('round-trips a saved profile, sending blank clearinghouse IDs as null', () => {
    const draft = toProfileDraft(profile, 'America/Denver');
    assert.equal(draft.receiverId, '');
    assert.deepEqual(fromProfileDraft(draft), profileInput);
    assert.deepEqual(fromProfileDraft({ ...draft, submitterId: '  ', usage: 'T' }), {
      ...profileInput,
      submitterId: null,
      isProduction: false
    });
  });
});

describe('timeZoneOptions', () => {
  it('lists IANA zones and keeps a saved zone the browser does not know', () => {
    assert.ok(timeZoneOptions('America/Chicago').some((o) => o.value === 'America/Chicago'));
    assert.deepEqual(timeZoneOptions('Mars/Base')[0], { value: 'Mars/Base', label: 'Mars/Base' });
    assert.ok(timeZoneOptions('America/New_York').some((o) => o.label === 'America/New York'));
  });
});

describe('ProfileForm', () => {
  it('saves the edited profile', async () => {
    const calls: BillingProfileInput[] = [];
    render(
      createElement(ProfileForm, {
        profile,
        onSave: async (p) => {
          calls.push(p);
          return null;
        }
      })
    );
    const user = userEvent.setup();
    assert.equal(textbox('Organization Name').value, 'Acme EMS');
    await user.clear(textbox('City'));
    await user.type(textbox('City'), 'Peoria');
    await user.type(textbox('Clearinghouse Name'), 'Waystar');
    await user.click(
      within(screen.getByRole('listbox', { name: '837P Files' })).getByRole('option', {
        name: 'Test Files'
      })
    );
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));
    assert.deepEqual(calls, [
      { ...profileInput, city: 'Peoria', receiverName: 'Waystar', isProduction: false }
    ]);
    assert.ok(!screen.queryByRole('alert'));
  });

  it('shows why saving failed and locks the form only while saving', async () => {
    let finish: (failure: string | null) => void = () => undefined;
    render(
      createElement(ProfileForm, {
        profile,
        onSave: () =>
          new Promise<string | null>((resolve) => {
            finish = resolve;
          })
      })
    );
    const user = userEvent.setup();
    const save = screen.getByRole('button', { name: 'Save Profile' });
    await user.click(save);
    assert.equal(save.getAttribute('aria-busy'), 'true');
    assert.equal(textbox('NPI').closest('fieldset')?.disabled, true);
    finish('NPI is not valid');
    assert.equal((await screen.findByRole('alert')).textContent, 'NPI is not valid');
    assert.equal(save.getAttribute('aria-busy'), null);
    assert.equal(textbox('NPI').closest('fieldset')?.disabled, false);
  });
});

type Calls = { saved: unknown[]; removed: number; loads: { profile: number; connection: number } };

const fakeClient = (patch: Partial<SettingsClient> = {}) => {
  const calls: Calls = { saved: [], removed: 0, loads: { profile: 0, connection: 0 } };
  const client: SettingsClient = {
    profile: async () => {
      calls.loads.profile += 1;
      return profile;
    },
    connection: async () => {
      calls.loads.connection += 1;
      return { connection, canStoreSecrets: true };
    },
    saveProfile: async (p) => {
      calls.saved.push(p);
    },
    saveConnection: async (c) => {
      calls.saved.push(c);
    },
    removeConnection: async () => {
      calls.removed += 1;
    },
    ...patch
  };
  return { calls, client };
};

const showPage = (client: SettingsClient) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(ToastProvider, {
      onNotify: (t) => toasts.push(t),
      children: createElement(SettingsPage, { client, live: idleLive })
    })
  );
  return { toasts, user: userEvent.setup() };
};

describe('SettingsPage', () => {
  it('shows one loading state until the profile and the connection are both loaded', () => {
    const { client } = fakeClient({ connection: pending });
    showPage(client);
    assert.equal(screen.getAllByRole('status', { name: 'Loading' }).length, 1);
    assert.ok(!screen.queryByRole('form', { name: 'Billing profile' }));
    assert.ok(!screen.queryByRole('form', { name: 'Clearinghouse connection' }));
  });

  it('says why the settings could not load', async () => {
    const { client } = fakeClient({
      connection: async () => {
        throw new Error('Connection lookup failed');
      }
    });
    showPage(client);
    assert.ok(await screen.findByText('Connection lookup failed'));
    assert.ok(!screen.queryByRole('form', { name: 'Billing profile' }));
  });

  it('saves the billing profile, confirms it and reloads it', async () => {
    const { calls, client } = fakeClient();
    const { toasts, user } = showPage(client);
    await screen.findByRole('form', { name: 'Billing profile' });
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));
    assert.deepEqual(calls.saved, [profileInput]);
    assert.deepEqual(toasts, [{ title: 'Billing profile saved' }]);
    await waitFor(() => assert.equal(calls.loads.profile, 2));
  });

  it('shows the server message when the profile cannot be saved', async () => {
    const { client } = fakeClient({
      saveProfile: async () => {
        throw new Error('Tax ID must be 9 digits');
      }
    });
    const { toasts, user } = showPage(client);
    await user.click(await screen.findByRole('button', { name: 'Save Profile' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Tax ID must be 9 digits');
    assert.deepEqual(toasts, []);
  });

  it('saves the clearinghouse connection, confirms it and reloads it', async () => {
    const { calls, client } = fakeClient();
    const { toasts, user } = showPage(client);
    await user.type(await screen.findByLabelText(/^Password/), 'pw');
    await user.click(screen.getByRole('button', { name: 'Save Connection' }));
    assert.equal(calls.saved.length, 1);
    assert.equal((calls.saved[0] as { secret: string }).secret, 'pw');
    assert.deepEqual(toasts, [{ title: 'Clearinghouse connection saved' }]);
    await waitFor(() => assert.equal(calls.loads.connection, 2));
  });

  it('shows the server message when the connection cannot be saved', async () => {
    const { client } = fakeClient({
      saveConnection: async () => {
        throw new Error('Host key does not match');
      }
    });
    const { user } = showPage(client);
    await user.click(await screen.findByRole('button', { name: 'Save Connection' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Host key does not match');
  });

  it('starts a fresh connection form once the saved connection is removed', async () => {
    let current: ClearinghouseConnection | null = connection;
    const { client } = fakeClient({
      connection: async () => ({ connection: current, canStoreSecrets: true }),
      removeConnection: async () => {
        current = null;
      }
    });
    const { toasts, user } = showPage(client);
    await user.click(await screen.findByRole('button', { name: 'Remove Connection' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove Connection' })
    );
    await waitFor(() => assert.ok(!screen.queryByRole('button', { name: 'Remove Connection' })));
    assert.deepEqual(toasts, [{ title: 'Clearinghouse connection removed' }]);
    assert.equal(textbox('SFTP Host').value, 'sshftp.waystar.com');
  });
});
