import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { connectionSchema } from './schemas.ts';

const HOST_KEY = 'SHA256:VM159e2IEtdtiYxUoqIC5u7Z7D57F/k83MgfOvFrDdM';

const waystarInput = {
  vendor: 'waystar',
  isActive: true,
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

const issues = (over: Record<string, unknown>) =>
  v.safeParse(connectionSchema, { ...waystarInput, ...over }).issues?.map((i) => i.message);

const HOST_KEY_MESSAGE =
  'Enter the SHA256 host key fingerprint your clearinghouse gives you, such as SHA256:…';

describe('connectionSchema', () => {
  it('accepts a Waystar connection, trimming the host', () => {
    assert.deepEqual(v.parse(connectionSchema, waystarInput), {
      ...waystarInput,
      sftpHost: 'sshftp.waystar.com'
    });
  });

  it('trims the key, user, paths, extensions and realtime URL', () => {
    const parsed = v.parse(connectionSchema, {
      ...waystarInput,
      sftpHostKey: ` ${HOST_KEY} `,
      sftpUsername: ' bob ',
      uploadPath: ' /up ',
      downloadPaths: [' /d '],
      claimExtension: ' .x ',
      realtimeUrl: ' https://api.example.com/core '
    });
    assert.deepEqual(
      [
        parsed.sftpHostKey,
        parsed.sftpUsername,
        parsed.uploadPath,
        parsed.downloadPaths,
        parsed.claimExtension,
        parsed.realtimeUrl
      ],
      [HOST_KEY, 'bob', '/up', ['/d'], '.x', 'https://api.example.com/core']
    );
  });

  it('keeps a stored secret when none is sent but refuses an empty one', () => {
    assert.equal(v.parse(connectionSchema, { ...waystarInput, secret: null }).secret, null);
    assert.deepEqual(issues({ secret: '' }), ['Enter the password']);
  });

  it('refuses unknown vendors and after-download actions', () => {
    assert.deepEqual(issues({ vendor: 'trizetto' }), [
      'Invalid type: Expected ("waystar" | "mock" | "custom-sftp") but received "trizetto"'
    ]);
    assert.deepEqual(issues({ afterDownload: 'archive' }), [
      'Invalid type: Expected ("delete" | "keep") but received "archive"'
    ]);
  });

  it('refuses a bad host, port, host key or username', () => {
    assert.deepEqual(issues({ sftpHost: 'bad host' }), [
      'Enter a host name such as sshftp.waystar.com'
    ]);
    assert.deepEqual(issues({ sftpPort: 0 }), ['Invalid value: Expected >=1 but received 0']);
    assert.deepEqual(issues({ sftpPort: 65536 }), [
      'Invalid value: Expected <=65535 but received 65536'
    ]);
    assert.deepEqual(issues({ sftpPort: 22.5 }), ['Invalid integer: Received 22.5']);
    for (const sftpHostKey of ['', 'ssh-ed25519 AAAAC3Nza', 'SHA256:short']) {
      assert.deepEqual(issues({ sftpHostKey }), [HOST_KEY_MESSAGE], sftpHostKey);
    }
    assert.deepEqual(issues({ sftpUsername: ' ' }), ['Enter the SFTP username']);
  });

  it('refuses upload paths that are relative, hold control characters or run long', () => {
    assert.deepEqual(issues({ uploadPath: 'upload' }), ['Paths start with /']);
    assert.deepEqual(issues({ uploadPath: '/up\nload' }), ['Paths start with /']);
    assert.deepEqual(issues({ uploadPath: `/${'x'.repeat(255)}` }), [
      'Invalid length: Expected <=255 but received 256'
    ]);
  });

  it('takes 1 to 10 download paths without commas or control characters', () => {
    assert.deepEqual(issues({ downloadPaths: [] }), [
      'Invalid length: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues({ downloadPaths: Array.from({ length: 11 }, (_, i) => `/${i}`) }), [
      'Invalid length: Expected <=10 but received 11'
    ]);
    for (const path of ['/a,b', '/a\u0000', 'download']) {
      assert.deepEqual(issues({ downloadPaths: [path] }), [
        'Paths start with / and have no commas'
      ]);
    }
  });

  it('refuses extensions without a leading dot', () => {
    assert.deepEqual(issues({ claimExtension: 'CLP' }), ['Use an extension such as .CLP']);
    assert.deepEqual(issues({ eligibilityExtension: '.' }), ['Use an extension such as .CLP']);
    assert.deepEqual(issues({ claimStatusExtension: '.CL S' }), ['Use an extension such as .CLP']);
  });

  it('takes only an http or https realtime URL', () => {
    assert.equal(
      v.parse(connectionSchema, { ...waystarInput, realtimeUrl: 'http://localhost:2224/core' })
        .realtimeUrl,
      'http://localhost:2224/core'
    );
    assert.deepEqual(issues({ realtimeUrl: 'ftp://x.example.com' }), ['Use an http or https URL']);
    assert.deepEqual(issues({ realtimeUrl: 'not a url' }), [
      'Invalid URL: Received "not a url"',
      'Use an http or https URL'
    ]);
  });
});
