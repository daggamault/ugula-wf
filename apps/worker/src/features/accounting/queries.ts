import { type AccountingStore, EVENT_TYPES, type UnmatchedPayment } from '@ugula/billing';
import { agencyTimeZone, type Db, emitEvent } from '@ugula/db';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

const UNMATCHED_WORKFLOW = 'billing.unmatched-payment';

const SUBMISSIONS = sql.join(['submitted', 'resubmitted'].map((k) => sql.lit(k)));

const UNRECOVERED = sql.join(['written_off', 'collections'].map((k) => sql.lit(k)));

const reported = (input: 'depositId' | 'payerFileId', id: ReturnType<typeof sql.ref>) =>
  sql<boolean>`exists (
    select 1 from workflow_runs r
    join graph_versions v on v.id = r.graph_version_id
    join graphs g on g.id = v.graph_id
    where r.agency_id = a.agency_id and g.key = ${UNMATCHED_WORKFLOW}
      and r.inputs ->> ${input} = ${id}::text
  )`;

type UnmatchedRow = {
  deposit_id: string | null;
  payer_file_id: string | null;
  trace_number: string;
  amount_cents: number;
  received_on: string;
  payer_name: string | null;
};

const unmatchedOf =
  (kind: UnmatchedPayment['kind']) =>
  (r: UnmatchedRow): UnmatchedPayment => ({
    kind,
    depositId: r.deposit_id,
    payerFileId: r.payer_file_id,
    traceNumber: r.trace_number,
    amountCents: r.amount_cents,
    receivedOn: r.received_on,
    payerName: r.payer_name
  });

type TotalsRow = {
  charges: number;
  payments: number;
  refunds: number;
  adjustments: number;
  write_offs: number;
};

export const createAccountingStore = (db: Db): AccountingStore => ({
  depositPairs: async (runId, { depositId, payerFileId }) => {
    const ids = [depositId, payerFileId].filter((id) => id !== null);
    if (!ids.every(isUuid)) return [];
    return db
      .selectFrom('deposits as d')
      .innerJoin('payer_files as f', (j) =>
        j.onRef('f.agency_id', '=', 'd.agency_id').onRef('f.trace_number', '=', 'd.trace_number')
      )
      .select([
        'd.id as depositId',
        'f.id as payerFileId',
        'd.trace_number as depositTrace',
        'd.amount_cents as depositCents',
        sql<string>`f.trace_number`.as('remittanceTrace'),
        sql<number>`f.payment_cents`.as('remittanceCents'),
        'd.payer_name as payerName',
        'f.file_name as fileName'
      ])
      .where('d.agency_id', '=', runAgency(db, runId))
      .where('d.payer_file_id', 'is', null)
      .where('f.kind', '=', '835')
      .where('f.payment_cents', 'is not', null)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('deposits as m').select('m.id').whereRef('m.payer_file_id', '=', 'f.id')
          )
        )
      )
      .$if(depositId !== null, (q) => q.where('d.id', '=', depositId as string))
      .$if(payerFileId !== null, (q) => q.where('f.id', '=', payerFileId as string))
      .orderBy('d.deposited_on')
      .orderBy('f.created_at')
      .execute();
  },

  matchDeposit: async (runId, depositId, payerFileId) => {
    if (!isUuid(depositId) || !isUuid(payerFileId)) {
      throw new Error(`Deposit ${depositId} or file ${payerFileId} does not exist`);
    }
    await db
      .updateTable('deposits')
      .set({ payer_file_id: payerFileId })
      .where('id', '=', depositId)
      .where('agency_id', '=', runAgency(db, runId))
      .where('payer_file_id', 'is', null)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('deposits as m').select('m.id').where('m.payer_file_id', '=', payerFileId)
          )
        )
      )
      .execute();
  },

  unmatchedPayments: async (runId, before) => {
    const { rows } = await sql<{ deposits: UnmatchedRow[]; remittances: UnmatchedRow[] }>`
      with a as (
        select r.agency_id, ${agencyTimeZone(sql.ref('r.agency_id'))} as zone
        from workflow_runs r where r.id = ${runId}
      ),
      open_deposits as (
        select d.id as deposit_id, null as payer_file_id, d.trace_number, d.amount_cents,
          d.deposited_on::text as received_on, d.payer_name
        from deposits d join a on a.agency_id = d.agency_id
        where d.payer_file_id is null and d.deposited_on <= ${before}::date
          and not ${reported('depositId', sql.ref('d.id'))}
      ),
      open_remittances as (
        select null as deposit_id, f.id as payer_file_id, f.trace_number, f.payment_cents as amount_cents,
          (f.created_at at time zone a.zone)::date::text as received_on, null as payer_name
        from payer_files f join a on a.agency_id = f.agency_id
        where f.kind = '835' and f.trace_number is not null and f.payment_cents > 0
          and (f.created_at at time zone a.zone)::date <= ${before}::date
          and not exists (select 1 from deposits m where m.payer_file_id = f.id)
          and not ${reported('payerFileId', sql.ref('f.id'))}
      )
      select
        (select coalesce(json_agg(x order by x.received_on, x.trace_number), '[]') from open_deposits x) as deposits,
        (select coalesce(json_agg(x order by x.received_on, x.trace_number), '[]') from open_remittances x) as remittances`.execute(
      db
    );
    const [found] = rows;
    if (!found) throw new Error('The unmatched payments query gave no row');
    return {
      deposits: found.deposits.map(unmatchedOf('deposit')),
      remittances: found.remittances.map(unmatchedOf('remittance'))
    };
  },

  periodTotals: async (runId, period) => {
    const { rows } = await sql<TotalsRow>`
      select
        coalesce(sum(c.total_cents) filter (
          where e.kind in (${SUBMISSIONS}) and not exists (
            select 1 from claim_events f
            where f.claim_id = e.claim_id and f.kind in (${SUBMISSIONS})
              and (f.created_at, f.id) < (e.created_at, e.id)
          )
        ), 0)::float8 as charges,
        coalesce(sum(e.paid_cents) filter (where e.kind = 'response'), 0)::float8 as payments,
        coalesce(-sum(e.paid_cents) filter (where e.kind = 'refunded'), 0)::float8 as refunds,
        coalesce(sum(e.adjusted_cents), 0)::float8 as adjustments,
        coalesce(sum(
          case when e.kind = 'closed' and e.note in (${UNRECOVERED}) then c.total_cents - (
            select coalesce(sum(f.paid_cents + f.adjusted_cents), 0)
            from claim_events f
            where f.claim_id = e.claim_id and (f.created_at, f.id) <= (e.created_at, e.id)
          ) end
        ), 0)::float8 as write_offs
      from claim_events e
      join claims c on c.id = e.claim_id
      where e.agency_id = (select r.agency_id from workflow_runs r where r.id = ${runId})
        and e.posted_on >= ${period}::date and e.posted_on < (${period}::date + interval '1 month')`.execute(
      db
    );
    const [t] = rows;
    if (!t) throw new Error('The period totals query gave no row');
    return {
      chargesCents: t.charges,
      paymentsCents: t.payments,
      refundsCents: t.refunds,
      adjustmentsCents: t.adjustments,
      writeOffsCents: t.write_offs
    };
  },

  closePeriod: async (runId, period, closedBy) => {
    await db.transaction().execute(async (tx) => {
      const { agency_id } = await runAgency(tx, runId).executeTakeFirstOrThrow();
      const closed = await tx
        .insertInto('accounting_periods')
        .values({
          agency_id,
          period_on: period,
          closed_by_id: closedBy && isUuid(closedBy) ? closedBy : null
        })
        .onConflict((oc) => oc.columns(['agency_id', 'period_on']).doNothing())
        .returning('period_on')
        .executeTakeFirst();
      if (closed) {
        await emitEvent(tx, {
          agencyId: agency_id,
          type: EVENT_TYPES.periodClosed,
          payload: { period }
        });
      }
    });
  }
});
