import { applyPayerFile, type Db, findImported, readPayerFile } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { safeName, type UploadedFile, uploadKey } from '../../shared/files.ts';
import { type Announce, announced } from '../../shared/live.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok } from '../../shared/result.ts';
import { findPayerFile, listFileItems, listPayerFiles } from './queries.ts';
import type { PayerFileSort } from './schemas.ts';

type PayerFileServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>;
  announce: Announce;
  now: () => Date;
  maxBytes: number;
};

export const createPayerFileService = ({
  db,
  boss,
  blobs,
  announce,
  now,
  maxBytes
}: PayerFileServiceDeps) => ({
  list: async (tenantId: string, page: PageRequest<PayerFileSort>) =>
    ok(await listPayerFiles(db, tenantId, page)),

  find: async (tenantId: string, id: string) => {
    const file = await findPayerFile(db, tenantId, id);
    if (!file) return fail('not_found', 'Payer file not found');
    const { document: _, ...meta } = file;
    return ok({ file: meta, items: await listFileItems(db, id) });
  },

  download: async (tenantId: string, id: string) => {
    const file = await findPayerFile(db, tenantId, id);
    if (!file) return fail('not_found', 'Payer file not found');
    return ok({ name: file.file_name, bytes: await blobs.getBytes(file.document as BlobRef) });
  },

  upload: async (tenantId: string, userId: string, file: UploadedFile) => {
    if (file.bytes.byteLength > maxBytes) {
      return fail('invalid', `The file is larger than ${maxBytes} bytes`);
    }
    const read = readPayerFile(file.bytes);
    if (!read.ok) return read;
    const inbound = read.value;
    const imported = await findImported(db, tenantId, inbound.digest);
    if (imported) {
      return fail(
        'conflict',
        `This file was already imported on ${imported.created_at.toISOString().slice(0, 10)}`,
        { id: imported.id }
      );
    }
    const fileName = file.name.trim() || safeName(file.name);
    const document = await blobs.putBytes(
      uploadKey(tenantId, fileName, 'payer-files/'),
      file.bytes,
      'application/edi-x12'
    );
    const touched: string[] = [];
    const saved = db.transaction().execute(async (tx) => {
      const applied = await applyPayerFile(tx, boss, {
        tenantId,
        userId,
        fileName,
        document,
        file: inbound,
        now: now()
      });
      touched.push(...new Set(applied.items.flatMap((i) => (i.claimId ? [i.claimId] : []))));
      return ok({
        id: applied.id,
        kind: applied.kind,
        items: applied.items.length,
        problems: applied.problems
      });
    });
    return announced(announce, tenantId, saved, () =>
      touched.map((id) => ({ kind: 'claim' as const, id }))
    );
  }
});

export type PayerFileService = ReturnType<typeof createPayerFileService>;
