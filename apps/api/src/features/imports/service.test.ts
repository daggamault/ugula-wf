import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword } from '@ugula/auth';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createImportService } from './service.ts';

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
    if (q.sql.includes('from "nemsis_elements"'))
      return [{ element: 'eRecord.01', name: 'Patient Care Report Number' }];
    if (q.sql.includes('from "nemsis_codes"')) return [];
    if (q.sql.includes('from "import_reports"')) {
      return q.parameters.includes('rep-1')
        ? [
            {
              id: 'rep-1',
              position: 0,
              pcr_number: 'PCR-1',
              report: { bucket: 'ugula', key: 'imports/t-1/f.xml.reports/00000.json' },
              import_id: 'i1',
              file_name: 'f.xml',
              created_at: '2026-10-01T00:00:00Z'
            }
          ]
        : [];
    }
    if (q.sql.startsWith('select')) return published ? [{ id: 'v1', version: 2 }] : [];
    return [{ id: 'r1' }];
  });
  const stored: string[] = [];
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_n, batch) => void jobs.push(...batch) };
  const { announce, events: announced } = recordAnnouncements();
  const service = createImportService({
    db,
    boss,
    announce,
    sftp,
    maxBytes: 10,
    blobs: {
      putBytes: async (key, body, contentType) => {
        stored.push(key);
        return { bucket: 'ugula', key, size: body.byteLength, contentType };
      },
      getJson: async () => ({ eRecord: { 'eRecord.01': 'PCR-1' } })
    }
  });
  return { service, stored, jobs, queries, announced };
};

const file = (text: string, name = 'pcrs.xml') => ({
  name,
  type: 'application/xml',
  bytes: new TextEncoder().encode(text)
});

describe('import service uploads', () => {
  it('stores the upload and starts the workflow with a reference to it', async () => {
    const { service, stored, jobs, queries } = setup();
    const res = await service.upload('t-1', 'u-1', 'billing.ingest-nemsis', file('<x/>'));
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
    const recorded = queries.find((q) => q.sql.startsWith('insert into "imports"'));
    assert.deepEqual(recorded?.parameters.slice(0, 4), ['t-1', 'r1', 'upload', 'pcrs.xml']);
    assert.equal(recorded?.parameters.at(-1), 'u-1');
  });

  it('rejects empty, oversized and unroutable uploads before storing anything', async () => {
    const { service, stored } = setup({ published: false });
    const code = async (f: ReturnType<typeof file>) => {
      const res = await service.upload('t-1', 'u-1', 'billing.ingest-nemsis', f);
      return res.ok ? 'ok' : res.failure.code;
    };
    assert.equal(await code(file('')), 'invalid');
    assert.equal(await code(file('01234567890')), 'invalid');
    assert.equal(await code(file('<x/>')), 'not_found');
    assert.deepEqual(stored, []);
  });

  it('finds an import and pages its reports only within the tenant', async () => {
    const { service, queries } = setup();
    const page = { page: 1, pageSize: 25, sort: 'position' as const, dir: 'asc' as const };
    const found = await service.find('t-1', 'i1');
    assert.ok(found.ok && 'import' in found.value && !('reports' in found.value));
    assert.equal((await service.reports('t-1', 'i1', page)).ok, true);
    assert.ok(queries.some((q) => q.sql.includes('from "import_reports" as "ir"')));
    const { service: empty } = setup({ published: false });
    assert.equal((await empty.reports('t-1', 'i9', page)).ok, false);
    assert.equal((await empty.find('t-1', 'i9')).ok, false);
  });

  it('reads one stored report of the tenant with its XML', async () => {
    const { service, queries } = setup();
    assert.deepEqual(await service.report('t-1', 'rep-1'), {
      ok: true,
      value: {
        report: {
          id: 'rep-1',
          position: 0,
          pcr_number: 'PCR-1',
          import_id: 'i1',
          file_name: 'f.xml',
          created_at: '2026-10-01T00:00:00Z'
        },
        data: { eRecord: { 'eRecord.01': 'PCR-1' } },
        xml: '<PatientCareReport>\n  <eRecord>\n    <eRecord.01>PCR-1</eRecord.01>\n  </eRecord>\n</PatientCareReport>',
        dictionary: { elements: { 'eRecord.01': 'Patient Care Report Number' }, codes: {} }
      }
    });
    const codes = queries.find((q) => q.sql.includes('from "nemsis_codes"'));
    assert.ok(codes?.sql.includes('("list", "code") in (($1, $2))'));
    assert.deepEqual(codes?.parameters, ['eRecord.01', 'PCR-1']);
    const lookup = queries.find((q) => q.sql.includes('from "import_reports"'));
    assert.ok(lookup?.sql.endsWith('where "r"."id" = $1 and "i"."tenant_id" = $2'));
    const missing = await service.report('t-1', 'rep-9');
    assert.equal(!missing.ok && missing.failure.code, 'not_found');
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
    const { service, jobs, queries } = setup({ tenant: { id: 't-1', sftp_password_hash: '' } });
    const event = {
      action: 'upload',
      username: 'acme-ems',
      virtual_path: '/2026/pcrs.xml',
      file_size: 9,
      status: 1
    };
    const res = await service.receiveSftpEvent(event);
    assert.deepEqual(res.ok && 'file' in res.value && res.value.file, {
      bucket: 'ugula',
      key: 'imports/t-1/sftp/2026/pcrs.xml',
      size: 9,
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
    const recorded = queries.find((q) => q.sql.startsWith('insert into "imports"'));
    assert.deepEqual(recorded?.parameters.slice(0, 4), ['t-1', 'r1', 'sftp', 'pcrs.xml']);
    assert.equal(recorded?.parameters.at(-1), null);
    const unknown = await setup().service.receiveSftpEvent(event);
    assert.equal(!unknown.ok && unknown.failure.code, 'not_found');
  });

  it('refuses oversized files and unsafe paths before recording an import', async () => {
    const { service, jobs, queries } = setup({ tenant: { id: 't-1', sftp_password_hash: '' } });
    const event = {
      action: 'upload',
      username: 'acme-ems',
      virtual_path: '/a.xml',
      file_size: 5,
      status: 1
    };
    const code = async (e: Partial<typeof event>) => {
      const res = await service.receiveSftpEvent({ ...event, ...e });
      return res.ok ? 'ok' : res.failure.code;
    };
    assert.equal(await code({ file_size: 11 }), 'invalid');
    for (const path of ['/../t-2/a.xml', '/a/./b.xml', '/a//b.xml', '/a\\b.xml', '/', '/a/..']) {
      assert.equal(await code({ virtual_path: path }), 'invalid', path);
    }
    assert.deepEqual(queries, []);
    assert.equal(jobs.length, 0);
    assert.equal(await code({}), 'ok');
  });
});

describe('import service announcements and names', () => {
  it('announces new imports to the tenant and names unnamed uploads safely', async () => {
    const { service, announced, queries } = setup();
    assert.ok((await service.upload('t-1', 'u-1', 'billing.ingest-nemsis', file('<x/>', '  '))).ok);
    assert.deepEqual(announced, [{ tenantId: 't-1', event: { kind: 'import', id: null } }]);
    const recorded = queries.find((q) => q.sql.startsWith('insert into "imports"'));
    assert.equal(recorded?.parameters[3], 'upload');
    const refused = setup({ published: false });
    await refused.service.upload('t-1', 'u-1', 'billing.ingest-nemsis', file('<x/>'));
    assert.deepEqual(refused.announced, []);
  });

  it('refuses SFTP logins for tenants without an SFTP password', async () => {
    const { service } = setup({ tenant: { id: 't-1', sftp_password_hash: '' } });
    assert.deepEqual(await service.authenticateSftp('acme-ems', ''), {
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid SFTP credentials' }
    });
  });
});
