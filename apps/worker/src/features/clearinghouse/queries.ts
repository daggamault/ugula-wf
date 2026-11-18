import {
  type Acknowledgment,
  acknowledgmentsOf,
  adjudicationOf,
  type ClearinghouseStore,
  claimPaidCentsOf,
  isBalanced,
  patientCentsOf,
  paymentOutcomeOf,
  providerAdjustmentCentsOf,
  type Remittance,
  type RemittanceClaim,
  read835
} from '@ugula/billing';
import { type Database, describeCodes } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type Db = Kysely<Database>;

const WAITING = ['sent', 'accepted', 'forwarded'] as const;

const ACKNOWLEDGEABLE = ['sent', 'accepted'] as const;

const agencyOf = async (db: Db, runId: string) => {
  const run = await runAgency(db, runId).executeTakeFirst();
  if (!run) throw new Error(`Run ${runId} does not exist`);
  return run.agency_id;
};

const readFile = async (db: Db, agencyId: string, fileId: string) => {
  const file = isUuid(fileId)
    ? await db
        .selectFrom('clearinghouse_files')
        .select(['kind', 'content', 'received_at'])
        .where('agency_id', '=', agencyId)
        .where('id', '=', fileId)
        .executeTakeFirst()
    : undefined;
  if (!file) throw new Error(`Clearinghouse file ${fileId} does not exist`);
  return file;
};

const rejectPayer = async (
  tx: Db,
  claimId: string,
  position: number,
  note: string
): Promise<boolean> => {
  const rejected = await tx
    .updateTable('claim_coverages')
    .set({ status: 'rejected', status_note: note || 'Rejected', updated_at: sql`now()` })
    .where('claim_id', '=', claimId)
    .where('position', '=', position)
    .where('status', 'in', ACKNOWLEDGEABLE)
    .returning('id')
    .executeTakeFirst();
  if (!rejected) return false;
  await tx
    .updateTable('claims')
    .set({ status: 'rejected', updated_at: sql`now()` })
    .where('id', '=', claimId)
    .where('status', '=', 'submitted')
    .execute();
  return true;
};

const applyToFile = async (
  tx: Db,
  agencyId: string,
  ack: Acknowledgment & { by: 'controlNumber' }
) => {
  const submission = await tx
    .updateTable('claim_submissions')
    .set({
      ack_status: ack.accepted ? 'accepted' : 'rejected',
      ack_note: ack.note || null,
      acknowledged_at: sql`now()`
    })
    .where('agency_id', '=', agencyId)
    .where('control_number', '=', ack.controlNumber)
    .where('ack_status', 'is', null)
    .returning(['claim_id', 'coverage_position'])
    .executeTakeFirst();
  if (!submission) return null;
  return ack.accepted
    ? 'accepted'
    : (await rejectPayer(tx, submission.claim_id, submission.coverage_position, ack.note))
      ? 'rejected'
      : null;
};

const waitingPayer = (tx: Db, claimId: string, statuses: readonly string[]) =>
  tx
    .selectFrom('claim_coverages')
    .select(['position', 'payer_claim_number'])
    .where('claim_id', '=', claimId)
    .where('status', 'in', statuses as typeof WAITING)
    .orderBy('position')
    .limit(1)
    .executeTakeFirst();

const claimByNumber = (tx: Db, agencyId: string, number: string) =>
  tx
    .selectFrom('claims')
    .select(['id'])
    .where('agency_id', '=', agencyId)
    .where('number', '=', number)
    .executeTakeFirst();

const applyToClaim = async (
  tx: Db,
  agencyId: string,
  ack: Acknowledgment & { by: 'claimNumber' }
) => {
  if (ack.status === 'pending') return null;
  const claim = await claimByNumber(tx, agencyId, ack.claimNumber);
  const payer = claim && (await waitingPayer(tx, claim.id, ACKNOWLEDGEABLE));
  if (!claim || !payer) return null;
  if (ack.status === 'rejected') {
    return (await rejectPayer(tx, claim.id, payer.position, ack.note)) ? 'rejected' : null;
  }
  await tx
    .updateTable('claim_coverages')
    .set({
      status: 'accepted',
      payer_claim_number: ack.payerClaimNumber ?? payer.payer_claim_number,
      status_note: null,
      updated_at: sql`now()`
    })
    .where('claim_id', '=', claim.id)
    .where('position', '=', payer.position)
    .execute();
  return 'accepted';
};

const payerFor = async (tx: Db, claimId: string, c: RemittanceClaim) => {
  if (!c.reversal) return waitingPayer(tx, claimId, WAITING);
  return tx
    .selectFrom('claim_coverages')
    .select(['position', 'payer_claim_number'])
    .where('claim_id', '=', claimId)
    .where('status', 'in', ['paid', 'denied'])
    .where((eb) =>
      c.payerClaimNumber ? eb('payer_claim_number', '=', c.payerClaimNumber) : eb.lit(true)
    )
    .orderBy('position', 'desc')
    .limit(1)
    .executeTakeFirst();
};

const postClaim = async (
  tx: Db,
  agencyId: string,
  remittanceId: string,
  c: RemittanceClaim,
  paidOn: string
) => {
  const claim = await claimByNumber(tx, agencyId, c.claimNumber);
  const payer = claim ? await payerFor(tx, claim.id, c) : undefined;
  const outcome = paymentOutcomeOf(c);
  const adjudication = adjudicationOf(c, paidOn);
  if (claim && payer) {
    const payerClaimNumber = c.payerClaimNumber ?? payer.payer_claim_number;
    await tx
      .updateTable('claim_coverages')
      .set(
        outcome === 'reversed'
          ? { status: 'accepted', adjudication: null, updated_at: sql`now()` }
          : {
              status: outcome === 'denied' ? 'denied' : 'paid',
              adjudication: JSON.stringify(adjudication),
              payer_claim_number: payerClaimNumber,
              status_note: null,
              updated_at: sql`now()`
            }
      )
      .where('claim_id', '=', claim.id)
      .where('position', '=', payer.position)
      .execute();
    if (outcome === 'forwarded') {
      await tx
        .updateTable('claim_coverages')
        .set({ status: 'forwarded', updated_at: sql`now()` })
        .where('claim_id', '=', claim.id)
        .where('position', '=', (eb) =>
          eb
            .selectFrom('claim_coverages')
            .select((s) => s.fn.min('position').as('next'))
            .where('claim_id', '=', claim.id)
            .where('position', '>', payer.position)
            .where('status', '=', 'pending')
        )
        .execute();
    }
  }
  await tx
    .insertInto('claim_payments')
    .values({
      agency_id: agencyId,
      remittance_id: remittanceId,
      claim_id: claim && payer ? claim.id : null,
      coverage_position: claim && payer ? payer.position : null,
      claim_number: c.claimNumber,
      status_code: c.status,
      outcome,
      charge_cents: c.chargeCents,
      paid_cents: c.paidCents,
      patient_cents: patientCentsOf(adjudication.adjustments),
      payer_claim_number: c.payerClaimNumber,
      adjustments: JSON.stringify(adjudication.adjustments),
      lines: JSON.stringify(adjudication.lines),
      remarks: c.remarks
    })
    .execute();
  return Boolean(claim && payer);
};

const postRemittance = async (
  tx: Db,
  agencyId: string,
  fileId: string,
  r: Remittance,
  receivedOn: string
) => {
  const paidOn = r.paidOn ?? receivedOn;
  const { id } = await tx
    .insertInto('remittances')
    .values({
      agency_id: agencyId,
      file_id: fileId,
      payer_name: r.payerName,
      payer_code: r.payerId,
      trace_number: r.checkNumber,
      payment_method: r.paymentMethod,
      paid_on: r.paidOn,
      total_cents: r.totalCents,
      claim_paid_cents: claimPaidCentsOf(r),
      provider_adjustment_cents: providerAdjustmentCentsOf(r),
      unmatched_count: 0,
      is_balanced: isBalanced(r)
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  let posted = 0;
  for (const c of r.claims) if (await postClaim(tx, agencyId, id, c, paidOn)) posted += 1;
  const unmatched = r.claims.length - posted;
  if (unmatched) {
    await tx
      .updateTable('remittances')
      .set({ unmatched_count: unmatched })
      .where('id', '=', id)
      .execute();
  }
  return { posted, unmatched };
};

const reasonText = (code: string, description: string | undefined) =>
  description ? `${code}: ${description}` : code;

export const createClearinghouseStore = (db: Db): ClearinghouseStore => ({
  applyAcknowledgments: async (runId, fileId) => {
    const agencyId = await agencyOf(db, runId);
    const file = await readFile(db, agencyId, fileId);
    const acks = acknowledgmentsOf(file.kind, file.content);
    return db.transaction().execute(async (tx) => {
      let accepted = 0;
      let rejected = 0;
      for (const ack of acks) {
        const applied =
          ack.by === 'controlNumber'
            ? await applyToFile(tx, agencyId, ack)
            : await applyToClaim(tx, agencyId, ack);
        if (applied === 'accepted') accepted += 1;
        if (applied === 'rejected') rejected += 1;
      }
      return { accepted, rejected };
    });
  },
  postRemittance: async (runId, fileId) => {
    const agencyId = await agencyOf(db, runId);
    const file = await readFile(db, agencyId, fileId);
    if (file.kind !== '835') throw new Error(`Clearinghouse file ${fileId} is not an 835`);
    const remittances = read835(file.content);
    const receivedOn = new Date(file.received_at).toISOString().slice(0, 10);
    return db.transaction().execute(async (tx) => {
      const already = await tx
        .selectFrom('remittances')
        .select('id')
        .where('agency_id', '=', agencyId)
        .where('file_id', '=', fileId)
        .executeTakeFirst();
      if (already) return { remittances: 0, posted: 0, unmatched: 0 };
      let posted = 0;
      let unmatched = 0;
      for (const r of remittances) {
        const done = await postRemittance(tx, agencyId, fileId, r, receivedOn);
        posted += done.posted;
        unmatched += done.unmatched;
      }
      return { remittances: remittances.length, posted, unmatched };
    });
  },
  findPayment: async (runId, paymentId) => {
    if (!isUuid(paymentId)) return null;
    const agencyId = await agencyOf(db, runId);
    const p = await db
      .selectFrom('claim_payments as p')
      .select((eb) => [
        'p.claim_id',
        'p.claim_number',
        'p.outcome',
        'p.paid_cents',
        'p.patient_cents',
        'p.adjustments',
        'p.remarks',
        eb
          .exists(
            eb
              .selectFrom('claim_coverages as cc')
              .select(sql`1`.as('one'))
              .whereRef('cc.claim_id', '=', 'p.claim_id')
              .whereRef('cc.position', '>', 'p.coverage_position')
              .where('cc.status', 'in', ['pending', 'forwarded'])
          )
          .as('has_next_payer')
      ])
      .where('p.agency_id', '=', agencyId)
      .where('p.id', '=', paymentId)
      .where('p.claim_id', 'is not', null)
      .executeTakeFirst();
    if (!p?.claim_id) return null;
    const codes = await describeCodes(db, [
      ...p.adjustments.map((a) => ({ set: 'carc' as const, code: a.reason })),
      ...p.remarks.map((code) => ({ set: 'rarc' as const, code }))
    ]);
    return {
      claimId: p.claim_id,
      claimNumber: p.claim_number,
      outcome: p.outcome,
      paidCents: p.paid_cents,
      patientCents: p.patient_cents,
      hasNextPayer: Boolean(p.has_next_payer),
      reasons: [
        ...p.adjustments.map((a) =>
          reasonText(
            `${a.group}-${a.reason} $${(a.cents / 100).toFixed(2)}`,
            codes.carc?.[a.reason]
          )
        ),
        ...p.remarks.map((code) => reasonText(code, codes.rarc?.[code]))
      ]
    };
  },
  findRemittance: async (runId, remittanceId) => {
    if (!isUuid(remittanceId)) return null;
    const agencyId = await agencyOf(db, runId);
    const r = await db
      .selectFrom('remittances')
      .select(['payer_name', 'total_cents', 'is_balanced', 'unmatched_count', 'reconciled_at'])
      .where('agency_id', '=', agencyId)
      .where('id', '=', remittanceId)
      .executeTakeFirst();
    return r
      ? {
          payerName: r.payer_name,
          totalCents: r.total_cents,
          balanced: r.is_balanced,
          unmatched: r.unmatched_count,
          reconciled: r.reconciled_at !== null
        }
      : null;
  },
  reconcileRemittance: async (runId, remittanceId, reconciledBy, note) => {
    if (!isUuid(remittanceId)) throw new Error(`Remittance ${remittanceId} does not exist`);
    if (reconciledBy !== null && !isUuid(reconciledBy)) {
      throw new Error(`User ${reconciledBy} does not exist`);
    }
    await db
      .updateTable('remittances')
      .set({ reconciled_at: sql`now()`, reconciled_by: reconciledBy, reconcile_note: note })
      .where('agency_id', '=', runAgency(db, runId))
      .where('id', '=', remittanceId)
      .execute();
  }
});
