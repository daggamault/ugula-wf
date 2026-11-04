import { CLAIM_STATUSES, CLOSED_CLAIM_STATUSES, nameKey, payerKey } from '@ugula/billing';
import { ACTIVE_RUN_STATUSES, type Db, DOCUMENTATION_COLUMNS, payerName } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { escapeLike } from '../../shared/search.ts';
import type { ClaimEventSort, ClaimSort, PayerEntry } from './schemas.ts';

export type ClaimFilters = PageRequest<ClaimSort> & {
  status: 'open' | 'all';
  firstName?: string | undefined;
  lastName?: string | undefined;
  birthDate?: string | undefined;
  number?: string | undefined;
  patientId?: string | undefined;
};

const claimTasks = (db: Db) =>
  db
    .selectFrom('tasks as t')
    .innerJoin('claim_runs as cr', 'cr.run_id', 't.run_id')
    .leftJoin('users as u', 'u.id', 't.assignee_id')
    .where('t.status', '=', sql.lit('open'))
    .orderBy('t.priority', 'desc')
    .orderBy('t.created_at');

const tasksOfClaim = (db: Db) => claimTasks(db).where('cr.claim_id', '=', sql.ref<string>('c.id'));

const nextTask = (db: Db) =>
  tasksOfClaim(db)
    .select([
      't.id',
      't.title',
      't.queue',
      't.kind',
      't.created_at',
      'u.email',
      sql<number>`(count(*) over ())::int`.as('count')
    ])
    .limit(sql.lit(1))
    .as('t');

const claimRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('claims as c')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
    .leftJoinLateral(nextTask(db), (join) => join.onTrue())
    .select((eb) => [
      't.id as task_id',
      't.title as task_title',
      't.queue as task_queue',
      't.kind as task_kind',
      't.email as task_assignee_email',
      eb.fn.coalesce('t.count', sql<number>`0`).as('open_tasks'),
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

const claimOrder = (db: Db) => ({
  created: sql.ref('c.created_at'),
  number: sql.ref('c.number'),
  service: sql.ref('c.service_date'),
  patient: sql`lower(p.last_name || ' ' || p.first_name)`,
  pcr: sql.ref('c.pcr_number'),
  total: sql.ref('c.total_cents'),
  balance: db
    .selectFrom('claim_balances as b')
    .select('b.balance_cents')
    .where('b.claim_id', '=', sql.ref<string>('c.id')),
  waiting: tasksOfClaim(db).select('t.created_at').limit(sql.lit(1)),
  status: sql`array_position(array[${sql.join(CLAIM_STATUSES.map((s) => sql.lit(s)))}]::text[], c.status::text)`
});

const MAX_NUMBER = 2_147_483_647;

export const numberOf = (text: string) => {
  const digits = /^#?(\d{1,10})$/.exec(text.trim())?.[1];
  const n = digits === undefined ? null : Number(digits);
  return n !== null && n <= MAX_NUMBER ? n : null;
};

const claimIds = (db: Db, tenantId: string, f: ClaimFilters) => {
  let q = db
    .selectFrom('claims as c')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .select('c.id')
    .where('c.tenant_id', '=', tenantId);
  if (f.status === 'open') q = q.where('c.status', 'not in', CLOSED_CLAIM_STATUSES);
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
  return q;
};

export const listClaims = async (db: Db, tenantId: string, f: ClaimFilters) => {
  const page = await paged(claimIds(db, tenantId, f), f, claimOrder(db), sql.ref('c.id'));
  const ids = page.items.map((r) => r.id);
  const rows = ids.length ? await claimRows(db, tenantId).where('c.id', 'in', ids).execute() : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { ...page, items: ids.flatMap((id) => byId.get(id) ?? []) };
};

export const findClaim = (db: Db, tenantId: string, id: string) =>
  claimRows(db, tenantId)
    .leftJoin('workflow_runs as r', 'r.id', 'c.cycle_run_id')
    .leftJoin('import_reports as ir', 'ir.id', 'c.import_report_id')
    .leftJoin('imports as i', 'i.id', 'ir.import_id')
    .select((eb) => [
      'i.id as import_id',
      'i.file_name as import_file_name',
      'c.trip_type',
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
      ...DOCUMENTATION_COLUMNS,
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
            'cc.group_id',
            'cc.relationship',
            'cc.insured_first_name',
            'cc.insured_last_name',
            'cc.eligibility',
            'cc.eligibility_note',
            'cc.eligibility_checked_at'
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
        .orderBy('d.position')})`.as('diagnoses'),
      jsonArrayFrom(
        claimTasks(db)
          .select([
            't.id',
            't.title',
            't.subject',
            't.queue',
            't.kind',
            't.assignee_id',
            'u.email as assignee_email',
            't.created_at'
          ])
          .where('cr.claim_id', '=', sql.ref<string>('c.id'))
      ).as('tasks')
    ])
    .where('c.id', '=', id)
    .executeTakeFirst();

export type PayerOrder = {
  keep: { id: string; position: number }[];
  add: (Omit<PayerEntry, 'name'> & { payer: string; position: number })[];
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
  if (order.keep.length) {
    await sql`
      update claim_coverages cc set position = v.position
      from (values ${sql.join(order.keep.map((c) => sql`(${c.id}::uuid, ${c.position}::smallint)`))})
        as v (id, position)
      where cc.id = v.id and cc.claim_id = ${claimId}`.execute(db);
  }
  if (order.add.length) {
    await db
      .insertInto('claim_coverages')
      .values(
        order.add.map((c) => ({
          claim_id: claimId,
          tenant_id: tenantId,
          position: c.position,
          payer_name: c.payer,
          relationship: c.relationship,
          insured_first_name: c.insuredFirstName,
          insured_last_name: c.insuredLastName,
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

export const hasActiveRun = async (db: Db, claimId: string) =>
  (await db
    .selectFrom('claim_runs as cr')
    .innerJoin('workflow_runs as r', 'r.id', 'cr.run_id')
    .select('r.id')
    .where('cr.claim_id', '=', claimId)
    .where('r.status', 'in', ACTIVE_RUN_STATUSES)
    .limit(1)
    .executeTakeFirst()) !== undefined;

export const setCycleRun = async (db: Db, id: string, runId: string) => {
  await db.insertInto('claim_runs').values({ run_id: runId, claim_id: id }).execute();
  await db
    .updateTable('claims')
    .set({ cycle_run_id: runId, updated_at: sql`now()` })
    .where('id', '=', id)
    .execute();
};

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
          .select(['a.group_code as group', 'a.reason_code as reason', 'a.amount_cents as cents'])
          .whereRef('a.event_id', '=', 'e.id')
          .orderBy('a.position')
      ).as('adjustments')
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

export const claimExists = async (db: Db, tenantId: string, id: string) =>
  (await db
    .selectFrom('claims')
    .select('id')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst()) !== undefined;

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
