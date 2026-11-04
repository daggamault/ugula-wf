import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { WAYSTAR_EXTENSIONS } from '@ugula/billing';
import { parseSecretKey, sealSecret } from '@ugula/clearinghouse';
import { createRecordingDb } from '@ugula/db/testing';
import { type ConnectionSettings, connect, createConnections, sourceOf } from './clearinghouse.ts';

const key = parseSecretKey(randomBytes(32).toString('base64'));

const fallback: ConnectionSettings = {
  host: 'localhost',
  port: 2223,
  username: 'ugula',
  password: 'secret',
  uploadPath: '/upload',
  downloadPaths: ['/download'],
  extensions: WAYSTAR_EXTENSIONS,
  afterDownload: 'delete',
  realtimeUrl: 'http://localhost:2224/core/realtime'
};

const row = (agencyId: string, username: string, secret = sealSecret(key, 'pw', agencyId)) => ({
  agency_id: agencyId,
  sftp_host: 'sshftp.waystar.com',
  sftp_port: 22,
  sftp_username: username,
  sftp_secret: secret,
  upload_path: '/upload',
  download_paths: ['/download'],
  claim_extension: '.CLP',
  eligibility_extension: '.ELG',
  claim_status_extension: '.CLS',
  after_download: 'keep',
  realtime_url: null,
  submitter_id: 'SUB01'
});

const setup = (rows: ReturnType<typeof row>[], withFallback = true, withKey = true) => {
  const { db, queries } = createRecordingDb((q) => {
    if (q.sql.includes('from "clearinghouse_connections"')) {
      const agency = q.parameters.find((p) => typeof p === 'string' && p.startsWith('t'));
      return agency ? rows.filter((r) => r.agency_id === agency) : rows;
    }
    if (q.sql.includes('from "billing_profiles"')) return [{ submitter_id: 'SUB09' }];
    return [];
  });
  const reports: string[] = [];
  const connections = createConnections({
    db,
    key: withKey ? key : null,
    fallback: withFallback ? fallback : null,
    fetch,
    realtimeTimeoutMs: 1000,
    report: (m) => reports.push(m)
  });
  return { connections, queries, reports };
};

describe('connect', () => {
  it('checks in real time only with a real-time URL and a sender', () => {
    const realtime = { senderId: 'SUB01', fetch, timeoutMs: 1000 };
    const ch = connect(fallback, realtime);
    assert.ok(ch.checkEligibility && ch.checkClaimStatus);
    assert.equal(ch.afterDownload, 'delete');
    assert.equal(connect({ ...fallback, realtimeUrl: null }, realtime).checkEligibility, null);
    assert.equal(connect(fallback, { ...realtime, senderId: null }).checkClaimStatus, null);
  });

  it('names a connection by its account, server and download folders', () => {
    assert.equal(sourceOf(fallback), 'sftp://ugula@localhost:2223/download');
  });
});

describe('createConnections', () => {
  it("uses an agency's own connection, else the server default, else none", async () => {
    const own = setup([row('t1', 'acme')]);
    assert.equal((await own.connections.forAgency('t1'))?.afterDownload, 'keep');
    assert.ok(own.queries[0]?.sql.includes('"cc"."enabled" = $1'));
    const fallen = await own.connections.forAgency('t2');
    assert.ok(fallen?.checkEligibility);
    assert.equal(await setup([], false).connections.forAgency('t2'), null);
  });

  it('polls every enabled connection once, the default included', async () => {
    const { connections } = setup([row('t1', 'acme'), row('t2', 'acme'), row('t3', 'metro')]);
    assert.deepEqual(
      (await connections.pollTargets()).map((t) => t.source),
      [
        'sftp://ugula@localhost:2223/download',
        'sftp://acme@sshftp.waystar.com:22/download',
        'sftp://metro@sshftp.waystar.com:22/download'
      ]
    );
  });

  it('skips connections whose password cannot be opened, saying why', async () => {
    const tampered = setup([row('t1', 'acme', sealSecret(key, 'pw', 't9'))], false);
    assert.deepEqual(await tampered.connections.pollTargets(), []);
    assert.equal(await tampered.connections.forAgency('t1'), null);
    assert.match(tampered.reports[0] ?? '', /password of agency t1 cannot be opened/);
    const keyless = setup([row('t1', 'acme')], false, false);
    assert.deepEqual(await keyless.connections.pollTargets(), []);
    assert.match(keyless.reports[0] ?? '', /CLEARINGHOUSE_SECRET_KEY is not set/);
  });
});
