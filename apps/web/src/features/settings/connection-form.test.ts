import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClearinghouseConnection } from './client.ts';
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

const saved: ClearinghouseConnection = {
  vendor: 'custom-sftp',
  enabled: false,
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

const render = (connection: ClearinghouseConnection | null, canStoreSecrets = true) =>
  renderToStaticMarkup(
    createElement(ConnectionForm, {
      connection,
      canStoreSecrets,
      onSave: async () => null,
      onRemove: async () => null
    })
  );

describe('connection form', () => {
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

  it('never shows the stored password, keeping it unless a new one is typed', () => {
    const draft = toConnectionDraft(saved);
    assert.equal(draft.secret, '');
    const input = fromConnectionDraft({ ...draft, sftpHostKey: ` ${saved.sftp_host_key} ` });
    assert.equal(input.secret, null);
    assert.equal(input.sftpHostKey, saved.sftp_host_key);
    assert.deepEqual(input.downloadPaths, ['/out/999', '/out/835']);
    assert.deepEqual([input.enabled, input.sftpPort, input.realtimeUrl], [false, 2222, null]);
    assert.equal(fromConnectionDraft({ ...draft, secret: 'new' }).secret, 'new');
    assert.match(secretHint(saved, draft) ?? '', /A password is set/);
    assert.equal(secretHint(null, draft), undefined);
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

  it('renders a labelled form, offering removal only for a saved connection', () => {
    const fresh = render(null, false);
    assert.ok(fresh.includes('aria-label="Clearinghouse connection"'));
    assert.ok(fresh.includes('>Save Connection<') && !fresh.includes('>Remove Connection<'));
    assert.match(fresh, /id="connection-secret"[^>]*required=""/);
    assert.match(fresh, /id="connection-sftpHostKey"[^>]*required=""/);
    assert.ok(fresh.includes('cannot store clearinghouse passwords yet'));
    assert.ok(!fresh.includes('CLEARINGHOUSE_SECRET_KEY'));
    assert.match(fresh, /<button[^>]*type="submit"[^>]*aria-disabled="true"/);
    const html = render(saved);
    assert.ok(html.includes('>Remove Connection<') && html.includes('value="sftp.example.com"'));
    assert.doesNotMatch(html, /id="connection-secret"[^>]*required=""/);
    assert.doesNotMatch(html, /<button[^>]*type="submit"[^>]*aria-disabled="true"/);
    assert.match(
      html,
      /role="option"[^>]*aria-selected="true" data-value="keep"[^>]*><span[^>]*>Keep on the Server<\/span>/
    );
  });
});
