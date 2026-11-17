import type { Database } from '@ugula/db';
import type { ReportStore, StoredReport } from '@ugula/nemsis';
import { type BlobStore, importsPrefix } from '@ugula/storage';
import type { Kysely } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { type AgencyOf, runAgency } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'getText' | 'getJson' | 'putJson' | 'putBytes'>;

export const fileNameOf = (key: string) => key.split('/').at(-1) || key;

export const createReportStore = (
  db: Kysely<Database>,
  blobs: Blobs,
  agencyOf: AgencyOf
): ReportStore => {
  const authorize = async (runId: string, key: string) => {
    const agencyId = await agencyOf(runId);
    if (!agencyId || !key.startsWith(importsPrefix(agencyId)) || key.split('/').includes('..')) {
      throw new Error(`Blob ${key} is not one of this agency's imports`);
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
    putBytes: async (runId, key, bytes) => {
      await authorize(runId, key);
      return blobs.putBytes(key, bytes, 'application/octet-stream');
    },
    findReport: async (runId, id) => {
      if (!isUuid(id)) return null;
      const row = await db
        .selectFrom('import_reports')
        .select(['id', 'report'])
        .where('id', '=', id)
        .where('agency_id', '=', runAgency(db, runId))
        .executeTakeFirst();
      return row ? { id: row.id, report: row.report as StoredReport['report'] } : null;
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
    recordReports: async (runId, file, importId, reports) => {
      await authorize(runId, file.key);
      return db.transaction().execute(async (tx) => {
        const linked =
          importId && isUuid(importId)
            ? await tx
                .updateTable('imports')
                .set({ run_id: runId, report_count: reports.length })
                .where('id', '=', importId)
                .where('agency_id', '=', runAgency(tx, runId))
                .returning(['id', 'agency_id'])
                .executeTakeFirst()
            : undefined;
        const { id, agency_id } =
          linked ??
          (await tx
            .insertInto('imports')
            .values({
              agency_id: runAgency(tx, runId),
              run_id: runId,
              source: 'manual',
              file_name: fileNameOf(file.key),
              file: JSON.stringify(file),
              report_count: reports.length
            })
            .onConflict((oc) => oc.column('run_id').doUpdateSet({ report_count: reports.length }))
            .returning(['id', 'agency_id'])
            .executeTakeFirstOrThrow());
        if (!reports.length) return [];
        await tx
          .insertInto('import_reports')
          .values(
            reports.map((r) => ({
              agency_id,
              import_id: id,
              position: r.position,
              pcr_number: r.pcrNumber,
              report: JSON.stringify(r.report),
              report_key: r.report.key
            }))
          )
          .onConflict((oc) => oc.columns(['import_id', 'position']).doNothing())
          .execute();
        const rows = await tx
          .selectFrom('import_reports')
          .select('id')
          .where('import_id', '=', id)
          .orderBy('position')
          .execute();
        return rows.map((r) => r.id);
      });
    }
  };
};
