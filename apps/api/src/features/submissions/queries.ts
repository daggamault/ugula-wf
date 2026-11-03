import { MAX_CONTROL_NUMBER } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

type Db = Kysely<Database>;

export type SubmissionEvent = {
  claimId: string;
  kind: 'submitted' | 'resubmitted';
  coverageId: string;
};

const readyClaim = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .select((eb) => [
      'c.id',
      'c.number',
      'c.pcr_number',
      'c.emergency',
      'c.loaded_miles',
      'c.total_cents',
      'c.service_date',
      'c.origin_code',
      'c.destination_code',
      'c.pickup_address_line',
      'c.pickup_city',
      'c.pickup_state',
      'c.pickup_postal_code',
      'c.destination_name',
      'c.destination_address_line',
      'c.destination_city',
      'c.destination_state',
      'c.destination_postal_code',
      'c.created_at',
      'p.first_name',
      'p.last_name',
      'p.birth_date',
      'p.gender',
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code',
      jsonArrayFrom(
        eb
          .selectFrom('claim_coverages as cc')
          .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
          .select([
            'cc.id',
            sql<string>`coalesce(dp.name, cc.payer_name)`.as('payer'),
            'dp.payer_id',
            'dp.claim_filing',
            'cc.member_id',
            'cc.group_id',
            sql<string>`cc.relationship`.as('relationship'),
            'cc.insured_first_name',
            'cc.insured_last_name'
          ])
          .whereRef('cc.claim_id', '=', 'c.id')
          .orderBy('cc.position')
      ).as('coverages'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_lines as l')
          .select(['l.code', 'l.units', 'l.unit_cents', 'l.total_cents'])
          .whereRef('l.claim_id', '=', 'c.id')
          .orderBy('l.position')
      ).as('lines'),
      sql<string[]>`array(${eb
        .selectFrom('claim_diagnoses as d')
        .select('d.code')
        .whereRef('d.claim_id', '=', 'c.id')
        .orderBy('d.position')})`.as('diagnoses')
    ])
    .where('c.tenant_id', '=', tenantId)
    .where('c.id', '=', id)
    .where('c.status', '=', 'ready');

export const findReadyClaim = (db: Db, tenantId: string, id: string) =>
  readyClaim(db, tenantId, id).executeTakeFirst();

export const lockReadyClaim = (db: Db, tenantId: string, id: string) =>
  readyClaim(db, tenantId, id).forUpdate('c').executeTakeFirst();

export type ReadyClaimRow = NonNullable<Awaited<ReturnType<typeof findReadyClaim>>>;

export const markSubmitted = (db: Db, id: string) =>
  db
    .updateTable('claims')
    .set({ status: 'submitted', updated_at: sql`now()` })
    .where('id', '=', id)
    .where('status', '=', 'ready')
    .execute();

const profileColumns = [
  'organization_name',
  'npi',
  'tax_id',
  'address_line',
  'city',
  'state',
  'postal_code',
  'phone',
  'submitter_id',
  'receiver_id',
  'receiver_name',
  'production'
] as const;

export const findProfile = (db: Db, tenantId: string) =>
  db
    .selectFrom('billing_profiles')
    .select(profileColumns)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

export type ProfileRow = NonNullable<Awaited<ReturnType<typeof findProfile>>>;

export const allocateControlNumber = async (db: Db, tenantId: string) =>
  (
    await db
      .updateTable('billing_profiles')
      .set({ next_control_number: sql`next_control_number + 1` })
      .where('tenant_id', '=', tenantId)
      .where('next_control_number', '<=', MAX_CONTROL_NUMBER)
      .returning(sql<number>`next_control_number - 1`.as('control_number'))
      .executeTakeFirst()
  )?.control_number ?? null;

export const insertBatch = (
  db: Db,
  batch: {
    id: string;
    tenantId: string;
    controlNumber: number;
    totalCents: number;
    production: boolean;
    document: unknown;
    createdBy: string;
  }
) =>
  db
    .insertInto('claim_batches')
    .values({
      id: batch.id,
      tenant_id: batch.tenantId,
      control_number: batch.controlNumber,
      claim_count: 1,
      total_cents: batch.totalCents,
      production: batch.production,
      document: JSON.stringify(batch.document),
      created_by: batch.createdBy
    })
    .returning(['id', 'control_number', 'claim_count', 'total_cents', 'production', 'created_at'])
    .executeTakeFirstOrThrow();

export const insertSubmissionEvent = (
  db: Db,
  origin: { batchId: string | null; note: string; createdBy: string },
  e: SubmissionEvent
) =>
  db
    .insertInto('claim_events')
    .values({
      claim_id: e.claimId,
      kind: e.kind,
      coverage_id: e.coverageId,
      note: origin.note,
      batch_id: origin.batchId,
      created_by: origin.createdBy
    })
    .execute();

export const findBatchDocument = async (db: Db, tenantId: string, id: string) =>
  (await db
    .selectFrom('claim_batches')
    .select(['document', 'control_number'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst()) ?? null;
