import { verifyPassword } from '@ugula/auth';
import { type Db, resolveWorkflowVersion, startRun } from '@ugula/db';
import type { Json } from '@ugula/graph';
import { reportTerms, reportXml } from '@ugula/nemsis';
import type { RunQueueClient } from '@ugula/run-queue';
import { type BlobRef, type BlobStore, importsPrefix } from '@ugula/storage';
import { safeName, type UploadedFile, uploadKey } from '../../shared/files.ts';
import type { Announce } from '../../shared/live.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import {
  findDictionary,
  findImport,
  findReport,
  findSftpAgency,
  type ImportFilters,
  insertImport,
  listImportReports,
  listImports,
  type NewImport
} from './queries.ts';
import type { ReportSort, SftpEvent } from './schemas.ts';

const INGEST_WORKFLOW = 'billing.ingest-nemsis';

type SftpStorage = {
  bucket: string;
  region: string;
  endpoint: string;
  homeRoot: string;
};

type ImportServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  blobs: Pick<BlobStore, 'putBytes' | 'getJson'>;
  announce: Announce;
  maxBytes: number;
  sftp: SftpStorage;
};

type SftpReceipt = { runId: string; file: BlobRef } | { ignored: true };

const sftpPrefix = (agencyId: string) => `${importsPrefix(agencyId)}sftp/`;

const sftpUser = (username: string, agencyId: string, sftp: SftpStorage) => ({
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
      key_prefix: sftpPrefix(agencyId),
      force_path_style: true
    }
  }
});

const importNotFound = fail('not_found', 'Import not found');

const sftpPathOf = (virtualPath: string) => {
  const path = virtualPath.replace(/^\/+/, '');
  const safe =
    path !== '' &&
    !path.includes('\\') &&
    path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
  return safe ? path : null;
};

export const createImportService = ({
  db,
  boss,
  blobs,
  maxBytes,
  sftp,
  announce
}: ImportServiceDeps) => {
  const unpublished = (workflow: string) =>
    fail('not_found', `Workflow ${workflow} has no published version`);

  const ingest = async (
    agencyId: string,
    versionId: string,
    file: BlobRef,
    origin: Pick<NewImport, 'source' | 'fileName' | 'uploadedBy'>
  ) => {
    const runId = await db.transaction().execute(async (tx) => {
      const id = await startRun(tx, boss, {
        agencyId,
        versionId,
        inputs: { file },
        interactive: true
      });
      await insertImport(tx, { agencyId, runId: id, file, ...origin });
      return id;
    });
    await announce(agencyId, { kind: 'import', id: null }).catch(() => undefined);
    return ok({ runId, file });
  };

  return {
    list: async (agencyId: string, filters: ImportFilters) =>
      ok(await listImports(db, agencyId, filters)),

    find: async (agencyId: string, id: string) => {
      const found = await findImport(db, agencyId, id);
      return found ? ok({ import: found }) : importNotFound;
    },

    reports: async (agencyId: string, id: string, page: PageRequest<ReportSort>) =>
      (await findImport(db, agencyId, id))
        ? ok(await listImportReports(db, agencyId, id, page))
        : importNotFound,

    report: async (agencyId: string, id: string) => {
      const found = await findReport(db, agencyId, id);
      if (!found) return fail('not_found', 'Report not found');
      const { report, ...meta } = found;
      const data = (await blobs.getJson(report as BlobRef)) as Json;
      const dictionary = await findDictionary(db, reportTerms(data));
      return ok({ report: meta, data, xml: reportXml(data), dictionary });
    },

    upload: async (agencyId: string, userId: string, workflow: string, file: UploadedFile) => {
      if (!file.bytes.byteLength) return fail('invalid', 'The file is empty');
      if (file.bytes.byteLength > maxBytes) {
        return fail('invalid', `The file is larger than ${maxBytes} bytes`);
      }
      const version = await resolveWorkflowVersion(db, agencyId, workflow);
      if (!version) return unpublished(workflow);
      const ref = await blobs.putBytes(
        uploadKey(agencyId, file.name),
        file.bytes,
        file.type || 'application/octet-stream'
      );
      return ingest(agencyId, version.id, ref, {
        source: 'upload',
        fileName: file.name.trim() || safeName(file.name),
        uploadedBy: userId
      });
    },

    authenticateSftp: async (username: string, password: string) => {
      const agency = await findSftpAgency(db, username);
      const valid =
        agency?.sftp_password_hash && (await verifyPassword(password, agency.sftp_password_hash));
      return valid && agency
        ? ok(sftpUser(username, agency.id, sftp))
        : fail('unauthorized', 'Invalid SFTP credentials');
    },

    receiveSftpEvent: async (event: SftpEvent): Promise<Result<SftpReceipt>> => {
      if (event.action !== 'upload' || event.status !== 1)
        return ok<SftpReceipt>({ ignored: true });
      if (event.file_size > maxBytes) {
        return fail('invalid', `The file is larger than ${maxBytes} bytes`);
      }
      const path = sftpPathOf(event.virtual_path);
      if (!path) return fail('invalid', 'The SFTP path is not a safe relative file path');
      const agency = await findSftpAgency(db, event.username);
      if (!agency) return fail('not_found', `No agency uses SFTP account ${event.username}`);
      const version = await resolveWorkflowVersion(db, agency.id, INGEST_WORKFLOW);
      if (!version) return unpublished(INGEST_WORKFLOW);
      return ingest(
        agency.id,
        version.id,
        {
          bucket: sftp.bucket,
          key: `${sftpPrefix(agency.id)}${path}`,
          size: event.file_size,
          contentType: 'application/xml'
        },
        { source: 'sftp', fileName: path.split('/').at(-1) ?? path, uploadedBy: null }
      );
    }
  };
};

export type ImportService = ReturnType<typeof createImportService>;
