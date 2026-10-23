import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import { hashPassword } from '@ugula/passwords';
import type { CompiledQuery } from 'kysely';
import { createImportService, safeName, sftpPrefix } from './service.ts';

const sftp = {
  bucket: 'ugula',
  region: 'us-east-1',
  endpoint: 'http://rustfs:9000',
  homeRoot: '/srv/sftpgo/data'
};

const setup = ({
  published = true,
  tenant = null as { id: string; sftp_password_hash: string } | null
} = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "tenants"')) return tenant ? [tenant] : [];
    if (q.sql.startsWith('select')) return published ? [{ id: 'v1', version: 2 }] : [];
    return [{ id: 'r1' }];
  });
  const stored: string[] = [];
  const jobs: unknown[] = [];
  const boss: JobBoss = { insert: async (_n, batch) => void jobs.push(...batch) };
  const service = createImportService({
    db,
    boss,
    sftp,
    maxBytes: 10,
    blobs: {
      putBytes: async (key, body, contentType) => {
        stored.push(key);
        return { bucket: 'ugula', key, size: body.byteLength, contentType };
      }
    }
  });
  return { service, stored, jobs, queries };
};

const file = (text: string, name = 'pcrs.xml') => ({
  name,
  type: 'application/xml',
  bytes: new TextEncoder().encode(text)
});

describe('import service uploads', () => {
  it('stores the upload and starts the workflow with a reference to it', async () => {
    const { service, stored, jobs } = setup();
    const res = await service.upload('t-1', 'billing.ingest-nemsis', file('<x/>'));
    assert.ok(res.ok);
    assert.equal(res.value.runId, 'r1');
    assert.match(stored[0] ?? '', /^imports\/t-1\/[0-9a-f-]{36}\/pcrs\.xml$/);
    assert.deepEqual(res.value.file, {
      bucket: 'ugula',
      key: stored[0],
      size: 4,
      contentType: 'application/xml'
    });
    assert.equal(jobs.length, 1);
  });

  it('rejects empty, oversized and unroutable uploads before storing anything', async () => {
    const { service, stored } = setup({ published: false });
    const code = async (f: ReturnType<typeof file>) => {
      const res = await service.upload('t-1', 'billing.ingest-nemsis', f);
      return res.ok ? 'ok' : res.failure.code;
    };
    assert.equal(await code(file('')), 'invalid');
    assert.equal(await code(file('01234567890')), 'invalid');
    assert.equal(await code(file('<x/>')), 'not_found');
    assert.deepEqual(stored, []);
  });

  it('sanitizes file names for storage keys', () => {
    assert.equal(safeName('../../etc/pass wd.xml'), 'etc_pass_wd.xml');
    assert.equal(safeName('...'), 'upload');
  });
});

describe('import service SFTP hooks', () => {
  it('authenticates tenant SFTP accounts into a tenant-scoped S3 folder', async () => {
    const tenant = { id: 't-1', sftp_password_hash: await hashPassword('s3cret-pass') };
    const { service } = setup({ tenant });
    const res = await service.authenticateSftp('acme-ems', 's3cret-pass');
    assert.deepEqual(res, {
      ok: true,
      value: {
        status: 1,
        username: 'acme-ems',
        home_dir: '/srv/sftpgo/data/acme-ems',
        permissions: { '/': ['list', 'upload', 'overwrite', 'create_dirs'] },
        filesystem: {
          provider: 1,
          s3config: {
            bucket: 'ugula',
            region: 'us-east-1',
            endpoint: 'http://rustfs:9000',
            key_prefix: 'imports/t-1/sftp/',
            force_path_style: true
          }
        }
      }
    });
    assert.equal((await service.authenticateSftp('acme-ems', 'wrong')).ok, false);
    assert.equal((await setup().service.authenticateSftp('nobody', 'x')).ok, false);
  });

  it('starts ingest for completed uploads and ignores everything else', async () => {
    const { service, jobs } = setup({ tenant: { id: 't-1', sftp_password_hash: '' } });
    const event = {
      action: 'upload',
      username: 'acme-ems',
      virtual_path: '/2026/pcrs.xml',
      file_size: 99,
      status: 1
    };
    const res = await service.receiveSftpEvent(event);
    assert.deepEqual(res.ok && 'file' in res.value && res.value.file, {
      bucket: 'ugula',
      key: `${sftpPrefix('t-1')}2026/pcrs.xml`,
      size: 99,
      contentType: 'application/xml'
    });
    assert.deepEqual(await service.receiveSftpEvent({ ...event, status: 2 }), {
      ok: true,
      value: { ignored: true }
    });
    assert.deepEqual(await service.receiveSftpEvent({ ...event, action: 'delete' }), {
      ok: true,
      value: { ignored: true }
    });
    assert.equal(jobs.length, 1);
    const unknown = await setup().service.receiveSftpEvent(event);
    assert.equal(!unknown.ok && unknown.failure.code, 'not_found');
  });
});
