import { randomUUID } from 'node:crypto';
import { type BlobRef, type BlobStore, importsPrefix } from '@ugula/blobs';
import type { Db } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import { verifyPassword } from '@ugula/passwords';
import { fail, ok, type Result } from '../../shared/result.ts';
import { startRun } from '../../shared/runs.ts';
import {
  findLatestPublished,
  findSftpTenant,
  insertImport,
  listImports,
  type NewImport
} from './queries.ts';
import type { SftpEvent } from './schemas.ts';

export const INGEST_WORKFLOW = 'billing.ingest-nemsis';

export type SftpStorage = {
  bucket: string;
  region: string;
  endpoint: string;
  homeRoot: string;
};

export type ImportServiceDeps = {
  db: Db;
  boss: JobBoss;
  blobs: Pick<BlobStore, 'putBytes'>;
  maxBytes: number;
  sftp: SftpStorage;
};

export type SftpReceipt = { runId: string; file: BlobRef } | { ignored: true };

export type UploadedFile = {
  name: string;
  type: string;
  bytes: Uint8Array;
};

export const safeName = (name: string) =>
  name
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-120) || 'upload';

export const sftpPrefix = (tenantId: string) => `${importsPrefix(tenantId)}sftp/`;

export const sftpUser = (username: string, tenantId: string, sftp: SftpStorage) => ({
  status: 1,
  username,
  home_dir: `${sftp.homeRoot}/${username}`,
  permissions: { '/': ['list', 'upload', 'overwrite', 'create_dirs'] },
  filesystem: {
    provider: 1,
    s3config: {
      bucket: sftp.bucket,
      region: sftp.region,
      endpoint: sftp.endpoint,
      key_prefix: sftpPrefix(tenantId),
      force_path_style: true
    }
  }
});

export const createImportService = ({ db, boss, blobs, maxBytes, sftp }: ImportServiceDeps) => {
  const unpublished = (workflow: string) =>
    fail('not_found', `Workflow ${workflow} has no published version`);

  const ingest = async (
    tenantId: string,
    versionId: string,
    file: BlobRef,
    origin: Pick<NewImport, 'source' | 'fileName' | 'uploadedBy'>
  ) => {
    const runId = await db.transaction().execute(async (tx) => {
      const id = await startRun(tx, boss, { tenantId, versionId, inputs: { file } });
      await insertImport(tx, { tenantId, runId: id, file, ...origin });
      return id;
    });
    return ok({ runId, file });
  };

  return {
    list: async (tenantId: string, limit: number) =>
      ok({ imports: await listImports(db, tenantId, limit) }),

    upload: async (tenantId: string, userId: string, workflow: string, file: UploadedFile) => {
      if (!file.bytes.byteLength) return fail('invalid', 'The file is empty');
      if (file.bytes.byteLength > maxBytes) {
        return fail('invalid', `The file is larger than ${maxBytes} bytes`);
      }
      const version = await findLatestPublished(db, tenantId, workflow);
      if (!version) return unpublished(workflow);
      const ref = await blobs.putBytes(
        `${importsPrefix(tenantId)}${randomUUID()}/${safeName(file.name)}`,
        file.bytes,
        file.type || 'application/octet-stream'
      );
      return ingest(tenantId, version.id, ref, {
        source: 'upload',
        fileName: file.name.trim() || safeName(file.name),
        uploadedBy: userId
      });
    },

    authenticateSftp: async (username: string, password: string) => {
      const tenant = await findSftpTenant(db, username);
      const valid =
        tenant?.sftp_password_hash && (await verifyPassword(password, tenant.sftp_password_hash));
      return valid && tenant
        ? ok(sftpUser(username, tenant.id, sftp))
        : fail('unauthorized', 'Invalid SFTP credentials');
    },

    receiveSftpEvent: async (event: SftpEvent): Promise<Result<SftpReceipt>> => {
      if (event.action !== 'upload' || event.status !== 1)
        return ok<SftpReceipt>({ ignored: true });
      const tenant = await findSftpTenant(db, event.username);
      if (!tenant) return fail('not_found', `No tenant uses SFTP account ${event.username}`);
      const version = await findLatestPublished(db, tenant.id, INGEST_WORKFLOW);
      if (!version) return unpublished(INGEST_WORKFLOW);
      const path = event.virtual_path.replace(/^\/+/, '');
      return ingest(
        tenant.id,
        version.id,
        {
          bucket: sftp.bucket,
          key: `${sftpPrefix(tenant.id)}${path}`,
          size: event.file_size,
          contentType: 'application/xml'
        },
        { source: 'sftp', fileName: path.split('/').at(-1) || path, uploadedBy: null }
      );
    }
  };
};

export type ImportService = ReturnType<typeof createImportService>;
