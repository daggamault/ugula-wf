import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type Db = Kysely<Database>;

export type SubmissionEvent = {
  claimId: string;
  kind: 'submitted' | 'resubmitted';
  payer: string;
};

const claimColumns = [
  'c.id',
  'c.pcr_number',
  'c.emergency',
  'c.loaded_miles',
  'c.lines',
  'c.total_cents',
  'c.payers',
  'c.coverages',
  'c.details',
  'c.created_at',
  'p.first_name',
  'p.last_name',
  'p.birth_date',
  'p.gender',
  'p.address_line',
  'p.city',
  'p.state',
  'p.postal_code'
] as const;

export const listOpenClaims = (db: Db, tenantId: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .select(claimColumns)
    .where('c.tenant_id', '=', tenantId)
    .where('c.status', '=', 'open')
    .orderBy('c.created_at')
    .orderBy('c.id')
    .execute();

export const lockOpenClaims = (db: Db, tenantId: string, ids: string[]) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .select(claimColumns)
    .where('c.tenant_id', '=', tenantId)
    .where('c.status', '=', 'open')
    .where('c.id', 'in', ids)
    .orderBy('c.created_at')
    .orderBy('c.id')
    .forUpdate('c')
    .execute();

export type OpenClaimRow = Awaited<ReturnType<typeof listOpenClaims>>[number];

export const listLedgerEvents = (db: Db, claimIds: string[]) =>
  claimIds.length
    ? db
        .selectFrom('claim_events')
        .select(['claim_id', 'kind', 'payer', 'paid_cents', 'adjusted_cents', 'created_at'])
        .where('claim_id', 'in', claimIds)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : Promise.resolve([]);

export const listPayerDirectory = (db: Db, tenantId: string) =>
  db
    .selectFrom('payers')
    .select(['name', 'payer_id', 'claim_filing'])
    .where('tenant_id', '=', tenantId)
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
        payer: e.payer,
        note: origin.note,
        batch_id: origin.batchId,
        created_by: origin.createdBy
      }))
    )
    .execute();

export const listBatches = (db: Db, tenantId: string, limit: number) =>
  db
    .selectFrom('claim_batches as b')
    .leftJoin('users as u', 'u.id', 'b.created_by')
    .select([
      'b.id',
      'b.control_number',
      'b.claim_count',
      'b.total_cents',
      'b.production',
      'b.created_at',
      'u.email as created_by_email'
    ])
    .where('b.tenant_id', '=', tenantId)
    .orderBy('b.created_at', 'desc')
    .orderBy('b.id', 'desc')
    .limit(limit)
    .execute();

export const findBatchDocument = async (db: Db, tenantId: string, id: string) =>
  (await db
    .selectFrom('claim_batches')
    .select(['document', 'control_number'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst()) ?? null;
