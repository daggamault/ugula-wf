import { createHash } from 'node:crypto';
import {
  CLOSED_CLAIM_STATUSES,
  type ClaimStore,
  claimSignalKey,
  type DraftClaim,
  isClosedStatus,
  type NewClaim
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { BlobStore } from '@ugula/storage';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runTenant } from '../../shared/tenancy.ts';

type Db = Kysely<Database>;

const ownedClaim = async (db: Db, runId: string, claimId: string) => {
  const claim = isUuid(claimId)
    ? await db
        .selectFrom('claims')
        .select(['id', 'total_cents'])
        .where('id', '=', claimId)
        .where('tenant_id', '=', runTenant(db, runId))
        .executeTakeFirst()
    : undefined;
  return claim ?? null;
};

const claimOrFail = async (db: Db, runId: string, claimId: string) =>
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

const directoryPayer = (db: Db, runId: string, { payer, payerId }: NewClaim['coverages'][number]) =>
  db
    .selectFrom('payers')
    .select('id')
    .where('tenant_id', '=', runTenant(db, runId))
    .where((eb) =>
      payerId === null
        ? eb(sql`lower(name)`, '=', payer.toLowerCase())
        : eb('id', '=', isUuid(payerId) ? payerId : null)
    );

const sourceReport = (db: Db, runId: string, key: string) =>
  db
    .selectFrom('import_reports as r')
    .innerJoin('imports as i', 'i.id', 'r.import_id')
    .select('r.id')
    .where(sql`r.report ->> 'key'`, '=', key)
    .where('i.tenant_id', '=', runTenant(db, runId));

const claimValues = (c: NewClaim) => {
  const { serviceDate, pickup, destination, originDestination } = c.details;
  return {
    patient_id: c.patientId,
    pcr_number: c.pcrNumber,
    level: c.level,
    emergency: c.emergency,
    loaded_miles: c.loadedMiles,
    total_cents: c.totalCents,
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
    destination_postal_code: destination.postalCode
  };
};

const insertDraft = async (db: Db, runId: string, sourceKey: string, d: DraftClaim) =>
  (
    await db
      .insertInto('claims')
      .values({
        tenant_id: runTenant(db, runId),
        patient_id: d.patientId,
        import_report_id: d.reportKey === null ? null : sourceReport(db, runId, d.reportKey),
        pcr_number: d.pcrNumber,
        source_key: sourceKey
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst()
  )?.id ?? null;

const replaceClaimRows = async (db: Db, runId: string, claimId: string, c: NewClaim) => {
  await db.deleteFrom('claim_lines').where('claim_id', '=', claimId).execute();
  await db.deleteFrom('claim_coverages').where('claim_id', '=', claimId).execute();
  await db.deleteFrom('claim_diagnoses').where('claim_id', '=', claimId).execute();
  await db
    .insertInto('claim_lines')
    .values(
      c.lines.map((l, i) => ({
        claim_id: claimId,
        position: i + 1,
        code: l.code,
        units: l.units,
        unit_cents: l.unitCents,
        total_cents: l.totalCents
      }))
    )
    .execute();
  if (c.coverages.length) {
    await db
      .insertInto('claim_coverages')
      .values(
        c.coverages.map((cov, i) => ({
          claim_id: claimId,
          position: i + 1,
          payer_name: cov.payer,
          payer_id: directoryPayer(db, runId, cov),
          payer_code: cov.payerCode,
          member_id: cov.memberId,
          group_id: cov.groupId
        }))
      )
      .execute();
  }
  if (c.details.diagnoses.length) {
    await db
      .insertInto('claim_diagnoses')
      .values(c.details.diagnoses.map((code, i) => ({ claim_id: claimId, position: i + 1, code })))
      .execute();
  }
};

const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;

export const createClaimStore = (db: Db, blobs: Blobs): ClaimStore => ({
  statementData: async (runId, claimId) => {
    const row = await db
      .selectFrom('claims as c')
      .innerJoin('patients as p', 'p.id', 'c.patient_id')
      .leftJoin('billing_profiles as b', 'b.tenant_id', 'c.tenant_id')
      .select([
        'c.id',
        'c.pcr_number',
        'c.total_cents',
        'c.service_date',
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
    const [lines, responses] = await Promise.all([
      db
        .selectFrom('claim_lines')
        .select(['code', 'units', 'unit_cents', 'total_cents'])
        .where('claim_id', '=', row.id)
        .orderBy('position')
        .execute(),
      db
        .selectFrom('claim_events as e')
        .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select([payerName.as('payer'), 'e.paid_cents', 'e.adjusted_cents', 'e.created_at'])
        .where('e.claim_id', '=', row.id)
        .where('e.kind', '=', 'response')
        .where((eb) => eb.or([eb('e.paid_cents', '>', 0), eb('e.adjusted_cents', '>', 0)]))
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute()
    ]);
    const payments = responses.map((r) => ({
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
      serviceDate: row.service_date,
      lines: lines.map((l) => ({
        code: l.code,
        units: Number(l.units),
        unitCents: l.unit_cents,
        totalCents: l.total_cents
      })),
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

  findByPcr: async (runId, pcrNumber) =>
    (
      await db
        .selectFrom('claims')
        .select('id')
        .where('tenant_id', '=', runTenant(db, runId))
        .where('pcr_number', '=', pcrNumber)
        .executeTakeFirst()
    )?.id ?? null,

  openDraft: (runId, sourceKey, d) =>
    db.transaction().execute(async (tx) => {
      const id = await insertDraft(tx, runId, sourceKey, d);
      if (id) return { id, duplicate: false };
      const existing = await tx
        .selectFrom('claims')
        .select(['id', 'source_key'])
        .where('tenant_id', '=', runTenant(tx, runId))
        .where((eb) =>
          eb.or([
            eb('source_key', '=', sourceKey),
            ...(d.pcrNumber ? [eb('pcr_number', '=', d.pcrNumber)] : [])
          ])
        )
        .orderBy(sql`source_key = ${sourceKey}`, 'desc')
        .executeTakeFirstOrThrow();
      return { id: existing.id, duplicate: existing.source_key !== sourceKey };
    }),

  saveClaim: async (runId, claimId, c) => {
    const claim = await claimOrFail(db, runId, claimId);
    await db.transaction().execute(async (tx) => {
      const locked = await tx
        .selectFrom('claims')
        .select('status')
        .where('id', '=', claim.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.status !== 'draft') return;
      await tx
        .updateTable('claims')
        .set({ ...claimValues(c), status: 'needs_review', updated_at: sql`now()` })
        .where('id', '=', claim.id)
        .execute();
      await replaceClaimRows(tx, runId, claim.id, c);
    });
  },

  setStatus: async (runId, claimId, status) => {
    const claim = await claimOrFail(db, runId, claimId);
    await db
      .updateTable('claims')
      .set({ status, updated_at: sql`now()` })
      .where('id', '=', claim.id)
      .where('status', '<>', status)
      .where('status', 'not in', ['draft', ...CLOSED_CLAIM_STATUSES])
      .execute();
  },

  noteRevision: async (runId, claimId, sourceKey, report) => {
    const claim = await claimOrFail(db, runId, claimId);
    await db
      .insertInto('claim_events')
      .values({
        claim_id: claim.id,
        kind: 'revised',
        note: 'An updated patient care report arrived',
        document: JSON.stringify(report),
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  },

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
    const named = await db
      .selectFrom('claims as c')
      .innerJoin('patients as p', 'p.id', 'c.patient_id')
      .select(['c.pcr_number', 'p.first_name', 'p.last_name'])
      .where('c.id', '=', claim.id)
      .executeTakeFirst();
    const signal = await db
      .selectFrom('signals')
      .select('received')
      .where('tenant_id', '=', runTenant(db, runId))
      .where('key', '=', claimSignalKey(claim.id))
      .executeTakeFirst();
    const [coverages, events] = await Promise.all([
      db
        .selectFrom('claim_coverages as cc')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select(['cc.id', payerName.as('payer')])
        .where('cc.claim_id', '=', claim.id)
        .orderBy('cc.position')
        .execute(),
      db
        .selectFrom('claim_events')
        .select(['kind', 'coverage_id', 'paid_cents', 'adjusted_cents', 'created_at'])
        .where('claim_id', '=', claim.id)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    ]);
    return {
      totalCents: claim.total_cents,
      signalsSeen: signal?.received ?? 0,
      reference: [named?.pcr_number, named && `${named.first_name} ${named.last_name}`]
        .filter(Boolean)
        .join(' · '),
      coverages,
      events: events.map((e) => ({
        kind: e.kind,
        coverageId: e.coverage_id,
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
        coverage_id: e.coverageId,
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
      if (isClosedStatus(locked.status)) return;
      const { balance_cents } = await tx
        .selectFrom('claim_balances')
        .select('balance_cents')
        .where('claim_id', '=', claim.id)
        .executeTakeFirstOrThrow();
      const status = requested !== 'void' && balance_cents <= 0 ? 'paid' : requested;
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
