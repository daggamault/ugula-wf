import type { Address } from '@ugula/billing';
import type { ClaimStatus, Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type Db = Kysely<Database>;

export type ClaimFilters = {
  status: ClaimStatus;
  limit: number;
};

export type ClaimResponse = {
  requestId: string;
  payer: string | null;
  paidCents: number;
  adjustedCents: number;
  note: string;
};

const balance = sql<number>`(c.total_cents - coalesce((select sum(e.paid_cents + e.adjusted_cents) from claim_events e where e.claim_id = c.id), 0))::int`;

const claimRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .select([
      'c.id',
      'c.pcr_number',
      'c.level',
      'c.total_cents',
      'c.payers',
      'c.status',
      'c.created_at',
      'p.first_name',
      'p.last_name',
      balance.as('balance_cents')
    ])
    .where('c.tenant_id', '=', tenantId);

export const listClaims = (db: Db, tenantId: string, f: ClaimFilters) =>
  claimRows(db, tenantId)
    .where('c.status', '=', f.status)
    .orderBy('c.created_at', 'desc')
    .limit(f.limit)
    .execute();

export const findClaim = (db: Db, tenantId: string, id: string) =>
  claimRows(db, tenantId)
    .leftJoin('workflow_runs as r', 'r.id', 'c.cycle_run_id')
    .select([
      'c.emergency',
      'c.loaded_miles',
      'c.lines',
      'p.birth_date',
      'c.patient_id',
      'c.cycle_run_id',
      'r.status as cycle_status',
      'c.coverages',
      'c.details',
      'p.gender',
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code'
    ])
    .where('c.id', '=', id)
    .executeTakeFirst();

export const lockClaim = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('claims')
    .select(['id', 'status', 'payers', 'patient_id'])
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst();

export const claimBalance = async (db: Db, id: string) =>
  (
    await db
      .selectFrom('claims as c')
      .select(balance.as('balance_cents'))
      .where('c.id', '=', id)
      .executeTakeFirstOrThrow()
  ).balance_cents;

export const saveBillingData = async (
  db: Db,
  tenantId: string,
  claim: { id: string; patientId: string },
  data: { coverages: unknown; details: unknown; patient: Address }
) => {
  await db
    .updateTable('claims')
    .set({
      coverages: JSON.stringify(data.coverages),
      details: JSON.stringify(data.details),
      updated_at: sql`now()`
    })
    .where('id', '=', claim.id)
    .execute();
  await db
    .updateTable('patients')
    .set({
      address_line: data.patient.addressLine,
      city: data.patient.city,
      state: data.patient.state,
      postal_code: data.patient.postalCode,
      updated_at: sql`now()`
    })
    .where('id', '=', claim.patientId)
    .where('tenant_id', '=', tenantId)
    .execute();
};

export const setCycleRun = (db: Db, id: string, runId: string) =>
  db
    .updateTable('claims')
    .set({ cycle_run_id: runId, updated_at: sql`now()` })
    .where('id', '=', id)
    .execute();

export const hasResponse = async (db: Db, claimId: string, requestId: string) =>
  (await db
    .selectFrom('claim_events')
    .select('id')
    .where('claim_id', '=', claimId)
    .where('source_key', '=', requestId)
    .executeTakeFirst()) !== undefined;

export const FOLLOW_UP_QUEUE = 'billing-followup';

export const COLLECTIONS_QUEUE = 'billing-collections';

export const resolveMootTasks = (
  db: Db,
  tenantId: string,
  claimId: string,
  moot: { payer: string | null; settled: boolean }
) =>
  db
    .updateTable('tasks')
    .set({
      status: 'completed',
      completed_at: sql`now()`,
      resolution: sql`jsonb_build_object('outcome', case when queue = ${FOLLOW_UP_QUEUE} then 'keepWaiting' else 'writeOff' end, 'values', '{}'::jsonb, 'resolvedBy', 'claim response')`,
      updated_at: sql`now()`
    })
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'open')
    .where(sql<string>`context ->> 'claimId'`, '=', claimId)
    .where((eb) =>
      eb.or([
        eb.and([
          eb('queue', '=', FOLLOW_UP_QUEUE),
          eb(sql<string>`context ->> 'payer'`, '=', moot.payer ?? '')
        ]),
        eb.and([eb('queue', '=', COLLECTIONS_QUEUE), eb.lit(moot.settled)])
      ])
    )
    .returning(['run_id', 'wait_id', sql<string>`resolution ->> 'outcome'`.as('outcome')])
    .execute();

export const listClaimEvents = (db: Db, claimId: string) =>
  db
    .selectFrom('claim_events')
    .select([
      'id',
      'kind',
      'payer',
      'paid_cents',
      'adjusted_cents',
      'note',
      'created_at',
      sql<boolean>`document is not null`.as('has_document')
    ])
    .where('claim_id', '=', claimId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

export const findEventDocument = async (
  db: Db,
  tenantId: string,
  claimId: string,
  eventId: string
) =>
  (await db
    .selectFrom('claim_events as e')
    .innerJoin('claims as c', 'c.id', 'e.claim_id')
    .select(['e.document', 'e.kind'])
    .where('e.id', '=', eventId)
    .where('c.id', '=', claimId)
    .where('c.tenant_id', '=', tenantId)
    .where('e.document', 'is not', null)
    .executeTakeFirst()) ?? null;

export const updatePayers = async (db: Db, tenantId: string, id: string, payers: string[]) =>
  (await db
    .updateTable('claims')
    .set({ payers, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'open')
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const insertResponse = async (db: Db, claimId: string, userId: string, r: ClaimResponse) =>
  (await db
    .insertInto('claim_events')
    .values({
      claim_id: claimId,
      kind: 'response',
      payer: r.payer,
      paid_cents: r.paidCents,
      adjusted_cents: r.adjustedCents,
      note: r.note,
      created_by: userId,
      source_key: r.requestId
    })
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .returning('id')
    .executeTakeFirst()) !== undefined;
