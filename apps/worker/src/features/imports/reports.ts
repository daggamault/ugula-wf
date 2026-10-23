import { type BlobStore, importsPrefix } from '@ugula/blobs';
import type { Database } from '@ugula/db';
import type { ReportStore } from '@ugula/nemsis';
import type { Kysely } from 'kysely';
import { runTenant } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'getText' | 'getJson' | 'putJson'>;

export const createReportStore = (db: Kysely<Database>, blobs: Blobs): ReportStore => {
  const authorize = async (runId: string, key: string) => {
    const run = await runTenant(db, runId).executeTakeFirst();
    if (!run || !key.startsWith(importsPrefix(run.tenant_id)) || key.split('/').includes('..')) {
      throw new Error(`Blob ${key} is not one of this tenant's imports`);
    }
  };
  return {
    getText: async (runId, ref) => {
      await authorize(runId, ref.key);
      return blobs.getText(ref);
    },
    getJson: async (runId, ref) => {
      await authorize(runId, ref.key);
      return blobs.getJson(ref);
    },
    putJson: async (runId, key, value) => {
      await authorize(runId, key);
      return blobs.putJson(key, value);
    }
  };
};
