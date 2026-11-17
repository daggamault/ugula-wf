import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { endpointIssue, isPrivateHost } from './endpoints.ts';
import type { ConnectionInput } from './schemas.ts';

const input: ConnectionInput = {
  vendor: 'custom-sftp',
  isActive: true,
  sftpHost: 'sftp.example.com',
  sftpPort: 22,
  sftpHostKey: `SHA256:${'k'.repeat(43)}`,
  sftpUsername: 'acme',
  secret: null,
  uploadPath: '/',
  downloadPaths: ['/'],
  claimExtension: '.txt',
  eligibilityExtension: '.txt',
  claimStatusExtension: '.txt',
  afterDownload: 'delete',
  realtimeUrl: 'https://api.example.com/core'
};

describe('isPrivateHost', () => {
  it('spots loopback, private, link-local, local names and mapped addresses', () => {
    for (const host of [
      'localhost',
      'api.localhost',
      'printer.local',
      'db.internal',
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '[::1]',
      '::',
      'fd00::1',
      'fe80::1',
      '[::ffff:7f00:1]'
    ]) {
      assert.equal(isPrivateHost(host), true, host);
    }
    for (const host of ['sshftp.waystar.com', '8.8.8.8', '2001:4860:4860::8888', '172.32.0.1']) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });
});

describe('endpointIssue', () => {
  it('allows public https servers', () => {
    assert.equal(endpointIssue(input, false), null);
  });

  it('allows a connection without a real-time URL', () => {
    assert.equal(endpointIssue({ ...input, realtimeUrl: null }, false), null);
  });

  it('refuses the mock, private or unparsable SFTP hosts and private or plain http real-time URLs', () => {
    const cases: [Partial<ConnectionInput>, string][] = [
      [{ vendor: 'mock' }, 'The mock clearinghouse is only for development'],
      [{ sftpHost: '0x7f.1' }, 'The SFTP host must be a public server'],
      [{ sftpHost: '10.0.0.5' }, 'The SFTP host must be a public server'],
      [{ sftpHost: 'bad host' }, 'The SFTP host must be a public server'],
      [{ realtimeUrl: 'http://api.example.com/core' }, 'The real-time URL must use https'],
      [
        { realtimeUrl: 'https://169.254.169.254/latest' },
        'The real-time URL must be a public server'
      ]
    ];
    for (const [change, issue] of cases) {
      assert.equal(endpointIssue({ ...input, ...change }, false), issue, JSON.stringify(change));
    }
  });

  it('allows anything in development, where the mock runs on localhost', () => {
    const mock = {
      ...input,
      vendor: 'mock' as const,
      sftpHost: 'localhost',
      realtimeUrl: 'http://localhost:2224/core/realtime'
    };
    assert.equal(endpointIssue(mock, true), null);
  });
});
