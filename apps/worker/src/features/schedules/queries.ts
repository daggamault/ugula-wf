import { createHash } from 'node:crypto';
import {
  type CalendarStore,
  CLOSED_CLAIM_STATUSES,
  type Deadline,
  type FacilityInvoiceSource,
  money,
  type ScheduleStore
} from '@ugula/billing';
import { agencyTimeZone, agencyToday, type Db, findProfile } from '@ugula/db';
import type { BlobStore } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'putBytes'>;

const WINDOW_DAYS = 90;

const PCS_DAYS = 60;

const TASK_DEADLINES = {
  'billing.appeal-claim': 'appeal',
  'billing.respond-records-request': 'records',
  'billing.refund-overpayment': 'refund'
} as const;

const REMINDER_WORKFLOW = 'billing.deadline-reminder';

const OPEN_EXCLUDED = sql.join([...CLOSED_CLAIM_STATUSES, 'draft'].map((s) => sql.lit(s)));

const reference = sql<string>`concat_ws(' · ', c.number, c.pcr_number, nullif(concat_ws(' ', p.first_name, p.last_name), ''))`;

const taskKind = sql<string>`case g.key ${sql.join(
  Object.entries(TASK_DEADLINES).map(([key, kind]) => sql`when ${key} then ${kind}`),
  sql` `
)} else 'task' end`;

type DeadlineRow = {
  kind: string;
  claim_id: string;
  coverage_id: string | null;
  reference: string;
  due_on: string;
  days_left: number;
  task_id: string | null;
  priority: number;
  reminded: boolean;
};

export const invoiceKey = (agencyId: string, facilityId: string, sourceKey: string) =>
  `facility-invoices/${agencyId}/${facilityId}/${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}.pdf`;

const addressOf = (f: {
  name: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}) =>
  [
    f.name,
    f.address_line ?? '',
    [[f.city, f.state].filter(Boolean).join(', '), f.postal_code].filter(Boolean).join(' ')
  ].filter((l) => l.trim());

export const createScheduleStore = (db: Db, blobs: Blobs): ScheduleStore => ({
  deadlines: async (runId, today) => {
    const { rows } = await sql<DeadlineRow>`
      with agency as (
        select r.agency_id, ${agencyTimeZone(sql.ref('r.agency_id'))} as zone
        from workflow_runs r where r.id = ${runId}
      ),
      filing as (
        select 'timelyFiling' as kind, c.id as claim_id, cc.id as coverage_id, ${reference} as reference,
          (c.service_date + coalesce(dp.filing_limit_days, case when dp.claim_filing in ('MA', 'MB', 'CH') then 365 end))::date as due_on,
          null::uuid as task_id, 0 as priority
        from claims c
        join agency a on a.agency_id = c.agency_id
        join lateral (
          select x.id, x.payer_id from claim_coverages x
          where x.claim_id = c.id and not exists (
            select 1 from claim_events e where e.coverage_id = x.id and e.kind in ('response', 'payer_skipped')
          )
          order by x.position limit 1
        ) cc on true
        left join payers dp on dp.id = cc.payer_id
        left join patients p on p.id = c.patient_id
        where c.status in ('needs_review', 'ready') and c.service_date is not null
          and not exists (
            select 1 from claim_events e where e.coverage_id = cc.id and e.kind in ('submitted', 'resubmitted')
          )
      ),
      due as (
        select ${taskKind} as kind, c.id as claim_id, null::uuid as coverage_id, ${reference} as reference,
          (t.due_at at time zone a.zone)::date as due_on, t.id as task_id, t.priority
        from tasks t
        join agency a on a.agency_id = t.agency_id
        join claim_runs cr on cr.run_id = t.run_id
        join claims c on c.id = cr.claim_id
        left join patients p on p.id = c.patient_id
        join workflow_runs r on r.id = t.run_id
        join graph_versions v on v.id = r.graph_version_id
        join graphs g on g.id = v.graph_id
        where t.status = 'open' and t.due_at is not null and g.key <> ${REMINDER_WORKFLOW}
      ),
      pcs as (
        select distinct on (c.patient_id) 'pcs' as kind, c.id as claim_id, null::uuid as coverage_id,
          ${reference} as reference, (c.pcs_signed_on + ${PCS_DAYS}::int)::date as due_on, null::uuid as task_id, 0 as priority
        from claims c
        join agency a on a.agency_id = c.agency_id
        left join patients p on p.id = c.patient_id
        where c.trip_type = 'scheduled' and c.pcs_signed_on is not null and c.patient_id is not null
          and c.service_date >= ${today}::date - ${PCS_DAYS}::int
        order by c.patient_id, c.service_date desc, c.number desc
      )
      select d.kind, d.claim_id, d.coverage_id, d.reference, d.due_on::text as due_on,
        (d.due_on - ${today}::date)::int as days_left, d.task_id, d.priority,
        exists (
          select 1 from tasks t
          join claim_runs cr on cr.run_id = t.run_id
          join workflow_runs r on r.id = t.run_id
          join graph_versions v on v.id = r.graph_version_id
          join graphs g on g.id = v.graph_id
          where cr.claim_id = d.claim_id and t.status = 'open' and g.key = ${REMINDER_WORKFLOW}
            and r.inputs ->> 'kind' = d.kind
        ) as reminded
      from (
        select kind, claim_id, coverage_id, reference, due_on, task_id, priority from filing
        union all select kind, claim_id, coverage_id, reference, due_on, task_id, priority from due
        union all select kind, claim_id, coverage_id, reference, due_on, task_id, priority from pcs
      ) d
      where d.due_on is not null and d.due_on - ${today}::date <= ${WINDOW_DAYS}::int
      order by d.due_on, d.kind, d.claim_id`.execute(db);
    return rows.map(
      (r): Deadline => ({
        kind: r.kind,
        claimId: r.claim_id,
        coverageId: r.coverage_id,
        reference: r.reference,
        dueOn: r.due_on,
        daysLeft: r.days_left,
        taskId: r.task_id,
        priority: r.priority,
        reminded: r.reminded
      })
    );
  },

  raiseTask: async (runId, taskId, priority) => {
    if (!isUuid(taskId)) throw new Error(`Task ${taskId} does not exist`);
    await db
      .updateTable('tasks')
      .set({ priority, updated_at: sql`now()` })
      .where('id', '=', taskId)
      .where('agency_id', '=', runAgency(db, runId))
      .where('status', '=', 'open')
      .where('priority', '<', priority)
      .execute();
  },

  facilityInvoices: async (runId, period) => {
    const agency = await runAgency(db, runId).executeTakeFirstOrThrow();
    const [profile, rows] = await Promise.all([
      findProfile(db, agency.agency_id),
      db
        .selectFrom('claims as c')
        .innerJoin('facilities as f', 'f.id', 'c.facility_id')
        .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
        .leftJoin('patients as p', 'p.id', 'c.patient_id')
        .select([
          'f.id as facility_id',
          'f.name',
          'f.address_line',
          'f.city',
          'f.state',
          'f.postal_code',
          'c.id',
          'c.number',
          'c.pcr_number',
          'c.service_date',
          'c.total_cents',
          'b.balance_cents',
          'p.first_name',
          'p.last_name'
        ])
        .where('c.agency_id', '=', agency.agency_id)
        .where(sql<boolean>`c.status not in (${OPEN_EXCLUDED})`)
        .where('b.balance_cents', '>', 0)
        .where(sql<boolean>`c.service_date < ${period}::date + interval '1 month'`)
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('facility_invoice_claims as l')
                .select('l.claim_id')
                .whereRef('l.facility_id', '=', 'f.id')
                .whereRef('l.claim_id', '=', 'c.id')
            )
          )
        )
        .orderBy('f.name')
        .orderBy('c.service_date')
        .orderBy('c.number')
        .execute()
    ]);
    if (!rows.length) return [];
    if (!profile) throw new Error('Add the billing profile in Settings to issue facility invoices');
    const letterhead = {
      name: profile.organization_name,
      addressLine: profile.address_line,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postal_code,
      phone: profile.phone
    };
    return [...Map.groupBy(rows, (r) => r.facility_id).values()].flatMap(
      (claims): FacilityInvoiceSource[] => {
        const [first] = claims;
        return first
          ? [
              {
                facilityId: first.facility_id,
                agency: letterhead,
                facility: addressOf(first),
                period,
                claims: claims.map((c) => ({
                  claimId: c.id,
                  number: c.number,
                  pcrNumber: c.pcr_number,
                  patient: [c.last_name, c.first_name].filter(Boolean).join(', '),
                  serviceDate: c.service_date,
                  chargeCents: c.total_cents,
                  balanceCents: c.balance_cents
                }))
              }
            ]
          : [];
      }
    );
  },

  saveFacilityInvoice: async (runId, sourceKey, { source, pdf, totalCents }) => {
    const agency = await runAgency(db, runId).executeTakeFirstOrThrow();
    const document = await blobs.putBytes(
      invoiceKey(agency.agency_id, source.facilityId, sourceKey),
      pdf,
      'application/pdf'
    );
    const claimIds = source.claims.map((c) => c.claimId);
    await db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('facilities')
        .select('id')
        .where('agency_id', '=', agency.agency_id)
        .where('id', '=', source.facilityId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const invoiced = await tx
        .selectFrom('facility_invoice_claims')
        .select('claim_id')
        .where('facility_id', '=', source.facilityId)
        .where('claim_id', 'in', claimIds)
        .executeTakeFirst();
      if (invoiced) return;
      const invoice = await tx
        .insertInto('facility_invoices')
        .values({
          agency_id: agency.agency_id,
          facility_id: source.facilityId,
          period: source.period,
          sequence: sql<number>`(
            select coalesce(max(i.sequence), 0) + 1 from facility_invoices i
            where i.agency_id = ${agency.agency_id} and i.facility_id = ${source.facilityId}
              and i.period = ${source.period}
          )`,
          source_key: sourceKey,
          claim_count: source.claims.length,
          total_cents: totalCents,
          document: JSON.stringify(document)
        })
        .onConflict((oc) => oc.columns(['agency_id', 'source_key']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!invoice) return;
      await tx
        .insertInto('facility_invoice_claims')
        .values(
          claimIds.map((claimId) => ({
            agency_id: agency.agency_id,
            invoice_id: invoice.id,
            facility_id: source.facilityId,
            claim_id: claimId
          }))
        )
        .execute();
      await tx
        .insertInto('claim_events')
        .values(
          source.claims.map((c) => ({
            claim_id: c.claimId,
            kind: 'facility_invoiced' as const,
            note: `Facility invoice for ${source.period.slice(0, 7)}: ${money(c.balanceCents)} due`,
            document: JSON.stringify(document),
            source_key: `${sourceKey}:${c.claimId}`
          }))
        )
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
    });
  }
});

export const createCalendarStore = (db: Db): CalendarStore => ({
  today: async (runId, at) => {
    const run = await runAgency(db, runId).executeTakeFirst();
    if (!run) throw new Error(`Run ${runId} does not exist`);
    return agencyToday(db, run.agency_id, at);
  }
});
