import { createHash } from 'node:crypto';
import {
  type ClaimEventKind,
  fieldSections,
  HCPCS_LABELS,
  money,
  type RecoveryStore,
  SELF
} from '@ugula/billing';
import {
  claimBalance,
  type Db,
  findProfile,
  lockClaim,
  nudgeClaim,
  postClaimResponse,
  unchangeable
} from '@ugula/db';
import { toPcr } from '@ugula/nemsis';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'putBytes' | 'getBytes' | 'getJson'>;

const PDF = 'application/pdf';

const OWN_DOCUMENTS: readonly ClaimEventKind[] = [
  'statement',
  'appeal_packet',
  'facility_invoiced',
  'revised'
];

const ANSWERED: readonly ClaimEventKind[] = ['response', 'payer_skipped'];

export const appealPacketKey = (agencyId: string, claimId: string, sourceKey: string) =>
  `appeals/${agencyId}/${claimId}/${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}.pdf`;

const isBlobRef = (x: unknown): x is BlobRef =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as BlobRef).bucket === 'string' &&
  typeof (x as BlobRef).key === 'string';

export const createRecoveryStore = (db: Db, blobs: Blobs, boss: RunQueueClient): RecoveryStore => {
  const claimOf = async (runId: string, claimId: string) =>
    (isUuid(claimId)
      ? await db
          .selectFrom('claims')
          .select(['id', 'agency_id'])
          .where('id', '=', claimId)
          .where('agency_id', '=', runAgency(db, runId))
          .executeTakeFirst()
      : undefined) ?? Promise.reject(new Error(`Claim ${claimId} does not exist`));

  return {
    recordRefund: async (runId, claimId, sourceKey, refund) => {
      const claim = await claimOf(runId, claimId);
      const posted = await db.transaction().execute((tx) =>
        postClaimResponse(tx, boss, claim.agency_id, claim.id, null, {
          requestId: sourceKey,
          kind: 'refunded',
          coverageId: refund.coverageId,
          paidCents: refund.cents,
          adjustedCents: 0,
          paidOn: refund.paidOn,
          checkNumber: null,
          payerClaimNumber: null,
          adjustments: [],
          note: refund.note
        })
      );
      if (!posted.ok) throw new Error(posted.failure.message);
    },

    protectBalance: async (runId, claimId, sourceKey, { adjustedCents, note }) => {
      const claim = await claimOf(runId, claimId);
      await db.transaction().execute(async (tx) => {
        const locked = await lockClaim(tx, claim.agency_id, claim.id);
        if (!locked) throw new Error(`Claim ${claimId} does not exist`);
        const recorded = await tx
          .selectFrom('claim_events')
          .select('id')
          .where('claim_id', '=', claim.id)
          .where('source_key', '=', sourceKey)
          .executeTakeFirst();
        if (recorded) return;
        const blocked = unchangeable(locked.status);
        if (blocked) throw new Error(blocked.failure.message);
        const cents = Math.min(adjustedCents, Math.max(await claimBalance(tx, claim.id), 0));
        if (cents <= 0) return;
        await tx
          .insertInto('claim_events')
          .values({
            claim_id: claim.id,
            kind: 'balance_protected',
            adjusted_cents: cents,
            note,
            source_key: sourceKey
          })
          .execute();
        await nudgeClaim(tx, boss, claim.agency_id, claim.id);
      });
    },

    skipRemainingPayers: (runId, claimId, sourceKey, note) =>
      db.transaction().execute(async (tx) => {
        const claim = await claimOf(runId, claimId);
        const { numInsertedOrUpdatedRows } = await tx
          .insertInto('claim_events')
          .columns(['claim_id', 'kind', 'coverage_id', 'note', 'source_key'])
          .expression(
            tx
              .selectFrom('claim_coverages as cc')
              .select([
                'cc.claim_id',
                sql<ClaimEventKind>`'payer_skipped'`.as('kind'),
                'cc.id',
                sql<string>`${note}`.as('note'),
                sql<string>`${sourceKey} || ':' || cc.id`.as('source_key')
              ])
              .where('cc.claim_id', '=', claim.id)
              .where(({ not, exists, selectFrom }) =>
                not(
                  exists(
                    selectFrom('claim_events as e')
                      .select('e.id')
                      .whereRef('e.coverage_id', '=', 'cc.id')
                      .where('e.kind', 'in', ANSWERED)
                  )
                )
              )
          )
          .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
          .executeTakeFirst();
        if (numInsertedOrUpdatedRows) await nudgeClaim(tx, boss, claim.agency_id, claim.id);
      }),

    addPayer: async (runId, claimId, { payerId, memberId }) => {
      const claim = await claimOf(runId, claimId);
      const payer = isUuid(payerId)
        ? await db
            .selectFrom('payers')
            .select('id')
            .where('id', '=', payerId)
            .where('agency_id', '=', claim.agency_id)
            .executeTakeFirst()
        : undefined;
      if (!payer) throw new Error(`Payer ${payerId} is not in the directory`);
      await db
        .insertInto('claim_coverages')
        .columns([
          'agency_id',
          'claim_id',
          'position',
          'payer_name',
          'payer_id',
          'member_id',
          'relationship'
        ])
        .expression(
          db
            .selectFrom('payers as p')
            .select([
              'p.agency_id',
              sql<string>`${claim.id}::uuid`.as('claim_id'),
              sql<number>`(select coalesce(max(position), 0) + 1 from claim_coverages where claim_id = ${claim.id})`.as(
                'position'
              ),
              'p.name',
              'p.id',
              sql<string | null>`${memberId}::text`.as('member_id'),
              sql<string>`${SELF}::text`.as('relationship')
            ])
            .where('p.id', '=', payerId)
            .where('p.agency_id', '=', claim.agency_id)
        )
        .onConflict((oc) =>
          oc
            .expression(sql`claim_id, lower(payer_name), lower(coalesce(member_id, ''))`)
            .doNothing()
        )
        .execute();
    },

    appealPacket: async (runId, claimId, coverageId) => {
      const claim = await claimOf(runId, claimId);
      const [profile, row, lines, diagnoses, documents] = await Promise.all([
        findProfile(db, claim.agency_id),
        db
          .selectFrom('claims as c')
          .leftJoin('patients as p', 'p.id', 'c.patient_id')
          .leftJoin('import_reports as r', 'r.id', 'c.import_report_id')
          .innerJoin('claim_coverages as cc', (j) =>
            j
              .onRef('cc.claim_id', '=', 'c.id')
              .on('cc.id', '=', isUuid(coverageId) ? coverageId : null)
          )
          .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
          .select([
            'c.number',
            'c.pcr_number',
            'c.service_date',
            'c.level',
            'c.emergency',
            'c.loaded_miles',
            'c.total_cents',
            'c.transport_reason',
            'c.signature',
            'c.pcs_signed_on',
            'p.first_name',
            'p.last_name',
            'p.birth_date',
            'cc.member_id',
            sql<string>`coalesce(dp.name, cc.payer_name)`.as('payer'),
            sql<string | null>`r.report ->> 'bucket'`.as('bucket'),
            sql<string | null>`r.report ->> 'key'`.as('key')
          ])
          .where('c.id', '=', claim.id)
          .executeTakeFirst(),
        db
          .selectFrom('claim_lines')
          .select(['code', 'units', 'total_cents'])
          .where('claim_id', '=', claim.id)
          .orderBy('position')
          .execute(),
        db
          .selectFrom('claim_diagnoses')
          .select('code')
          .where('claim_id', '=', claim.id)
          .orderBy('position')
          .execute(),
        db
          .selectFrom('claim_events')
          .select(['document', 'created_at'])
          .where('claim_id', '=', claim.id)
          .where('document', 'is not', null)
          .where('kind', 'not in', OWN_DOCUMENTS)
          .where(sql<string>`document ->> 'key'`, 'like', '%.pdf')
          .unionAll(
            db
              .selectFrom('claim_documents')
              .select(['document', 'created_at'])
              .where('claim_id', '=', claim.id)
              .where(sql<string>`document ->> 'contentType'`, '=', PDF)
          )
          .orderBy('created_at')
          .execute()
      ]);
      if (!row) throw new Error(`Payer ${coverageId} is not on claim ${claimId}`);
      if (!profile) throw new Error('Add the billing profile in Settings to build appeal packets');
      const report =
        row.bucket && row.key ? await blobs.getJson({ bucket: row.bucket, key: row.key }) : null;
      const attachments = await Promise.all(
        documents.flatMap((d) => (isBlobRef(d.document) ? [blobs.getBytes(d.document)] : []))
      );
      return {
        agency: {
          name: profile.organization_name,
          addressLine: profile.address_line,
          city: profile.city,
          state: profile.state,
          postalCode: profile.postal_code,
          phone: profile.phone
        },
        payer: row.payer,
        claim: [
          { label: 'Claim', value: `#${row.number}` },
          { label: 'PCR', value: row.pcr_number ?? '' },
          { label: 'Patient', value: [row.first_name, row.last_name].filter(Boolean).join(' ') },
          { label: 'Birth date', value: row.birth_date ?? '' },
          { label: 'Member ID', value: row.member_id ?? '' },
          { label: 'Date of service', value: row.service_date ?? '' },
          {
            label: 'Service',
            value: `${row.level ?? ''}${row.emergency ? ' emergency' : ''}`
          },
          { label: 'Loaded miles', value: row.loaded_miles ?? '' },
          { label: 'Transport reason', value: row.transport_reason ?? '' },
          { label: 'Billing signature', value: row.signature },
          { label: 'Certification signed', value: row.pcs_signed_on ?? '' },
          { label: 'Diagnoses', value: diagnoses.map((d) => d.code).join(', ') },
          ...lines.map((l) => ({
            label: l.code,
            value: `${HCPCS_LABELS[l.code] ?? 'Ambulance service'}, ${Number(l.units)} units, ${money(l.total_cents)}`
          })),
          { label: 'Total charges', value: money(row.total_cents) }
        ].filter((r) => r.value !== ''),
        report: report === null ? [] : fieldSections(toPcr(report)),
        attachments
      };
    },

    saveAppealPacket: async (runId, claimId, sourceKey, { coverageId, note, pdf }) => {
      const claim = await claimOf(runId, claimId);
      const document = await blobs.putBytes(
        appealPacketKey(claim.agency_id, claim.id, sourceKey),
        pdf,
        PDF
      );
      await db
        .insertInto('claim_events')
        .values({
          claim_id: claim.id,
          kind: 'appeal_packet',
          coverage_id: coverageId,
          note,
          document: JSON.stringify(document),
          source_key: sourceKey
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
    }
  };
};
