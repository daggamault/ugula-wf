import { type Db, payerName } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { type PageRequest, paged } from '../../shared/paging.ts';
import type { ClaimEventSort } from './schemas.ts';

const claimEvents = (db: Db, claimId: string) =>
  db.selectFrom('claim_events as e').where('e.claim_id', '=', claimId);

const eventPayer = sql<
  string | null
>`case when e.coverage_id is null then null else ${payerName} end`;

const EVENT_ORDER = {
  when: sql.ref('e.created_at'),
  event: sql`e.kind::text`,
  payer: sql`lower(${eventPayer})`,
  amount: sql`e.paid_cents + e.adjusted_cents`
};

const eventRows = (db: Db, claimId: string) =>
  claimEvents(db, claimId)
    .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .leftJoin('claim_batches as cb', 'cb.id', 'e.batch_id')
    .select((eb) => [
      'e.id',
      'e.kind',
      'e.batch_id',
      'cb.control_number as batch_number',
      'cb.sent_at as batch_sent_at',
      'e.coverage_id',
      eventPayer.as('payer'),
      'e.paid_cents',
      'e.adjusted_cents',
      'e.paid_on',
      'e.check_number',
      'e.payer_claim_number',
      'e.note',
      'e.created_at',
      sql<boolean>`e.document is not null`.as('has_document'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_event_adjustments as a')
          .leftJoin('codes as d', (j) =>
            j.on('d.code_set', '=', 'carc').onRef('d.code', '=', 'a.reason_code')
          )
          .select([
            'a.group_code as group',
            'a.reason_code as reason',
            'a.amount_cents as cents',
            'd.description'
          ])
          .whereRef('a.event_id', '=', 'e.id')
          .orderBy('a.position')
      ).as('adjustments'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_event_remarks as r')
          .leftJoin('codes as d', (j) =>
            j.on('d.code_set', '=', 'rarc').onRef('d.code', '=', 'r.code')
          )
          .select(['r.code', 'd.description'])
          .whereRef('r.event_id', '=', 'e.id')
          .orderBy('r.position')
      ).as('remarks')
    ]);

export const listClaimEvents = (db: Db, claimId: string, page: PageRequest<ClaimEventSort>) =>
  paged(eventRows(db, claimId), page, EVENT_ORDER, sql.ref('e.id'));

export const listClaimFiles = (db: Db, claimId: string) =>
  eventRows(db, claimId)
    .where((eb) => eb.or([eb('e.batch_id', 'is not', null), eb('e.document', 'is not', null)]))
    .orderBy('e.created_at')
    .orderBy('e.id')
    .execute();

export const listClaimPayerFiles = (db: Db, claimId: string) =>
  db
    .selectFrom('payer_files as f')
    .select((eb) => [
      'f.id',
      'f.kind',
      'f.file_name',
      'f.created_at',
      jsonArrayFrom(
        eb
          .selectFrom('payer_file_items as fi')
          .select(['fi.outcome', 'fi.message'])
          .whereRef('fi.file_id', '=', 'f.id')
          .where('fi.claim_id', '=', claimId)
          .orderBy('fi.position')
      ).as('items')
    ])
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('payer_file_items as fi')
          .select('fi.id')
          .whereRef('fi.file_id', '=', 'f.id')
          .where('fi.claim_id', '=', claimId)
      )
    )
    .orderBy('f.created_at')
    .orderBy('f.id')
    .execute();

export const findEventDocument = async (
  db: Db,
  agencyId: string,
  claimId: string,
  eventId: string
) =>
  (await db
    .selectFrom('claim_events as e')
    .innerJoin('claims as c', 'c.id', 'e.claim_id')
    .select(['e.document', 'e.kind'])
    .where('e.id', '=', eventId)
    .where('c.id', '=', claimId)
    .where('c.agency_id', '=', agencyId)
    .where('e.document', 'is not', null)
    .executeTakeFirst()) ?? null;
