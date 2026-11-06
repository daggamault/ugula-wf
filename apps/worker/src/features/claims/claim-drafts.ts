import type { ClaimStore, DraftClaim, NewClaim } from '@ugula/billing';
import { ACTIVE_RUN_STATUSES, type Db, documentationValues, sqlExecutor } from '@ugula/db';
import { cancel, enqueueRuns, type RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';
import { replaceClaimRows } from './claim-coverages.ts';
import { agencyClaim, linkClaimRun } from './claim-scope.ts';

const sourceReport = (db: Db, runId: string, key: string) =>
  db
    .selectFrom('import_reports as r')
    .innerJoin('imports as i', 'i.id', 'r.import_id')
    .select('r.id')
    .where(sql`r.report ->> 'key'`, '=', key)
    .where('i.agency_id', '=', runAgency(db, runId));

const claimValues = (c: NewClaim) => {
  const { serviceDate, pickup, destination, originDestination } = c.details;
  return {
    patient_id: c.patientId,
    pcr_number: c.pcrNumber,
    classification: c.classification,
    level: c.level,
    emergency: c.emergency,
    loaded_miles: c.loadedMiles,
    deceased: c.deceased,
    non_covered_miles: c.nonCoveredMiles,
    total_cents: c.totalCents,
    service_date: serviceDate,
    origin_code: originDestination?.[0] ?? null,
    destination_code: originDestination?.[1] ?? null,
    pickup_address_line: pickup.addressLine,
    pickup_city: pickup.city,
    pickup_state: pickup.state,
    pickup_postal_code: pickup.postalCode,
    destination_name: destination.name,
    destination_address_line: destination.addressLine,
    destination_city: destination.city,
    destination_state: destination.state,
    destination_postal_code: destination.postalCode,
    ...documentationValues(c.details.documentation)
  };
};

const insertDraft = async (db: Db, runId: string, sourceKey: string, d: DraftClaim) =>
  (
    await db
      .insertInto('claims')
      .values({
        agency_id: runAgency(db, runId),
        import_report_id: d.reportKey === null ? null : sourceReport(db, runId, d.reportKey),
        pcr_number: d.pcrNumber,
        source_key: sourceKey
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst()
  )?.id ?? null;

const reopenDraft = async (
  tx: Db,
  boss: RunQueueClient,
  runId: string,
  claimId: string,
  reportKey: string | null
) => {
  const claim = await agencyClaim(tx, runId, claimId);
  const report =
    reportKey === null
      ? null
      : sourceReport(tx, runId, reportKey).where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('claims as o')
                .select('o.id')
                .whereRef('o.import_report_id', '=', 'r.id')
                .where('o.id', '<>', claim.id)
            )
          )
        );
  const { rows } = await sql<{ id: string }>`
    with old as (select cycle_run_id from claims where id = ${claim.id} for update),
    reopened as (
      update claims set
        status = 'draft',
        cycle_run_id = null,
        import_report_id = coalesce(${report ?? sql`null::uuid`}, import_report_id),
        updated_at = now()
      where id = ${claim.id}
    )
    select r.id from workflow_runs r
    where r.id <> ${runId}
      and r.status in (${sql.join(ACTIVE_RUN_STATUSES)})
      and (
        r.id in (select cr.run_id from claim_runs cr where cr.claim_id = ${claim.id})
        or r.id = (select cycle_run_id from old)
      )`.execute(tx);
  await linkClaimRun(tx, runId, claim.id);
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    rows.map((r) => cancel(r.id))
  );
  return claim.id;
};

export const createDraftStore = (
  db: Db,
  boss: RunQueueClient
): Pick<ClaimStore, 'openDraft' | 'assignPatient' | 'saveClaim'> => ({
  openDraft: (runId, sourceKey, d) =>
    db.transaction().execute(async (tx) => {
      if (d.claimId !== null) {
        return {
          id: await reopenDraft(tx, boss, runId, d.claimId, d.reportKey),
          duplicate: false
        };
      }
      const id = await insertDraft(tx, runId, sourceKey, d);
      if (id) {
        await linkClaimRun(tx, runId, id);
        return { id, duplicate: false };
      }
      const existing = await tx
        .selectFrom('claims')
        .select(['id', 'source_key'])
        .where('agency_id', '=', runAgency(tx, runId))
        .where((eb) =>
          eb.or([
            eb('source_key', '=', sourceKey),
            ...(d.pcrNumber ? [eb('pcr_number', '=', d.pcrNumber)] : [])
          ])
        )
        .orderBy(sql`source_key = ${sourceKey}`, 'desc')
        .executeTakeFirstOrThrow();
      await linkClaimRun(tx, runId, existing.id);
      return { id: existing.id, duplicate: existing.source_key !== sourceKey };
    }),

  assignPatient: async (runId, claimId, _sourceKey, patientId) => {
    const claim = await agencyClaim(db, runId, claimId);
    const patient = db
      .selectFrom('patients')
      .select('id')
      .where('id', '=', isUuid(patientId) ? patientId : null)
      .where('agency_id', '=', claim.agency_id);
    const { numUpdatedRows } = await db
      .updateTable('claims')
      .set({ patient_id: patient, updated_at: sql`now()` })
      .where('id', '=', claim.id)
      .where((eb) =>
        eb.and([
          eb.exists(patient),
          eb.or([eb('status', '=', 'draft'), eb('patient_id', '=', patient)])
        ])
      )
      .executeTakeFirst();
    if (!numUpdatedRows) {
      throw new Error(`Patient ${patientId} does not exist or claim ${claimId} is not a draft`);
    }
  },

  saveClaim: async (runId, claimId, _sourceKey, c) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db.transaction().execute(async (tx) => {
      const { numUpdatedRows } = await tx
        .updateTable('claims')
        .set({ ...claimValues(c), updated_at: sql`now()` })
        .where('id', '=', claim.id)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (numUpdatedRows) await replaceClaimRows(tx, runId, claim.id, c);
    });
  }
});
