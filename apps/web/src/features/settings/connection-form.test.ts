import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClearinghouseConnection } from './client.ts';
import {
  ConnectionForm,
  fromConnectionDraft,
  receiverHint,
  secretHint,
  toConnectionDraft,
  withVendor
} from './connection-form.tsx';

const saved: ClearinghouseConnection = {
  vendor: 'custom-sftp',
  enabled: false,
  sftp_host: 'sftp.example.com',
  sftp_port: 2222,
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

describe('connection form', () => {
  it('starts from the Waystar preset and fills a vendor preset when one is chosen', () => {
    const draft = toConnectionDraft(null);
    assert.deepEqual(
      [draft.vendor, draft.sftpHost, draft.claimExtension, draft.claimStatusExtension],
      ['waystar', 'sshftp.waystar.com', '.CLP', '.CLS']
    );
    const mock = withVendor({ ...draft, sftpUsername: 'ugula', secret: 'pw' }, 'mock');
    assert.deepEqual(
      [mock.sftpHost, mock.sftpPort, mock.realtimeUrl, mock.sftpUsername, mock.secret],
      ['localhost', '2223', 'http://localhost:2224/core/realtime', 'ugula', 'pw']
    );
  });

  it('never shows the stored password, keeping it unless a new one is typed', () => {
    const draft = toConnectionDraft(saved);
    assert.equal(draft.secret, '');
    const input = fromConnectionDraft(draft);
    assert.equal(input.secret, null);
    assert.deepEqual(input.downloadPaths, ['/out/999', '/out/835']);
    assert.deepEqual([input.enabled, input.sftpPort, input.realtimeUrl], [false, 2222, null]);
    assert.equal(fromConnectionDraft({ ...draft, secret: 'new' }).secret, 'new');
    assert.match(secretHint(saved) ?? '', /A password is set/);
    assert.equal(secretHint(null), undefined);
  });

  it('says which receiver ID the billing profile needs', () => {
    assert.equal(receiverHint('waystar'), 'Set the billing profile Receiver ID to WAYSTAR.');
    assert.match(receiverHint('custom-sftp'), /receiver ID your clearinghouse gives you/);
  });

  it('renders a labelled form, offering removal only for a saved connection', () => {
    const render = (connection: ClearinghouseConnection | null, canStoreSecrets = true) =>
      renderToStaticMarkup(
        createElement(ConnectionForm, {
          connection,
          canStoreSecrets,
          onSave: async () => null,
          onRemove: async () => null
        })
      );
    const fresh = render(null, false);
    assert.ok(fresh.includes('aria-label="Clearinghouse connection"'));
    assert.ok(fresh.includes('>Save Connection<') && !fresh.includes('>Remove Connection<'));
    assert.match(fresh, /id="connection-secret"[^>]*required=""/);
    assert.ok(fresh.includes('CLEARINGHOUSE_SECRET_KEY'));
    const html = render(saved);
    assert.ok(html.includes('>Remove Connection<') && html.includes('value="sftp.example.com"'));
    assert.doesNotMatch(html, /id="connection-secret"[^>]*required=""/);
    assert.ok(html.includes('<option value="keep" selected="">Keep on the Server</option>'));
  });
});
