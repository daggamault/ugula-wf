import type { ClaimStatus } from '@ugula/billing';
import {
  type Address,
  CLAIM_STATUSES,
  CLOSED_CLAIM_STATUSES,
  type Location,
  nameKey,
  payerKey
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { escapeLike } from '../../shared/search.ts';
import type { ClaimSort } from './schemas.ts';

type Db = Kysely<Database>;

export type ClaimFilters = PageRequest<ClaimSort> & {
  status: ClaimStatus | 'open' | 'all';
  firstName?: string | undefined;
  lastName?: string | undefined;
  birthDate?: string | undefined;
  number?: string | undefined;
  patientId?: string | undefined;
};

export type ClaimResponse = {
  requestId: string;
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  note: string;
};

export type CoverageRow = { id: string; payer: string; has_events: boolean };

export const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;

const claimRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
    .select((eb) => [
      'c.id',
      'c.number',
      'p.number as patient_number',
      'c.pcr_number',
      'c.level',
      'c.total_cents',
      'c.service_date',
      'c.status',
      'c.created_at',
      'p.first_name',
      'p.last_name',
      'b.balance_cents',
      sql<string[]>`array(${eb
        .selectFrom('claim_coverages as cc')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select(payerName.as('payer'))
        .whereRef('cc.claim_id', '=', 'c.id')
        .orderBy('cc.position')})`.as('payers')
    ])
    .where('c.tenant_id', '=', tenantId);

const CLAIM_ORDER = {
  created: sql.ref('c.created_at'),
  number: sql.ref('c.number'),
  service: sql.ref('c.service_date'),
  patient: sql`lower(p.last_name || ' ' || p.first_name)`,
  pcr: sql.ref('c.pcr_number'),
  total: sql.ref('c.total_cents'),
  balance: sql.ref('b.balance_cents'),
  status: sql`array_position(array[${sql.join(CLAIM_STATUSES.map((s) => sql.lit(s)))}]::text[], c.status::text)`
};

const MAX_NUMBER = 2_147_483_647;

export const numberOf = (text: string) => {
  const digits = /^#?(\d{1,10})$/.exec(text.trim())?.[1];
  const n = digits === undefined ? null : Number(digits);
  return n !== null && n <= MAX_NUMBER ? n : null;
};

export const listClaims = (db: Db, tenantId: string, f: ClaimFilters) => {
  let q = claimRows(db, tenantId);
  if (f.status === 'open') q = q.where('c.status', 'not in', CLOSED_CLAIM_STATUSES);
  else if (f.status !== 'all') q = q.where('c.status', '=', f.status);
  if (f.patientId) q = q.where('c.patient_id', '=', f.patientId);
  if (f.firstName) {
    q = q.where(sql`lower(p.first_name)`, 'like', `${escapeLike(f.firstName.toLowerCase())}%`);
  }
  const lastName = f.lastName ? nameKey(f.lastName) : '';
  if (lastName) q = q.where('p.last_name_key', 'like', `${escapeLike(lastName)}%`);
  if (f.birthDate) q = q.where('p.birth_date', '=', f.birthDate);
  if (f.number) {
    const text = f.number;
    const n = numberOf(text);
    q = q.where((eb) =>
      eb.or([
        eb('c.pcr_number', '=', text),
        ...(n === null ? [] : [eb('c.number', '=', n), eb('p.number', '=', n)])
      ])
    );
  }
  return paged(q, f, CLAIM_ORDER, sql.ref('c.id'));
};

export const findClaim = (db: Db, tenantId: string, id: string) =>
  claimRows(db, tenantId)
    .leftJoin('workflow_runs as r', 'r.id', 'c.cycle_run_id')
    .select((eb) => [
      'c.emergency',
      'c.loaded_miles',
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
      'c.import_report_id',
      'p.birth_date',
      'c.patient_id',
      'c.cycle_run_id',
      'r.status as cycle_status',
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
            'cc.position',
            payerName.as('payer'),
            'cc.payer_id',
            'cc.payer_code',
            'cc.member_id',
            'cc.group_id'
          ])
          .whereRef('cc.claim_id', '=', 'c.id')
          .orderBy('cc.position')
      ).as('coverages'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_lines as l')
          .select(['l.position', 'l.code', 'l.units', 'l.unit_cents', 'l.total_cents'])
          .whereRef('l.claim_id', '=', 'c.id')
          .orderBy('l.position')
      ).as('lines'),
      sql<string[]>`array(${eb
        .selectFrom('claim_diagnoses as d')
        .select('d.code')
        .whereRef('d.claim_id', '=', 'c.id')
        .orderBy('d.position')})`.as('diagnoses')
    ])
    .where('c.id', '=', id)
    .executeTakeFirst();

export const lockClaim = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('claims')
    .select(['id', 'status', 'patient_id'])
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst();

export const listCoverages = (db: Db, claimId: string): Promise<CoverageRow[]> =>
  db
    .selectFrom('claim_coverages as cc')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .select((eb) => [
      'cc.id',
      payerName.as('payer'),
      sql<boolean>`exists (${eb
        .selectFrom('claim_events as e')
        .select('e.id')
        .whereRef('e.coverage_id', '=', 'cc.id')})`.as('has_events')
    ])
    .where('cc.claim_id', '=', claimId)
    .orderBy('cc.position')
    .execute();

export const claimBalance = async (db: Db, id: string) =>
  (
    await db
      .selectFrom('claim_balances')
      .select('balance_cents')
      .where('claim_id', '=', id)
      .executeTakeFirstOrThrow()
  ).balance_cents;

export type PayerOrder = {
  keep: { id: string; position: number }[];
  add: { payer: string; position: number }[];
  remove: string[];
};

export const reorderCoverages = async (
  db: Db,
  tenantId: string,
  claimId: string,
  order: PayerOrder
) => {
  if (order.remove.length) {
    await db
      .deleteFrom('claim_coverages')
      .where('claim_id', '=', claimId)
      .where('id', 'in', order.remove)
      .execute();
  }
  for (const c of order.keep) {
    await db
      .updateTable('claim_coverages')
      .set({ position: c.position })
      .where('id', '=', c.id)
      .where('claim_id', '=', claimId)
      .execute();
  }
  if (order.add.length) {
    await db
      .insertInto('claim_coverages')
      .values(
        order.add.map((c) => ({
          claim_id: claimId,
          position: c.position,
          payer_name: c.payer,
          payer_id: db
            .selectFrom('payers')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where((eb) =>
              eb.or([
                eb(sql`lower(name)`, '=', c.payer.toLowerCase()),
                eb(
                  'id',
                  'in',
                  eb
                    .selectFrom('payer_aliases')
                    .select('payer_id')
                    .where('tenant_id', '=', tenantId)
                    .where('alias_key', '=', payerKey(c.payer))
                )
              ])
            )
            .orderBy(sql`lower(name) = ${c.payer.toLowerCase()}`, 'desc')
            .limit(1)
        }))
      )
      .execute();
  }
  await db
    .updateTable('claims')
    .set({ updated_at: sql`now()` })
    .where('id', '=', claimId)
    .execute();
};

type BillingDetails = {
  serviceDate: string | null;
  pickup: Location;
  destination: Location;
  diagnoses: string[];
  originDestination: string | null;
};

export const saveBillingData = async (
  db: Db,
  tenantId: string,
  claim: { id: string; patientId: string },
  data: {
    details: BillingDetails;
    coverages: { id: string; memberId: string | null; groupId: string | null }[];
    patient: Address;
  }
) => {
  const { serviceDate, pickup, destination, diagnoses, originDestination } = data.details;
  await db
    .updateTable('claims')
    .set({
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
      updated_at: sql`now()`
    })
    .where('id', '=', claim.id)
    .execute();
  for (const c of data.coverages) {
    await db
      .updateTable('claim_coverages')
      .set({ member_id: c.memberId, group_id: c.groupId })
      .where('id', '=', c.id)
      .where('claim_id', '=', claim.id)
      .execute();
  }
  await db.deleteFrom('claim_diagnoses').where('claim_id', '=', claim.id).execute();
  if (diagnoses.length) {
    await db
      .insertInto('claim_diagnoses')
      .values(diagnoses.map((code, i) => ({ claim_id: claim.id, position: i + 1, code })))
      .execute();
  }
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

export const RECONCILE_QUEUE = 'billing-reconcile';

export const COLLECTIONS_QUEUE = 'billing-collections';

export const resolveMootTasks = (
  db: Db,
  tenantId: string,
  claimId: string,
  moot: { coverageId: string | null; settled: boolean }
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
          eb(sql<string>`context ->> 'coverageId'`, '=', moot.coverageId ?? '')
        ]),
        eb.and([eb('queue', '=', COLLECTIONS_QUEUE), eb.lit(moot.settled)])
      ])
    )
    .returning(['run_id', 'wait_id', sql<string>`resolution ->> 'outcome'`.as('outcome')])
    .execute();

export const listClaimEvents = (db: Db, claimId: string) =>
  db
    .selectFrom('claim_events as e')
    .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .leftJoin('claim_batches as cb', 'cb.id', 'e.batch_id')
    .select([
      'e.id',
      'e.kind',
      'e.batch_id',
      'cb.control_number as batch_number',
      'e.coverage_id',
      sql<string | null>`case when e.coverage_id is null then null else ${payerName} end`.as(
        'payer'
      ),
      'e.paid_cents',
      'e.adjusted_cents',
      'e.note',
      'e.created_at',
      sql<boolean>`e.document is not null`.as('has_document')
    ])
    .where('e.claim_id', '=', claimId)
    .orderBy('e.created_at')
    .orderBy('e.id')
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

export const insertResponse = async (db: Db, claimId: string, userId: string, r: ClaimResponse) =>
  (await db
    .insertInto('claim_events')
    .values({
      claim_id: claimId,
      kind: 'response',
      coverage_id: r.coverageId,
      paid_cents: r.paidCents,
      adjusted_cents: r.adjustedCents,
      note: r.note,
      created_by: userId,
      source_key: r.requestId
    })
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .returning('id')
    .executeTakeFirst()) !== undefined;
