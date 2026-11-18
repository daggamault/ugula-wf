import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKeyring, type RemoteFile, sealSecret } from '@ugula/clearinghouse';
import { createRecordingDb } from '@ugula/db/testing';
import {
  COLLECT_QUEUE,
  collectClearinghouseFiles,
  collectCron,
  registerCollectJob
} from './collect.ts';

const keyring = parseKeyring(Buffer.alloc(32, 7).toString('base64'));

const connection = (agencyId: string, afterDownload = 'delete') => ({
  agency_id: agencyId,
  sftp_host: 'localhost',
  sftp_port: 2223,
  sftp_host_key: 'SHA256:mock',
  sftp_username: 'ugula',
  sftp_secret: sealSecret(keyring, 'secret', agencyId),
  download_paths: ['/download'],
  after_download: afterDownload
});

const ACK =
  'ISA*00*          *00*          *ZZ*WAYSTAR        *ZZ*SUB01          *261103*1200*^*00501*000000001*0*T*:~GS*FA*WAYSTAR*SUB01*20261103*1200*1*X*005010X231A1~ST*999*0001*005010X231A1~AK1*HC*42*005010X222A1~AK9*A*1*1*1~SE*4*0001~GE*1*1~IEA*1*000000001~';

describe('collectCron', () => {
  it('polls every few minutes, within an hour', () => {
    assert.equal(collectCron(5), '*/5 * * * *');
    assert.equal(collectCron(0), '*/1 * * * *');
    assert.equal(collectCron(90), '*/59 * * * *');
  });
});

describe('collectClearinghouseFiles', () => {
  it('keeps each file of every active connection once, by its content, as the kind it is', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."agency_id"')
        ? [connection('a-1'), connection('a-2', 'keep')]
        : []
    );
    const calls: [string, string, readonly string[], boolean][] = [];
    const collected = await collectClearinghouseFiles({
      db,
      keyring,
      report: () => undefined,
      collect: async (account, dirs, keep, remove) => {
        calls.push([account.host, account.password, dirs, remove]);
        await keep({ name: 'A.999', path: '/download/A.999', content: ACK } as RemoteFile);
        return 1;
      }
    })();
    assert.equal(collected, 2);
    assert.deepEqual(calls, [
      ['localhost', 'secret', ['/download'], true],
      ['localhost', 'secret', ['/download'], false]
    ]);
    const inserts = queries.filter((q) => q.sql.startsWith('insert into "clearinghouse_files"'));
    assert.equal(inserts.length, 2);
    assert.match(inserts[0]?.sql ?? '', /on conflict \("agency_id", "content_hash"\) do nothing$/);
    assert.deepEqual(inserts[0]?.parameters.slice(0, 3), ['a-1', '999', 'A.999']);
    assert.match(String(inserts[0]?.parameters[4]), /^[0-9a-f]{64}$/);
  });

  it('reports a connection that fails and goes on with the rest', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."agency_id"') ? [connection('a-1'), connection('a-2')] : []
    );
    const reports: string[] = [];
    const collected = await collectClearinghouseFiles({
      db,
      keyring,
      report: (m) => void reports.push(m),
      collect: async (account) => {
        if (account.username === 'ugula' && reports.length === 0) throw new Error('timed out');
        return 3;
      }
    })();
    assert.equal(collected, 3);
    assert.match(reports[0] ?? '', /agency a-1 failed: Error: timed out/);
  });

  it('collects nothing without the key to open the passwords', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "c"."agency_id"') ? [connection('a-1')] : []
    );
    const reports: string[] = [];
    const collected = await collectClearinghouseFiles({
      db,
      keyring: null,
      report: (m) => void reports.push(m),
      collect: async () => {
        throw new Error('should not connect');
      }
    })();
    assert.equal(collected, 0);
    assert.match(reports[0] ?? '', /no CLEARINGHOUSE_SECRET_KEY/);
  });
});

describe('registerCollectJob', () => {
  it('collects on a schedule, one run at a time', async () => {
    const calls: unknown[][] = [];
    let collected = 0;
    await registerCollectJob({
      boss: {
        createQueue: async (name) => void calls.push(['createQueue', name]),
        schedule: async (name, cron) => void calls.push(['schedule', name, cron]),
        work: async (name, options, handler) => {
          calls.push(['work', name, options]);
          await handler([]);
          return name;
        }
      },
      minutes: 2,
      collect: async () => {
        collected += 1;
        return 0;
      }
    });
    assert.deepEqual(calls, [
      ['createQueue', COLLECT_QUEUE],
      ['schedule', COLLECT_QUEUE, '*/2 * * * *'],
      ['work', COLLECT_QUEUE, { localConcurrency: 1, batchSize: 1 }]
    ]);
    assert.equal(collected, 1);
  });
});
