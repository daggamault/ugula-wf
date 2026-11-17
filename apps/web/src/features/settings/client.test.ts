import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { type ConnectionInput, createSettingsClient } from './client.ts';

type Call = { method: string | undefined; url: string; body: unknown };

const recording = (reply: unknown = {}, status = 200) => {
  const calls: Call[] = [];
  const client = createSettingsClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        calls.push({
          method: init.method,
          url: String(url),
          body: init.body === undefined ? undefined : JSON.parse(String(init.body))
        });
        return Response.json(reply, { status });
      },
      () => undefined,
      () => null
    )
  );
  return { client, calls };
};

const profileInput = {
  organizationName: 'Acme',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '1 Rd',
  city: 'X',
  state: 'IL',
  postalCode: '627041234',
  phone: '2175550100',
  submitterId: null,
  receiverId: null,
  receiverName: null,
  timeZone: 'America/Chicago',
  isProduction: false
};

const connectionInput: ConnectionInput = {
  vendor: 'waystar',
  isActive: true,
  sftpHost: 'sftp.test',
  sftpPort: 22,
  sftpHostKey: 'ssh-ed25519 AAAA',
  sftpUsername: 'acme',
  secret: null,
  uploadPath: '/inbound',
  downloadPaths: ['/outbound'],
  claimExtension: '.837',
  eligibilityExtension: '.270',
  claimStatusExtension: '.276',
  afterDownload: 'delete',
  realtimeUrl: null
};

describe('createSettingsClient', () => {
  it('unwraps the billing profile', async () => {
    const { client, calls } = recording({ profile: { npi: '1234567893' } });
    assert.deepEqual(await client.profile(), { npi: '1234567893' });
    assert.deepEqual(calls, [
      { method: 'GET', url: 'http://api.test/api/billing-profile', body: undefined }
    ]);
  });

  it('reads a missing billing profile as null', async () => {
    const { client } = recording({ profile: null });
    assert.equal(await client.profile(), null);
  });

  it('saves the billing profile', async () => {
    const { client, calls } = recording();
    await client.saveProfile(profileInput);
    assert.deepEqual(calls, [
      { method: 'PUT', url: 'http://api.test/api/billing-profile', body: profileInput }
    ]);
  });

  it('reads the clearinghouse connection with whether secrets can be stored', async () => {
    const reply = { connection: null, canStoreSecrets: true };
    const { client, calls } = recording(reply);
    assert.deepEqual(await client.connection(), reply);
    assert.deepEqual(calls, [
      { method: 'GET', url: 'http://api.test/api/clearinghouse-connection', body: undefined }
    ]);
  });

  it('saves and removes the clearinghouse connection', async () => {
    const { client, calls } = recording();
    await client.saveConnection(connectionInput);
    await client.removeConnection();
    assert.deepEqual(calls, [
      { method: 'PUT', url: 'http://api.test/api/clearinghouse-connection', body: connectionInput },
      { method: 'DELETE', url: 'http://api.test/api/clearinghouse-connection', body: undefined }
    ]);
  });

  it('rejects with the server error and its status', async () => {
    const { client } = recording({ error: 'Enter a valid NPI' }, 400);
    await assert.rejects(client.saveProfile(profileInput), {
      message: 'Enter a valid NPI',
      status: 400
    });
  });
});
