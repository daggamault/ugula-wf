import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { connectionSchema } from './schemas.ts';

const HOST_KEY = 'SHA256:VM159e2IEtdtiYxUoqIC5u7Z7D57F/k83MgfOvFrDdM';

const waystarInput = {
  vendor: 'waystar',
  enabled: true,
  sftpHost: ' sshftp.waystar.com ',
  sftpPort: 22,
  sftpHostKey: HOST_KEY,
  sftpUsername: 'acme',
  secret: 'hunter2',
  uploadPath: '/upload',
  downloadPaths: ['/download'],
  claimExtension: '.CLP',
  eligibilityExtension: '.ELG',
  claimStatusExtension: '.CLS',
  afterDownload: 'delete',
  realtimeUrl: null
};

describe('connectionSchema', () => {
  it('accepts a Waystar connection, trimming the host, and keeps a stored secret when none is sent', () => {
    const parsed = v.parse(connectionSchema, waystarInput);
    assert.equal(parsed.sftpHost, 'sshftp.waystar.com');
    assert.equal(v.parse(connectionSchema, { ...waystarInput, secret: null }).secret, null);
    assert.equal(
      v.parse(connectionSchema, { ...waystarInput, realtimeUrl: 'https://api.example.com/core' })
        .realtimeUrl,
      'https://api.example.com/core'
    );
  });

  it('refuses unknown vendors, bad paths, extensions, ports, hosts and URLs', () => {
    for (const bad of [
      { vendor: 'trizetto' },
      { uploadPath: 'upload' },
      { uploadPath: '/up\nload' },
      { downloadPaths: [] },
      { downloadPaths: ['/a,b'] },
      { downloadPaths: ['/a\u0000'] },
      { sftpHostKey: '' },
      { sftpHostKey: 'ssh-ed25519 AAAAC3Nza' },
      { sftpHostKey: 'SHA256:short' },
      { claimExtension: 'CLP' },
      { sftpPort: 0 },
      { sftpHost: 'bad host' },
      { sftpUsername: ' ' },
      { secret: '' },
      { afterDownload: 'archive' },
      { realtimeUrl: 'ftp://x.example.com' }
    ]) {
      assert.equal(
        v.safeParse(connectionSchema, { ...waystarInput, ...bad }).success,
        false,
        JSON.stringify(bad)
      );
    }
  });
});
