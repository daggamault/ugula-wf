import { EVENT_TYPES } from '@ugula/billing';
import {
  type Db,
  emitAndDispatch,
  findEventWorkflows,
  findImported,
  readPayerFile
} from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { safeName, type UploadedFile, uploadKey } from '../../shared/files.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok } from '../../shared/result.ts';
import { findPayerFile, listFileItems, searchPayerFiles } from './queries.ts';
import type { PayerFileSort } from './schemas.ts';

type PayerFileServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes' | 'remove'>;
  maxBytes: number;
};

export const createPayerFileService = ({ db, boss, blobs, maxBytes }: PayerFileServiceDeps) => ({
  maxBytes,
  search: async (agencyId: string, page: PageRequest<PayerFileSort>) =>
    ok(await searchPayerFiles(db, agencyId, page)),

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
    if (!(await findEventWorkflows(db, agencyId, EVENT_TYPES.payerFileReceived)).length) {
      return fail('conflict', 'No published workflow starts when a payer file is received');
    }
    const document = await blobs.putBytes(
      uploadKey(agencyId, fileName, 'payer-files/'),
      file.bytes,
      'application/edi-x12'
    );
    const { runIds } = await db
      .transaction()
      .execute((tx) =>
        emitAndDispatch(tx, boss, {
          agencyId,
          type: EVENT_TYPES.payerFileReceived,
          payload: { file: document, fileName },
          createdBy: userId
        })
      )
      .catch(async (err: unknown) => {
        await blobs.remove(document);
        throw err;
      });
    return ok({ runIds, kind: inbound.kind });
  }
});

export type PayerFileService = ReturnType<typeof createPayerFileService>;
