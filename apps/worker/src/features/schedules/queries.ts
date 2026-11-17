import { createHash } from 'node:crypto';
import {
  type CalendarStore,
  CLOSED_CLAIM_STATUSES,
  type FacilityInvoiceSource,
  money,
  type ScheduleStore
} from '@ugula/billing';
import { agencyTimeZone, agencyToday, type Db, findProfile } from '@ugula/db';
import type { SchedulePeriod } from '@ugula/graph';
import type { BlobStore } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'putBytes'>;

const REMINDER_WORKFLOW = 'billing.deadline-reminder';

const OPEN_EXCLUDED = sql.join([...CLOSED_CLAIM_STATUSES, 'draft'].map((s) => sql.lit(s)));

const reference = sql<string>`concat_ws(' · ', c.number, c.pcr_number, nullif(concat_ws(' ', p.first_name, p.last_name), ''))`;

type ClaimRow = { claim_id: string; patient_id: string | null; reference: string };

type FilingRow = ClaimRow & {
  coverage_id: string;
  claim_filing: string | null;
  filing_limit_days: number | null;
  service_date: string;
};

type CertificationRow = ClaimRow & { signed_on: string; service_date: string };

type TaskRow = ClaimRow & { workflow: string; due_on: string; task_id: string; priority: number };

type ReminderRow = {
  kind: string;
  claim_id: string;
  patient_id: string | null;
  due_on: string;
  opened_on: string;
};

type DeadlineRows = {
  filings: FilingRow[];
  certifications: CertificationRow[];
  tasks: TaskRow[];
  reminders: ReminderRow[];
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

type DueSchedule = { every: SchedulePeriod; hour: number };

export const findDueOn = async (db: Db, agencyId: string, workflow: string, s: DueSchedule) => {
  const zone = agencyTimeZone(agencyId);
  const { rows } = await sql<{ fire_on: string }>`
    select z.period::date::text as fire_on
    from (
      select date_trunc(${s.every}, now() at time zone ${zone}) as period,
        now() at time zone ${zone} as local
    ) z
    where z.local >= z.period + make_interval(hours => ${s.hour}::int)
      and not exists (
        select 1 from schedule_runs r
        where r.agency_id = ${agencyId}::uuid and r.workflow = ${workflow}
          and r.fire_on = z.period::date
      )`.execute(db);
  return rows[0]?.fire_on ?? null;
};

export const claimScheduleRun = (db: Db, agencyId: string, workflow: string, fireOn: string) =>
  db
    .insertInto('schedule_runs')
    .values({ agency_id: agencyId, workflow, fire_on: fireOn })
    .onConflict((oc) => oc.doNothing())
    .returning('agency_id')
    .executeTakeFirst();

export const createScheduleStore = (db: Db, blobs: Blobs): ScheduleStore => ({
  deadlineFacts: async (runId, since) => {
    const { rows } = await sql<DeadlineRows>`
      with agency as (
        select r.agency_id, ${agencyTimeZone(sql.ref('r.agency_id'))} as zone
        from workflow_runs r where r.id = ${runId}
      ),
      filings as (
        select c.id as claim_id, c.patient_id, ${reference} as reference, cc.id as coverage_id,
          dp.claim_filing, dp.filing_limit_days, c.service_date::text as service_date
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
        where c.status in ('draft', 'needs_review', 'ready') and c.service_date is not null
          and not exists (
            select 1 from claim_events e where e.coverage_id = cc.id and e.kind in ('submitted', 'resubmitted')
              and not exists (
                select 1 from claim_events j where j.coverage_id = cc.id and j.kind = 'rejected'
                  and j.created_at > e.created_at
              )
          )
      ),
      certifications as (
        select distinct on (c.patient_id) c.id as claim_id, c.patient_id, ${reference} as reference,
          c.pcs_signed_on::text as signed_on, c.service_date::text as service_date
        from claims c
        join agency a on a.agency_id = c.agency_id
        left join patients p on p.id = c.patient_id
        where c.classification = 'scheduled' and c.pcs_signed_on is not null and c.patient_id is not null
          and c.service_date >= ${since}::date
        order by c.patient_id, c.service_date desc, c.number desc
      ),
      due as (
        select g.key as workflow, c.id as claim_id, c.patient_id, ${reference} as reference,
          (t.due_at at time zone a.zone)::date::text as due_on, t.id as task_id, t.priority
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
      reminders as (
        select r.inputs ->> 'kind' as kind, c.id as claim_id, c.patient_id, r.inputs ->> 'dueOn' as due_on,
          (t.created_at at time zone a.zone)::date::text as opened_on
        from tasks t
        join agency a on a.agency_id = t.agency_id
        join claim_runs cr on cr.run_id = t.run_id
        join claims c on c.id = cr.claim_id
        join workflow_runs r on r.id = t.run_id
        join graph_versions v on v.id = r.graph_version_id
        join graphs g on g.id = v.graph_id
        where g.key = ${REMINDER_WORKFLOW} and t.status in ('open', 'completed')
          and r.inputs ->> 'kind' is not null and r.inputs ->> 'dueOn' is not null
          and (
            c.id in (select claim_id from filings union all select claim_id from due)
            or c.patient_id in (select patient_id from certifications)
          )
      )
      select
        (select coalesce(json_agg(f order by f.claim_id), '[]') from filings f) as filings,
        (select coalesce(json_agg(x order by x.patient_id), '[]') from certifications x) as certifications,
        (select coalesce(json_agg(d order by d.task_id), '[]') from due d) as tasks,
        (select coalesce(json_agg(m order by m.claim_id, m.due_on), '[]') from reminders m) as reminders`.execute(
      db
    );
    const [facts] = rows;
    if (!facts) throw new Error('The deadlines query gave no row');
    const claimOf = (r: ClaimRow) => ({
      claimId: r.claim_id,
      patientId: r.patient_id,
      reference: r.reference
    });
    return {
      filings: facts.filings.map((r) => ({
        ...claimOf(r),
        coverageId: r.coverage_id,
        claimFiling: r.claim_filing,
        filingLimitDays: r.filing_limit_days,
        serviceDate: r.service_date
      })),
      certifications: facts.certifications.map((r) => ({
        ...claimOf(r),
        signedOn: r.signed_on,
        serviceDate: r.service_date
      })),
      tasks: facts.tasks.map((r) => ({
        workflow: r.workflow,
        ...claimOf(r),
        dueOn: r.due_on,
        taskId: r.task_id,
        priority: r.priority
      })),
      reminders: facts.reminders.map((r) => ({
        kind: r.kind,
        claimId: r.claim_id,
        patientId: r.patient_id,
        dueOn: r.due_on,
        openedOn: r.opened_on
      }))
    };
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
            agency_id: agency.agency_id,
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
