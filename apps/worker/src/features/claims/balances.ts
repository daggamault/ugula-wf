import {
  type BalanceStore,
  CLOSED_CLAIM_STATUSES,
  type ClaimEventKind,
  money,
  placementCsv
} from '@ugula/billing';
import { agencyToday, claimBalance, type Db, lockClaim, nudgeClaim, nudgeClaims } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobStore } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { agencyClaim } from './queries.ts';

const NOT_OPEN = ['draft', ...CLOSED_CLAIM_STATUSES] as const;

const refused = (reason: string) => ({ status: 'refused', reason }) as const;

export const placementKey = (agencyId: string, placedOn: string) =>
  `collections/${agencyId}/placements-${placedOn}.csv`;

const logged = (tx: Db, claimId: string, sourceKey: string) =>
  tx
    .selectFrom('claim_events')
    .select('paid_cents')
    .where('claim_id', '=', claimId)
    .where('source_key', '=', sourceKey)
    .executeTakeFirst();

type Logged = {
  agencyId: string;
  claimId: string;
  kind: ClaimEventKind;
  note: string;
  sourceKey: string;
  paidCents?: number;
  createdBy?: string | null;
  document?: string;
};

const log = (tx: Db, e: Logged) =>
  tx
    .insertInto('claim_events')
    .values({
      agency_id: e.agencyId,
      claim_id: e.claimId,
      kind: e.kind,
      note: e.note,
      paid_cents: e.paidCents ?? 0,
      document: e.document ?? null,
      created_by_id:
        e.createdBy && isUuid(e.createdBy)
          ? tx.selectFrom('users').select('id').where('id', '=', e.createdBy)
          : null,
      source_key: e.sourceKey
    })
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .execute();

const activePlan = (tx: Db, claimId: string) =>
  tx
    .selectFrom('payment_plans')
    .select('id')
    .where('claim_id', '=', claimId)
    .where('status', '=', 'active');

const planNote = (installmentCents: number, intervalDays: number, firstDueOn: string) =>
  `Payment plan: ${money(installmentCents)} every ${intervalDays} days from ${firstDueOn}`;

export const createBalanceStore = (
  db: Db,
  blobs: Pick<BlobStore, 'putBytes'>,
  boss: RunQueueClient,
  now: () => Date
): BalanceStore => ({
  startPlan: (runId, claimId, sourceKey, plan) =>
    db.transaction().execute(async (tx) => {
      const claim = await agencyClaim(tx, runId, claimId);
      const locked = await lockClaim(tx, claim.agency_id, claim.id);
      if (await logged(tx, claim.id, sourceKey)) return { status: 'started' } as const;
      if (!locked || (NOT_OPEN as readonly string[]).includes(locked.status)) {
        return refused('Only an open claim can be put on a payment plan');
      }
      if ((await claimBalance(tx, claim.id)) <= 0) return refused('Nothing is owed on the claim');
      if (await activePlan(tx, claim.id).executeTakeFirst()) {
        return refused('The claim already has an active payment plan');
      }
      await tx
        .insertInto('payment_plans')
        .values({
          agency_id: claim.agency_id,
          claim_id: claim.id,
          installment_cents: plan.installmentCents,
          interval_days: plan.intervalDays,
          first_due_on: plan.firstDueOn,
          created_by_id:
            plan.createdBy && isUuid(plan.createdBy)
              ? tx.selectFrom('users').select('id').where('id', '=', plan.createdBy)
              : null
        })
        .execute();
      await log(tx, {
        agencyId: claim.agency_id,
        claimId: claim.id,
        kind: 'plan_started',
        note: planNote(plan.installmentCents, plan.intervalDays, plan.firstDueOn),
        sourceKey,
        createdBy: plan.createdBy
      });
      await nudgeClaim(tx, boss, claim.agency_id, claim.id);
      return { status: 'started' } as const;
    }),

  missPlan: (runId, claimId, sourceKey, note) =>
    db.transaction().execute(async (tx) => {
      const claim = await agencyClaim(tx, runId, claimId);
      await lockClaim(tx, claim.agency_id, claim.id);
      if (await logged(tx, claim.id, sourceKey)) return;
      const missed = await tx
        .updateTable('payment_plans')
        .set({ missed_count: sql`missed_count + 1`, updated_at: sql`now()` })
        .where('claim_id', '=', claim.id)
        .where('status', '=', 'active')
        .returning('missed_count')
        .executeTakeFirst();
      if (!missed) return;
      await log(tx, {
        agencyId: claim.agency_id,
        claimId: claim.id,
        kind: 'plan_missed',
        note: `${note} (${missed.missed_count} missed)`,
        sourceKey
      });
    }),

  endPlan: (runId, claimId, sourceKey, { status, note }) =>
    db.transaction().execute(async (tx) => {
      const claim = await agencyClaim(tx, runId, claimId);
      await lockClaim(tx, claim.agency_id, claim.id);
      const ended = await tx
        .updateTable('payment_plans')
        .set({ status, updated_at: sql`now()` })
        .where('claim_id', '=', claim.id)
        .where('status', '=', 'active')
        .returning('id')
        .executeTakeFirst();
      if (!ended) return;
      await log(tx, {
        agencyId: claim.agency_id,
        claimId: claim.id,
        kind: 'plan_ended',
        note,
        sourceKey
      });
    }),

  placeCollections: async (runId, claimId, sourceKey, { agencyName, feePct }) => {
    const claim = await agencyClaim(db, runId, claimId);
    const placedOn = await agencyToday(db, claim.agency_id, now());
    await db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${placementKey(claim.agency_id, placedOn)}))`.execute(
        tx
      );
      const locked = await lockClaim(tx, claim.agency_id, claim.id);
      if (locked?.status !== 'collections') return;
      const placed = await tx
        .selectFrom('collections_placements')
        .select('id')
        .where('claim_id', '=', claim.id)
        .where('recalled_on', 'is', null)
        .executeTakeFirst();
      if (placed) return;
      const balanceCents = await claimBalance(tx, claim.id);
      if (balanceCents <= 0) return;
      await tx
        .insertInto('collections_placements')
        .values({
          agency_id: claim.agency_id,
          claim_id: claim.id,
          agency_name: agencyName,
          fee_pct: feePct,
          balance_cents: balanceCents,
          placed_on: placedOn
        })
        .execute();
      const rows = await tx
        .selectFrom('collections_placements as cp')
        .innerJoin('claims as c', 'c.id', 'cp.claim_id')
        .leftJoin('patients as p', 'p.id', 'c.patient_id')
        .select([
          'c.number',
          'c.pcr_number',
          'c.service_date',
          'p.first_name',
          'p.last_name',
          'p.birth_date',
          'p.address_line',
          'p.city',
          'p.state',
          'p.postal_code',
          'cp.balance_cents',
          'cp.agency_name',
          'cp.fee_pct'
        ])
        .where('cp.agency_id', '=', claim.agency_id)
        .where('cp.placed_on', '=', placedOn)
        .where('cp.recalled_on', 'is', null)
        .orderBy('c.number')
        .execute();
      const csv = placementCsv(
        rows.map((r) => ({
          claimNumber: r.number,
          pcrNumber: r.pcr_number,
          serviceDate: r.service_date,
          patient: [r.last_name, r.first_name].filter(Boolean).join(', '),
          birthDate: r.birth_date,
          addressLine: r.address_line,
          city: r.city,
          state: r.state,
          postalCode: r.postal_code,
          balanceCents: r.balance_cents,
          placedOn,
          agencyName: r.agency_name,
          feePct: Number(r.fee_pct)
        }))
      );
      const document = await blobs.putBytes(
        placementKey(claim.agency_id, placedOn),
        new TextEncoder().encode(csv),
        'text/csv'
      );
      await log(tx, {
        agencyId: claim.agency_id,
        claimId: claim.id,
        kind: 'collections_placed',
        note: `Placed with ${agencyName} (${feePct}% fee): ${money(balanceCents)}`,
        document: JSON.stringify(document),
        sourceKey
      });
    });
  },

  creditTargets: async (runId, claimId) => {
    const claim = await agencyClaim(db, runId, claimId);
    const rows = await db
      .selectFrom('claims as c')
      .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
      .innerJoin('patients as p', 'p.id', 'c.patient_id')
      .select(['c.id', 'c.number', 'c.pcr_number', 'c.service_date', 'b.balance_cents'])
      .where('c.agency_id', '=', claim.agency_id)
      .where('c.id', '<>', claim.id)
      .where('c.patient_id', '=', (eb) =>
        eb.selectFrom('claims as s').select('s.patient_id').where('s.id', '=', claim.id)
      )
      .where('c.status', 'not in', NOT_OPEN)
      .where('b.balance_cents', '>', 0)
      .orderBy('c.service_date')
      .orderBy('c.number')
      .execute();
    return rows.map((r) => ({
      claimId: r.id,
      reference: [r.pcr_number ?? r.number, r.service_date].filter(Boolean).join(' · '),
      balanceCents: r.balance_cents
    }));
  },

  transferCredit: (runId, claimId, sourceKey, { toClaimId, note }) =>
    db.transaction().execute(async (tx) => {
      const claim = await agencyClaim(tx, runId, claimId);
      if (!isUuid(toClaimId) || toClaimId === claim.id) {
        return refused('Choose another claim of the patient');
      }
      const locked = await tx
        .selectFrom('claims')
        .select(['id', 'number', 'status', 'patient_id'])
        .where('agency_id', '=', claim.agency_id)
        .where('id', 'in', [claim.id, toClaimId])
        .orderBy('id')
        .forUpdate()
        .execute();
      const from = locked.find((c) => c.id === claim.id);
      const to = locked.find((c) => c.id === toClaimId);
      const done = await logged(tx, claim.id, sourceKey);
      if (done) return { status: 'transferred', cents: -done.paid_cents } as const;
      if (!from || !to || from.patient_id === null || to.patient_id !== from.patient_id) {
        return refused('The other claim is not for the same patient');
      }
      if ((NOT_OPEN as readonly string[]).includes(to.status)) {
        return refused('The other claim is not open');
      }
      const credit = -(await claimBalance(tx, claim.id));
      if (credit <= 0) return refused('No credit is left on the claim');
      const owed = await claimBalance(tx, to.id);
      if (owed <= 0) return refused('The other claim owes nothing');
      const cents = Math.min(credit, owed);
      const why = note ? `: ${note}` : '';
      await log(tx, {
        agencyId: claim.agency_id,
        claimId: claim.id,
        kind: 'credit_transferred',
        paidCents: -cents,
        note: `Credit of ${money(cents)} moved to claim ${to.number}${why}`,
        sourceKey
      });
      await log(tx, {
        agencyId: claim.agency_id,
        claimId: to.id,
        kind: 'credit_transferred',
        paidCents: cents,
        note: `Credit of ${money(cents)} moved from claim ${from.number}${why}`,
        sourceKey: `${sourceKey}:to`
      });
      await nudgeClaims(tx, boss, claim.agency_id, [claim.id, to.id]);
      return { status: 'transferred', cents } as const;
    })
});
