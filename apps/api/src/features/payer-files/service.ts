import { type Db, findImported, readPayerFile, resolveWorkflowVersion, startRun } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { safeName, type UploadedFile, uploadKey } from '../../shared/files.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok } from '../../shared/result.ts';
import { findPayerFile, listFileItems, listPayerFiles } from './queries.ts';
import type { PayerFileSort } from './schemas.ts';

export const RECEIVE_WORKFLOW = 'billing.receive-payer-file';

type PayerFileServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes' | 'remove'>;
  maxBytes: number;
};

export const createPayerFileService = ({ db, boss, blobs, maxBytes }: PayerFileServiceDeps) => ({
  list: async (agencyId: string, page: PageRequest<PayerFileSort>) =>
    ok(await listPayerFiles(db, agencyId, page)),

  find: async (agencyId: string, id: string) => {
    const file = await findPayerFile(db, agencyId, id);
    if (!file) return fail('not_found', 'Payer file not found');
    const { document: _, ...meta } = file;
    return ok({ file: meta, items: await listFileItems(db, id) });
  },

  download: async (agencyId: string, id: string) => {
    const file = await findPayerFile(db, agencyId, id);
    if (!file) return fail('not_found', 'Payer file not found');
    return ok({ name: file.file_name, bytes: await blobs.getBytes(file.document as BlobRef) });
  },

  upload: async (agencyId: string, userId: string, file: UploadedFile) => {
    if (file.bytes.byteLength > maxBytes) {
      return fail('invalid', `The file is larger than ${maxBytes} bytes`);
    }
    const read = readPayerFile(file.bytes);
    if (!read.ok) return read;
    const inbound = read.value;
    const imported = await findImported(db, agencyId, inbound.digest);
    if (imported) {
      return fail(
        'conflict',
        `This file was already imported on ${imported.created_at.toISOString().slice(0, 10)}`,
        { id: imported.id }
      );
    }
    const fileName = file.name.trim() || safeName(file.name);
    const version = await resolveWorkflowVersion(db, agencyId, RECEIVE_WORKFLOW);
    if (!version) return fail('conflict', `The ${RECEIVE_WORKFLOW} workflow is not published`);
    const document = await blobs.putBytes(
      uploadKey(agencyId, fileName, 'payer-files/'),
      file.bytes,
      'application/edi-x12'
    );
    const runId = await db
      .transaction()
      .execute((tx) =>
        startRun(tx, boss, {
          agencyId,
          versionId: version.id,
          inputs: { file: document, fileName },
          interactive: true,
          startedBy: userId
        })
      )
      .catch(async (err: unknown) => {
        await blobs.remove(document);
        throw err;
      });
    return ok({ runId, kind: inbound.kind });
  }
});

export type PayerFileService = ReturnType<typeof createPayerFileService>;
