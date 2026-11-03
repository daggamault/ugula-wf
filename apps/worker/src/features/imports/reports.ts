import type { Database } from '@ugula/db';
import type { ReportStore } from '@ugula/nemsis';
import { type BlobStore, importsPrefix } from '@ugula/storage';
import type { Kysely } from 'kysely';
import { runTenant, type TenantOf } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'getText' | 'getJson' | 'putJson'>;

export const fileNameOf = (key: string) => key.split('/').at(-1) || key;

export const createReportStore = (
  db: Kysely<Database>,
  blobs: Blobs,
  tenantOf: TenantOf
): ReportStore => {
  const authorize = async (runId: string, key: string) => {
    const tenantId = await tenantOf(runId);
    if (!tenantId || !key.startsWith(importsPrefix(tenantId)) || key.split('/').includes('..')) {
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
    },
    findPlaces: async (codes) => {
      const ids = codes.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
      if (!ids.length) return {};
      const rows = await db
        .selectFrom('gnis_places')
        .select(['id', 'name'])
        .where('id', 'in', ids)
        .execute();
      return Object.fromEntries(rows.map((p) => [String(p.id), p.name]));
    },
    recordReports: async (runId, file, reports) => {
      await authorize(runId, file.key);
      await db.transaction().execute(async (tx) => {
        const { id } = await tx
          .insertInto('imports')
          .values({
            tenant_id: runTenant(tx, runId),
            run_id: runId,
            source: 'manual',
            file_name: fileNameOf(file.key),
            file: JSON.stringify(file),
            report_count: reports.length
          })
          .onConflict((oc) => oc.column('run_id').doUpdateSet({ report_count: reports.length }))
          .returning('id')
          .executeTakeFirstOrThrow();
        if (!reports.length) return;
        await tx
          .insertInto('import_reports')
          .values(
            reports.map((r) => ({
              import_id: id,
              position: r.position,
              pcr_number: r.pcrNumber,
              report: JSON.stringify(r.report)
            }))
          )
          .onConflict((oc) => oc.columns(['import_id', 'position']).doNothing())
          .execute();
      });
    }
  };
};
