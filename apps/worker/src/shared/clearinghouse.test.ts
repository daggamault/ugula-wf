import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { MOCK_HOST_KEY, WAYSTAR_EXTENSIONS } from '@ugula/billing';
import { openSecret, parseKeyring, sealSecret } from '@ugula/clearinghouse';
import { createRecordingDb } from '@ugula/db/testing';
import { type ConnectionSettings, connect, createConnections, sourceOf } from './clearinghouse.ts';

const newKey = () => randomBytes(32).toString('base64');

const oldKey = newKey();

const keyring = parseKeyring(newKey(), [oldKey]);

const fallback: ConnectionSettings = {
  host: 'localhost',
  port: 2223,
  hostKey: MOCK_HOST_KEY,
  username: 'ugula',
  password: 'secret',
  uploadPath: '/upload',
  downloadPaths: ['/download'],
  extensions: WAYSTAR_EXTENSIONS,
  afterDownload: 'delete',
  realtimeUrl: 'http://localhost:2224/core/realtime'
};

const row = (
  agencyId: string,
  username: string,
  { secret = sealSecret(keyring, 'pw', agencyId), enabled = true } = {}
) => ({
  agency_id: agencyId,
  enabled,
  sftp_host: 'sshftp.waystar.com',
  sftp_port: 22,
  sftp_host_key: `SHA256:${'w'.repeat(43)}`,
  sftp_username: username,
  sftp_secret: secret,
  upload_path: '/upload',
  download_paths: ['/download'],
  claim_extension: '.CLP',
  eligibility_extension: '.ELG',
  claim_status_extension: '.CLS',
  after_download: 'keep',
  realtime_url: 'https://rt.waystar.example/core',
  submitter_id: 'SUB01',
  receiver_id: 'WAYSTAR'
});

const setup = (rows: ReturnType<typeof row>[], withFallback = true, withKey = true) => {
  const { db, queries } = createRecordingDb((q) => {
    if (q.sql.startsWith('select') && q.sql.includes('from "clearinghouse_connections"')) {
      const agency = q.parameters.find((p) => typeof p === 'string' && p.startsWith('t'));
      return agency ? rows.filter((r) => r.agency_id === agency) : rows;
    }
    if (q.sql.includes('from "billing_profiles"')) {
      return [{ submitter_id: 'SUB09', receiver_id: 'ZIRMED' }];
    }
    return [];
  });
  const reports: string[] = [];
  const sent: { sender: string; receiver: string }[] = [];
  const fetchCore: typeof fetch = async (_, init) => {
    const form = init?.body as FormData;
    sent.push({ sender: String(form.get('SenderID')), receiver: String(form.get('ReceiverID')) });
    return new Response('down', { status: 503 });
  };
  const connections = createConnections({
    db,
    keyring: withKey ? keyring : null,
    fallback: withFallback ? fallback : null,
    fetch: fetchCore,
    realtimeTimeoutMs: 1000,
    report: (m) => reports.push(m)
  });
  return { connections, queries, reports, sent };
};

describe('connect', () => {
  it('checks in real time only with a real-time URL, a sender and a receiver', () => {
    const realtime = { senderId: 'SUB01', receiverId: 'WAYSTAR', fetch, timeoutMs: 1000 };
    const ch = connect(fallback, realtime);
    assert.ok(ch.checkEligibility && ch.checkClaimStatus);
    assert.equal(ch.afterDownload, 'delete');
    assert.equal(connect({ ...fallback, realtimeUrl: null }, realtime).checkEligibility, null);
    assert.equal(connect(fallback, { ...realtime, senderId: null }).checkClaimStatus, null);
    assert.equal(connect(fallback, { ...realtime, receiverId: null }).checkClaimStatus, null);
  });

  it('names a connection by its account, server and download folders', () => {
    assert.equal(sourceOf(fallback), 'sftp://ugula@localhost:2223/download');
  });
});

describe('createConnections', () => {
  it("uses an agency's own connection, else the server default, else none", async () => {
    const own = setup([row('t1', 'acme')]);
    assert.equal((await own.connections.forAgency('t1'))?.afterDownload, 'keep');
    const fallen = await own.connections.forAgency('t2');
    assert.ok(fallen?.checkEligibility);
    assert.equal(await setup([], false).connections.forAgency('t2'), null);
  });

  it('treats a paused connection as paused instead of falling back to the default', async () => {
    const { connections } = setup([row('t1', 'acme', { enabled: false })]);
    assert.equal(await connections.forAgency('t1'), null);
    assert.deepEqual(
      (await connections.pollTargets()).map((t) => t.source),
      ['sftp://ugula@localhost:2223/download']
    );
  });

  it('sends real-time requests from the submitter ID to the profile receiver ID', async () => {
    const { connections, sent } = setup([row('t1', 'acme')]);
    await (await connections.forAgency('t1'))?.checkEligibility?.('ISA~');
    await (await connections.forAgency('t2'))?.checkEligibility?.('ISA~');
    assert.deepEqual(sent, [
      { sender: 'SUB01', receiver: 'WAYSTAR' },
      { sender: 'SUB09', receiver: 'ZIRMED' }
    ]);
  });

  it('polls every enabled connection once, naming the agencies each one serves', async () => {
    const { connections } = setup([row('t1', 'acme'), row('t2', 'acme'), row('t3', 'metro')]);
    assert.deepEqual(
      (await connections.pollTargets()).map((t) => [t.source, t.agencyIds]),
      [
        ['sftp://ugula@localhost:2223/download', null],
        ['sftp://acme@sshftp.waystar.com:22/download', ['t1', 't2']],
        ['sftp://metro@sshftp.waystar.com:22/download', ['t3']]
      ]
    );
  });

  it('seals passwords sealed with a previous key again with the current one', async () => {
    const old = parseKeyring(oldKey);
    const stale = sealSecret(old, 'pw', 't1');
    const { connections, queries, reports } = setup(
      [row('t1', 'acme', { secret: stale, enabled: false }), row('t2', 'metro')],
      false
    );
    await connections.pollTargets();
    const updates = queries.filter((q) => q.sql.startsWith('update "clearinghouse_connections"'));
    assert.equal(updates.length, 1);
    const [sealed, agencyId, previous] = updates[0]?.parameters ?? [];
    assert.deepEqual([agencyId, previous], ['t1', stale]);
    assert.equal(openSecret(keyring, String(sealed), 't1'), 'pw');
    assert.ok(String(sealed).startsWith(`v1.${keyring.current.id}.`));
    assert.deepEqual(reports, [
      'Clearinghouse: sealed the password of agency t1 with the current key'
    ]);
  });

  it('skips connections whose password cannot be opened, saying why', async () => {
    const tampered = setup([row('t1', 'acme', { secret: sealSecret(keyring, 'pw', 't9') })], false);
    assert.deepEqual(await tampered.connections.pollTargets(), []);
    assert.equal(await tampered.connections.forAgency('t1'), null);
    assert.match(tampered.reports[0] ?? '', /password of agency t1 cannot be opened/);
    const keyless = setup([row('t1', 'acme')], false, false);
    assert.deepEqual(await keyless.connections.pollTargets(), []);
    assert.match(keyless.reports[0] ?? '', /CLEARINGHOUSE_SECRET_KEY is not set/);
  });
});
