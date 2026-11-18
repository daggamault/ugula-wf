import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { createElement } from 'react';
import { navigate, stay } from '../../shared/router.tsx';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { ClearinghouseConnection, ConnectionInput } from './client.ts';
import {
  ConnectionForm,
  endpointChanged,
  fromConnectionDraft,
  needsSecret,
  receiverHint,
  saveBlocked,
  secretHint,
  toConnectionDraft,
  withVendor
} from './connection-form.tsx';

HTMLElement.prototype.showPopover ??= () => undefined;

const saved: ClearinghouseConnection = {
  vendor: 'custom-sftp',
  is_active: false,
  sftp_host: 'sftp.example.com',
  sftp_port: 2222,
  sftp_host_key: `SHA256:${'k'.repeat(43)}`,
  sftp_username: 'acme',
  secret_set: true,
  upload_path: '/in',
  download_paths: ['/out/999', '/out/835'],
  claim_extension: '.txt',
  eligibility_extension: '.270',
  claim_status_extension: '.276',
  after_download: 'keep',
  realtime_url: null
};

const savedInput: ConnectionInput = {
  vendor: 'custom-sftp',
  isActive: false,
  sftpHost: 'sftp.example.com',
  sftpPort: 2222,
  sftpHostKey: `SHA256:${'k'.repeat(43)}`,
  sftpUsername: 'acme',
  secret: null,
  uploadPath: '/in',
  downloadPaths: ['/out/999', '/out/835'],
  claimExtension: '.txt',
  eligibilityExtension: '.270',
  claimStatusExtension: '.276',
  afterDownload: 'keep',
  realtimeUrl: null
};

type Handlers = {
  onSave?: (input: ConnectionInput) => Promise<string | null>;
  onRemove?: () => Promise<string | null>;
};

const showForm = (
  connection: ClearinghouseConnection | null,
  { onSave = async () => null, onRemove = async () => null }: Handlers = {},
  canStoreSecrets = true
) => {
  render(createElement(ConnectionForm, { connection, canStoreSecrets, onSave, onRemove }));
  return userEvent.setup();
};

const recordSaves = (results: (string | null)[] = []) => {
  const calls: ConnectionInput[] = [];
  const onSave = async (input: ConnectionInput) => {
    calls.push(input);
    return results.shift() ?? null;
  };
  return { calls, onSave };
};

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

const password = () => screen.getByLabelText(/^Password/) as HTMLInputElement;

const choose = async (user: ReturnType<typeof userEvent.setup>, list: string, option: string) =>
  user.click(
    within(screen.getByRole('listbox', { name: list })).getByRole('option', { name: option })
  );

const saveButton = () => screen.getByRole('button', { name: 'Save Connection' });

describe('connection draft', () => {
  it('starts from the Waystar preset and fills a vendor preset when one is chosen', () => {
    const draft = toConnectionDraft(null);
    assert.deepEqual(
      [draft.vendor, draft.sftpHost, draft.sftpHostKey, draft.claimExtension],
      ['waystar', 'sshftp.waystar.com', '', '.CLP']
    );
    const mock = withVendor({ ...draft, sftpUsername: 'ugula', secret: 'pw' }, 'mock');
    assert.deepEqual(
      [mock.sftpHost, mock.sftpPort, mock.sftpHostKey, mock.realtimeUrl, mock.sftpUsername],
      ['localhost', '2223', MOCK_HOST_KEY, 'http://localhost:2224/core/realtime', 'ugula']
    );
    assert.equal(withVendor(mock, 'waystar').sftpHostKey, '');
  });

  it('round-trips a saved connection, trimming text and keeping the stored password', () => {
    const draft = toConnectionDraft(saved);
    assert.equal(draft.secret, '');
    assert.deepEqual(fromConnectionDraft(draft), savedInput);
    assert.deepEqual(
      fromConnectionDraft({
        ...draft,
        sftpHost: ' sftp.example.com ',
        downloadPaths: ' /a , ,/b ',
        realtimeUrl: '  ',
        secret: ' new '
      }),
      { ...savedInput, downloadPaths: ['/a', '/b'], secret: ' new ' }
    );
  });

  it('asks for the password again when the server or account changes', () => {
    const draft = toConnectionDraft(saved);
    assert.equal(needsSecret(saved, draft), false);
    assert.equal(needsSecret(null, draft), true);
    assert.equal(needsSecret({ ...saved, secret_set: false }, draft), true);
    for (const change of [
      { sftpHost: 'evil.example.com' },
      { sftpPort: '22' },
      { sftpHostKey: `SHA256:${'x'.repeat(43)}` },
      { sftpUsername: 'other' },
      { realtimeUrl: 'https://evil.example.com/core' }
    ]) {
      assert.equal(endpointChanged(saved, { ...draft, ...change }), true, JSON.stringify(change));
    }
    assert.equal(endpointChanged(saved, { ...draft, uploadPath: '/elsewhere' }), false);
    assert.equal(secretHint(null, draft), undefined);
    assert.match(secretHint(saved, draft) ?? '', /A password is set/);
    assert.match(secretHint(saved, { ...draft, sftpHost: 'x.example.com' }) ?? '', /again/);
  });

  it('blocks saving only when a password is needed and the server cannot store one', () => {
    const draft = toConnectionDraft(saved);
    assert.equal(saveBlocked(saved, draft, false), false);
    assert.equal(saveBlocked(saved, { ...draft, secret: 'pw' }, false), true);
    assert.equal(saveBlocked(saved, { ...draft, sftpUsername: 'other' }, false), true);
    assert.equal(saveBlocked(null, toConnectionDraft(null), false), true);
    assert.equal(saveBlocked(null, toConnectionDraft(null), true), false);
  });

  it('says which receiver ID the billing profile needs', () => {
    assert.equal(receiverHint('waystar'), 'Set the billing profile Receiver ID to WAYSTAR.');
    assert.match(receiverHint('custom-sftp'), /receiver ID your clearinghouse gives you/);
  });
});

describe('ConnectionForm', () => {
  it('saves a new connection from the chosen vendor preset and clears the typed password', async () => {
    const { calls, onSave } = recordSaves();
    const user = showForm(null, { onSave });
    assert.ok(!screen.queryByRole('button', { name: 'Remove Connection' }));
    assert.equal(password().required, true);
    await choose(user, 'Clearinghouse', 'Mock clearinghouse (development)');
    assert.equal(textbox('SFTP Host').value, 'localhost');
    await user.type(textbox('Username'), ' ugula ');
    await user.type(password(), 'pw');
    await choose(user, 'Status', 'Paused');
    await choose(user, 'After Download', 'Keep on the Server');
    await user.click(saveButton());
    assert.deepEqual(calls, [
      {
        vendor: 'mock',
        isActive: false,
        sftpHost: 'localhost',
        sftpPort: 2223,
        sftpHostKey: MOCK_HOST_KEY,
        sftpUsername: 'ugula',
        secret: 'pw',
        uploadPath: '/upload',
        downloadPaths: ['/download'],
        claimExtension: '.CLP',
        eligibilityExtension: '.ELG',
        claimStatusExtension: '.CLS',
        afterDownload: 'keep',
        realtimeUrl: 'http://localhost:2224/core/realtime'
      }
    ]);
    assert.equal(password().value, '');
    assert.ok(!screen.queryByRole('alert'));
  });

  it('keeps the stored password when a saved connection is saved without typing one', async () => {
    const { calls, onSave } = recordSaves();
    const user = showForm(saved, { onSave });
    assert.equal(textbox('SFTP Host').value, 'sftp.example.com');
    assert.equal(password().required, false);
    assert.match(screen.getByText(/A password is set/).textContent ?? '', /Leave blank/);
    await user.clear(textbox('Download Folders'));
    await user.type(textbox('Download Folders'), '/out/999, /out/277');
    await user.click(saveButton());
    assert.deepEqual(calls, [{ ...savedInput, downloadPaths: ['/out/999', '/out/277'] }]);
  });

  it('requires the password again once the server changes', async () => {
    const user = showForm(saved);
    await user.type(textbox('SFTP Host'), '.net');
    assert.equal(password().required, true);
    assert.ok(screen.getByText('Enter the password again for the changed server or account.'));
  });

  it('shows why saving failed and keeps the typed values for another try', async () => {
    const { calls, onSave } = recordSaves(['Host key does not match']);
    const user = showForm(saved, { onSave });
    await user.type(password(), 'pw');
    await user.click(saveButton());
    assert.equal((await screen.findByRole('alert')).textContent, 'Host key does not match');
    assert.equal(password().value, 'pw');
    await user.click(saveButton());
    assert.equal(calls.length, 2);
    await waitFor(() => assert.ok(!screen.queryByRole('alert')));
  });

  it('locks the form while saving', async () => {
    let finish: (failure: string | null) => void = () => undefined;
    const onSave = () =>
      new Promise<string | null>((resolve) => {
        finish = resolve;
      });
    const user = showForm(saved, { onSave });
    await user.click(saveButton());
    assert.equal(saveButton().getAttribute('aria-busy'), 'true');
    assert.equal(textbox('SFTP Host').closest('fieldset')?.disabled, true);
    finish(null);
    await waitFor(() => assert.equal(saveButton().getAttribute('aria-busy'), null));
    assert.equal(textbox('SFTP Host').closest('fieldset')?.disabled, false);
  });

  it('will not send a password the server cannot store', async () => {
    const { calls, onSave } = recordSaves();
    const user = showForm(saved, { onSave }, false);
    assert.match(
      screen.getByRole('status').textContent ?? '',
      /cannot store clearinghouse passwords/
    );
    await user.type(password(), 'pw');
    assert.equal(saveButton().getAttribute('aria-disabled'), 'true');
    await user.click(saveButton());
    assert.deepEqual(calls, []);
    await user.clear(password());
    await user.click(saveButton());
    assert.deepEqual(calls, [savedInput]);
  });

  it('removes the connection only after confirming', async () => {
    let removed = 0;
    const user = showForm(saved, {
      onRemove: async () => {
        removed += 1;
        return null;
      }
    });
    await user.click(screen.getByRole('button', { name: 'Remove Connection' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove Connection?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep Connection' }));
    assert.equal(removed, 0);
    assert.ok(!screen.queryByRole('dialog'));
    await user.click(screen.getByRole('button', { name: 'Remove Connection' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove Connection' })
    );
    assert.equal(removed, 1);
    assert.ok(!screen.queryByRole('dialog'));
  });

  it('shows why removing failed', async () => {
    const user = showForm(saved, { onRemove: async () => 'Connection is in use' });
    await user.click(screen.getByRole('button', { name: 'Remove Connection' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove Connection' })
    );
    assert.equal((await screen.findByRole('alert')).textContent, 'Connection is in use');
  });

  it('holds navigation while edits are unsaved and releases it once saved', async () => {
    const user = showForm(saved);
    await user.type(textbox('Upload Folder'), '/claims');
    navigate('/elsewhere');
    assert.equal(window.location.pathname, '/');
    stay();
    await user.click(saveButton());
    await waitFor(() => assert.equal(saveButton().getAttribute('aria-busy'), null));
    navigate('/elsewhere');
    assert.equal(window.location.pathname, '/elsewhere');
  });
});
