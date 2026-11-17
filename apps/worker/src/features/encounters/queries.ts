import type { Database } from '@ugula/db';
import type { Json } from '@ugula/graph';
import type { EncounterOutcome, EncounterStore } from '@ugula/nemsis';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

export const createEncounterStore = (db: Kysely<Database>): EncounterStore => ({
  saveEncounter: (runId, pcrNumber, data, reportId) =>
    db.transaction().execute(async (tx) => {
      const json = JSON.stringify(data);
      const { rows } = await sql<{ id: string; revision: number; outcome: EncounterOutcome }>`
        with t as (select agency_id from workflow_runs where id = ${runId}),
        current as (
          select e.id, e.revision, e.data = ${json}::jsonb as same
          from encounters e join t on t.agency_id = e.agency_id
          where e.pcr_number = ${pcrNumber}
          for update
        ),
        saved as (
          insert into encounters (agency_id, pcr_number, data)
          select t.agency_id, ${pcrNumber}, ${json}::jsonb from t
          on conflict (agency_id, pcr_number) do update
            set data = excluded.data, revision = encounters.revision + 1, updated_at = now()
            where encounters.data is distinct from excluded.data
          returning id, revision, xmax = 0 as inserted
        )
        select id, revision, case when inserted then 'created' else 'revised' end as outcome
        from saved
        union all
        select id, revision, 'unchanged' from current where same
      `.execute(tx);
      const [saved] = rows;
      if (!saved) throw new Error(`Encounter ${pcrNumber} could not be saved`);
      if (reportId && isUuid(reportId)) {
        await tx
          .updateTable('import_reports')
          .set({ encounter_id: saved.id, outcome: saved.outcome })
          .where('id', '=', reportId)
          .where('agency_id', '=', runAgency(tx, runId))
          .execute();
      }
      return saved;
    }),

  findEncounter: async (runId, id) => {
    if (!isUuid(id)) return null;
    const row = await db
      .selectFrom('encounters as e')
      .select((eb) => [
        'e.revision',
        'e.data',
        eb
          .selectFrom('import_reports as ir')
          .select('ir.id')
          .whereRef('ir.encounter_id', '=', 'e.id')
          .orderBy('ir.created_at', 'desc')
          .orderBy('ir.id', 'desc')
          .limit(1)
          .as('report_id')
      ])
      .where('e.id', '=', id)
      .where('e.agency_id', '=', runAgency(db, runId))
      .executeTakeFirst();
    return row ? { revision: row.revision, reportId: row.report_id, data: row.data as Json } : null;
  }
});
