import { createHash } from 'node:crypto';
import { type ClaimStore, type PricedLine, readStoredDetails } from '@ugula/billing';
import type { BlobStore } from '@ugula/blobs';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { runTenant } from '../../shared/tenancy.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const balanceOf = sql<number>`(c.total_cents - coalesce((select sum(e.paid_cents + e.adjusted_cents) from claim_events e where e.claim_id = c.id), 0))::int`;

const ownedClaim = async (db: Kysely<Database>, runId: string, claimId: string) => {
  const claim = UUID.test(claimId)
    ? await db
        .selectFrom('claims')
        .select(['id', 'total_cents', 'payers'])
        .where('id', '=', claimId)
        .where('tenant_id', '=', runTenant(db, runId))
        .executeTakeFirst()
    : undefined;
  return claim ?? null;
};

const claimOrFail = async (db: Kysely<Database>, runId: string, claimId: string) =>
  (await ownedClaim(db, runId, claimId)) ??
  Promise.reject(new Error(`Claim ${claimId} does not exist`));

type Blobs = Pick<BlobStore, 'putBytes'>;

export const NO_PROFILE = 'Add a billing profile in Settings before patient statements can be sent';

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export const statementKey = (
  tenantId: string,
  claimId: string,
  number: number,
  sourceKey: string
) =>
  `statements/${tenantId}/${claimId}/${number}-${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}.pdf`;

export const createClaimStore = (db: Kysely<Database>, blobs: Blobs): ClaimStore => ({
  statementData: async (runId, claimId) => {
    const row = await db
      .selectFrom('claims as c')
      .innerJoin('patients as p', 'p.id', 'c.patient_id')
      .leftJoin('billing_profiles as b', 'b.tenant_id', 'c.tenant_id')
      .select([
        'c.id',
        'c.pcr_number',
        'c.lines',
        'c.total_cents',
        'c.details',
        'p.first_name',
        'p.last_name',
        'p.address_line',
        'p.city',
        'p.state',
        'p.postal_code',
        'b.organization_name',
        'b.address_line as agency_address',
        'b.city as agency_city',
        'b.state as agency_state',
        'b.postal_code as agency_postal_code',
        'b.phone'
      ])
      .where('c.id', '=', claimId)
      .where('c.tenant_id', '=', runTenant(db, runId))
      .executeTakeFirst();
    if (!row) throw new Error(`Claim ${claimId} does not exist`);
    if (!row.organization_name || !row.phone) throw new Error(NO_PROFILE);
    const responses = await db
      .selectFrom('claim_events')
      .select(['payer', 'paid_cents', 'adjusted_cents', 'created_at'])
      .where('claim_id', '=', row.id)
      .where('kind', '=', 'response')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const payments = responses
      .filter((r) => r.paid_cents || r.adjusted_cents)
      .map((r) => ({
        date: day(r.created_at),
        from: r.payer ?? 'Patient',
        paidCents: r.paid_cents,
        adjustedCents: r.adjusted_cents
      }));
    return {
      agency: {
        name: row.organization_name,
        addressLine: row.agency_address,
        city: row.agency_city,
        state: row.agency_state,
        postalCode: row.agency_postal_code,
        phone: row.phone
      },
      patient: {
        name: `${row.first_name} ${row.last_name}`,
        addressLine: row.address_line,
        city: row.city,
        state: row.state,
        postalCode: row.postal_code
      },
      reference: row.pcr_number ?? row.id.slice(0, 8),
      serviceDate: readStoredDetails(row.details).serviceDate,
      lines: row.lines as PricedLine[],
      totalCents: row.total_cents,
      payments,
      balanceCents: payments.reduce((b, p) => b - p.paidCents - p.adjustedCents, row.total_cents)
    };
  },

  saveStatement: async (runId, claimId, sourceKey, { number, pdf }) => {
    const claim = await db
      .selectFrom('claims')
      .select(['id', 'tenant_id'])
      .where('id', '=', claimId)
      .where('tenant_id', '=', runTenant(db, runId))
      .executeTakeFirst();
    if (!claim) throw new Error(`Claim ${claimId} does not exist`);
    const document = await blobs.putBytes(
      statementKey(claim.tenant_id, claim.id, number, sourceKey),
      pdf,
      'application/pdf'
    );
    await db
      .insertInto('claim_events')
      .values({
        claim_id: claim.id,
        kind: 'statement',
        note: `Patient statement ${number} of 3`,
        document: JSON.stringify(document),
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  },

  openClaim: async (runId, sourceKey, c) =>
    (
      await db
        .insertInto('claims')
        .values({
          tenant_id: runTenant(db, runId),
          patient_id: c.patientId,
          pcr_number: c.pcrNumber,
          level: c.level,
          emergency: c.emergency,
          loaded_miles: c.loadedMiles,
          lines: JSON.stringify(c.lines),
          total_cents: c.totalCents,
          payers: c.payers,
          coverages: JSON.stringify(c.coverages),
          details: JSON.stringify(c.details),
          source_key: sourceKey
        })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'source_key'])
            .doUpdateSet({ updated_at: sql`claims.updated_at` })
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id,

  attachCycle: async (runId, claimId, cycleRunId) => {
    const claim = await claimOrFail(db, runId, claimId);
    await db
      .updateTable('claims')
      .set({
        cycle_run_id: db
          .selectFrom('workflow_runs')
          .select('id')
          .where('id', '=', cycleRunId)
          .where('tenant_id', '=', runTenant(db, runId)),
        updated_at: sql`now()`
      })
      .where('id', '=', claim.id)
      .execute();
  },

  ledger: async (runId, claimId) => {
    const claim = await ownedClaim(db, runId, claimId);
    if (!claim) return null;
    const events = await db
      .selectFrom('claim_events')
      .select(['kind', 'payer', 'paid_cents', 'adjusted_cents', 'created_at'])
      .where('claim_id', '=', claim.id)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return {
      totalCents: claim.total_cents,
      payers: claim.payers,
      events: events.map((e) => ({
        kind: e.kind,
        payer: e.payer,
        paidCents: e.paid_cents,
        adjustedCents: e.adjusted_cents,
        at: new Date(e.created_at).toISOString()
      }))
    };
  },

  recordEvent: async (runId, claimId, sourceKey, e) => {
    const claim = await claimOrFail(db, runId, claimId);
    await db
      .insertInto('claim_events')
      .values({
        claim_id: claim.id,
        kind: e.kind,
        payer: e.payer,
        note: e.note,
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  },

  closeClaim: async (runId, claimId, sourceKey, requested) => {
    const claim = await claimOrFail(db, runId, claimId);
    await db.transaction().execute(async (tx) => {
      const locked = await tx
        .selectFrom('claims')
        .select('status')
        .where('id', '=', claim.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.status !== 'open') return;
      const { balance_cents } = await tx
        .selectFrom('claims as c')
        .select(balanceOf.as('balance_cents'))
        .where('c.id', '=', claim.id)
        .executeTakeFirstOrThrow();
      const status = balance_cents <= 0 ? 'paid' : requested;
      await tx
        .updateTable('claims')
        .set({ status, updated_at: sql`now()` })
        .where('id', '=', claim.id)
        .execute();
      await tx
        .insertInto('claim_events')
        .values({ claim_id: claim.id, kind: 'closed', note: status, source_key: sourceKey })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
    });
  }
});
