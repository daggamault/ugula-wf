import { type Adjustment, type ClaimStore, claimSignalKey } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';
import { agencyClaim, payerName } from './claim-scope.ts';

const adjustmentsOf = sql<Adjustment[]>`coalesce((
  select json_agg(json_build_object('group', a.group_code, 'reason', a.reason_code, 'cents', a.amount_cents) order by a.position)
  from claim_event_adjustments a where a.event_id = e.id
), '[]'::json)`;

export const createLedgerStore = (
  db: Db
): Pick<ClaimStore, 'ledger' | 'recordEvent' | 'noteRevision' | 'claimDocument'> => ({
  noteRevision: async (runId, claimId, sourceKey, report) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db
      .insertInto('claim_events')
      .values({
        claim_id: claim.id,
        kind: 'revised',
        note: 'An updated patient care report arrived',
        document: JSON.stringify(report),
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
    const row = await db
      .selectFrom('claims as c')
      .leftJoin('import_reports as r', 'r.id', 'c.import_report_id')
      .select([
        'c.status',
        sql<string | null>`r.report ->> 'bucket'`.as('bucket'),
        sql<string | null>`r.report ->> 'key'`.as('key')
      ])
      .where('c.id', '=', claim.id)
      .executeTakeFirstOrThrow();
    return {
      status: row.status,
      previous: row.bucket && row.key ? { bucket: row.bucket, key: row.key } : null
    };
  },

  ledger: async (runId, claimId) => {
    const claim = isUuid(claimId)
      ? await db
          .selectFrom('claims as c')
          .leftJoin('patients as p', 'p.id', 'c.patient_id')
          .select((eb) => [
            'c.id',
            'c.total_cents',
            'c.pcr_number',
            'c.facility_id',
            'c.service_date',
            'c.pickup_state',
            'p.first_name',
            'p.last_name',
            eb
              .selectFrom('signals as s')
              .select('s.received')
              .whereRef('s.agency_id', '=', 'c.agency_id')
              .where('s.key', '=', claimSignalKey(claimId))
              .as('received')
          ])
          .where('c.id', '=', claimId)
          .where('c.agency_id', '=', runAgency(db, runId))
          .executeTakeFirst()
      : undefined;
    if (!claim) return null;
    const patient = claim.first_name === null ? null : `${claim.first_name} ${claim.last_name}`;
    const [coverages, events] = await Promise.all([
      db
        .selectFrom('claim_coverages as cc')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select([
          'cc.id',
          payerName.as('payer'),
          'dp.claim_filing as claimFiling',
          'dp.correction_method as correctionMethod',
          'dp.appeal_days as appealDays',
          'dp.plan_type as planType'
        ])
        .where('cc.claim_id', '=', claim.id)
        .orderBy('cc.position')
        .execute(),
      db
        .selectFrom('claim_events as e')
        .select([
          'e.kind',
          'e.coverage_id',
          'e.paid_cents',
          'e.adjusted_cents',
          'e.payer_claim_number',
          'e.paid_on',
          'e.note',
          'e.route',
          adjustmentsOf.as('adjustments'),
          'e.created_at'
        ])
        .where('e.claim_id', '=', claim.id)
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute()
    ]);
    return {
      totalCents: claim.total_cents,
      facilityId: claim.facility_id,
      serviceDate: claim.service_date,
      pickupState: claim.pickup_state,
      signalsSeen: claim.received ?? 0,
      reference: [claim.pcr_number, patient].filter(Boolean).join(' · '),
      coverages,
      events: events.map((e) => ({
        kind: e.kind,
        coverageId: e.coverage_id,
        paidCents: e.paid_cents,
        adjustedCents: e.adjusted_cents,
        payerClaimNumber: e.payer_claim_number,
        paidOn: e.paid_on,
        adjustments: e.adjustments,
        note: e.note,
        route: e.route,
        at: new Date(e.created_at).toISOString()
      }))
    };
  },

  recordEvent: async (runId, claimId, sourceKey, e) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db
      .insertInto('claim_events')
      .values({
        claim_id: claim.id,
        kind: e.kind,
        coverage_id: e.coverageId,
        note: e.note,
        payer_claim_number: e.coverageId === null ? null : e.payerClaimNumber,
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  },

  claimDocument: async (runId, claimId, documentId) => {
    const claim = await agencyClaim(db, runId, claimId);
    const row = isUuid(documentId)
      ? await db
          .selectFrom('claim_documents')
          .select(['id', 'kind', 'signed_on', 'file_name'])
          .where('id', '=', documentId)
          .where('claim_id', '=', claim.id)
          .executeTakeFirst()
      : undefined;
    return row
      ? { id: row.id, kind: row.kind, signedOn: row.signed_on, fileName: row.file_name }
      : null;
  }
});
