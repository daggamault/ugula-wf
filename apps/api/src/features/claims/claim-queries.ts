import { CLAIM_STATUSES, CLOSED_CLAIM_STATUSES, dailyNumberOf, nameKey } from '@ugula/billing';
import { type Db, DOCUMENTATION_COLUMNS, payerName } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { escapeLike } from '../../shared/search.ts';
import type { ClaimSort } from './schemas.ts';

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

const claimRows = (db: Db, agencyId: string) =>
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
      eb
        .selectFrom('import_reports as er')
        .select('er.number')
        .whereRef('er.id', '=', 'c.import_report_id')
        .as('encounter_number'),
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
    .where('c.agency_id', '=', agencyId);

const claimOrder = (db: Db) => ({
  created: sql.ref('c.created_at'),
  number: sql.ref('c.number'),
  service: sql.ref('c.service_date'),
  patient: sql`lower(p.last_name || ' ' || p.first_name)`,
  pcr: sql.ref('c.pcr_number'),
  encounter: db
    .selectFrom('import_reports as er')
    .select('er.number')
    .where('er.id', '=', sql.ref<string>('c.import_report_id')),
  total: sql.ref('c.total_cents'),
  balance: db
    .selectFrom('claim_balances as b')
    .select('b.balance_cents')
    .where('b.claim_id', '=', sql.ref<string>('c.id')),
  waiting: tasksOfClaim(db).select('t.created_at').limit(sql.lit(1)),
  status: sql`array_position(array[${sql.join(CLAIM_STATUSES.map((s) => sql.lit(s)))}]::text[], c.status::text)`
});

const claimIds = (db: Db, agencyId: string, f: ClaimFilters) => {
  let q = db
    .selectFrom('claims as c')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .leftJoin('import_reports as ir', 'ir.id', 'c.import_report_id')
    .select('c.id')
    .where('c.agency_id', '=', agencyId);
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
    const n = dailyNumberOf(text);
    q = q.where((eb) =>
      eb.or([
        eb('c.pcr_number', '=', text),
        ...(n === null
          ? []
          : [eb('c.number', '=', n), eb('p.number', '=', n), eb('ir.number', '=', n)])
      ])
    );
  }
  return q;
};

export const listClaims = async (db: Db, agencyId: string, f: ClaimFilters) => {
  const page = await paged(claimIds(db, agencyId, f), f, claimOrder(db), sql.ref('c.id'));
  const ids = page.items.map((r) => r.id);
  const rows = ids.length ? await claimRows(db, agencyId).where('c.id', 'in', ids).execute() : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { ...page, items: ids.flatMap((id) => byId.get(id) ?? []) };
};

export const findClaim = (db: Db, agencyId: string, id: string) =>
  claimRows(db, agencyId)
    .leftJoin('workflow_runs as r', 'r.id', 'c.cycle_run_id')
    .leftJoin('import_reports as ir', 'ir.id', 'c.import_report_id')
    .leftJoin('imports as i', 'i.id', 'ir.import_id')
    .leftJoin('facilities as f', 'f.id', 'c.facility_id')
    .select((eb) => [
      'i.id as import_id',
      'c.facility_id',
      'f.name as facility_name',
      'i.file_name as import_file_name',
      'c.classification',
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
      'c.deceased',
      'c.non_covered_miles',
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
            'dp.claim_filing',
            'cc.payer_code',
            'cc.member_id',
            'cc.group_id',
            'cc.relationship',
            'cc.insured_first_name',
            'cc.insured_last_name',
            'cc.eligibility',
            'cc.eligibility_note',
            'cc.eligibility_checked_at',
            'cc.stay_kind',
            'cc.stay_admitted_on',
            'cc.stay_discharged_on'
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
            't.due_at',
            't.created_at'
          ])
          .where('cr.claim_id', '=', sql.ref<string>('c.id'))
      ).as('tasks')
    ])
    .where('c.id', '=', id)
    .executeTakeFirst();

export const claimExists = async (db: Db, agencyId: string, id: string) =>
  (await db
    .selectFrom('claims')
    .select('id')
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .executeTakeFirst()) !== undefined;
