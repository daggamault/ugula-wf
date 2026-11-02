import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

type Db = Kysely<Database>;

export type SubmissionEvent = {
  claimId: string;
  kind: 'submitted' | 'resubmitted';
  coverageId: string;
};

const openClaims = (db: Db, tenantId: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .select((eb) => [
      'c.id',
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
            'cc.group_id'
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
    .where('c.status', '=', 'ready')
    .orderBy('c.created_at')
    .orderBy('c.id');

export const listReadyClaims = (db: Db, tenantId: string, claimId?: string) => {
  const q = openClaims(db, tenantId);
  return (claimId ? q.where('c.id', '=', claimId) : q).execute();
};

export const lockReadyClaim = (db: Db, tenantId: string, id: string) =>
  openClaims(db, tenantId).where('c.id', '=', id).forUpdate('c').execute();

export type ReadyClaimRow = Awaited<ReturnType<typeof listReadyClaims>>[number];

export const markSubmitted = (db: Db, ids: string[]) =>
  db
    .updateTable('claims')
    .set({ status: 'submitted', updated_at: sql`now()` })
    .where('id', 'in', ids)
    .where('status', '=', 'ready')
    .execute();

export const listLedgerEvents = (db: Db, claimIds: string[]) =>
  claimIds.length
    ? db
        .selectFrom('claim_events')
        .select(['claim_id', 'kind', 'coverage_id', 'paid_cents', 'adjusted_cents', 'created_at'])
        .where('claim_id', 'in', claimIds)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : Promise.resolve([]);

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

export const lockProfile = (db: Db, tenantId: string) =>
  db
    .selectFrom('billing_profiles')
    .select(profileColumns)
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst();

export type ProfileRow = NonNullable<Awaited<ReturnType<typeof findProfile>>>;

export const nextControlNumber = async (db: Db, tenantId: string) =>
  (
    await db
      .selectFrom('claim_batches')
      .select(sql<number>`coalesce(max(control_number), 0)::int + 1`.as('next'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow()
  ).next;

export const insertBatch = (
  db: Db,
  batch: {
    tenantId: string;
    controlNumber: number;
    claimCount: number;
    totalCents: number;
    production: boolean;
    document: unknown;
    createdBy: string;
  }
) =>
  db
    .insertInto('claim_batches')
    .values({
      tenant_id: batch.tenantId,
      control_number: batch.controlNumber,
      claim_count: batch.claimCount,
      total_cents: batch.totalCents,
      production: batch.production,
      document: JSON.stringify(batch.document),
      created_by: batch.createdBy
    })
    .returning(['id', 'control_number', 'claim_count', 'total_cents', 'production', 'created_at'])
    .executeTakeFirstOrThrow();

export const insertSubmissionEvents = (
  db: Db,
  origin: { batchId: string | null; note: string; createdBy: string },
  events: SubmissionEvent[]
) =>
  db
    .insertInto('claim_events')
    .values(
      events.map((e) => ({
        claim_id: e.claimId,
        kind: e.kind,
        coverage_id: e.coverageId,
        note: origin.note,
        batch_id: origin.batchId,
        created_by: origin.createdBy
      }))
    )
    .execute();

export const findBatchDocument = async (db: Db, tenantId: string, id: string) =>
  (await db
    .selectFrom('claim_batches')
    .select(['document', 'control_number'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst()) ?? null;
