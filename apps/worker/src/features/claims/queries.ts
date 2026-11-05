import { createHash, randomUUID } from 'node:crypto';
import {
  type Adjustment,
  CLOSED_CLAIM_STATUSES,
  type ClaimStatus,
  type ClaimStore,
  type Clearinghouse,
  claimSignalKey,
  DIAGNOSIS_LIMIT,
  type DraftClaim,
  exchangeFileName,
  isClosedStatus,
  type NewClaim
} from '@ugula/billing';
import {
  ACTIVE_RUN_STATUSES,
  allocateControlNumber,
  applyClaimEdit,
  batchKey,
  type Db,
  documentationValues,
  findClaimCheck,
  findProfile,
  findReadyClaim,
  insertBatch,
  insertSubmissionEvent,
  lockReadyClaim,
  markSubmitted,
  pendingClaim,
  sqlExecutor,
  TERMINAL_RUN_STATUSES,
  toSubmitter
} from '@ugula/db';
import { cancel, enqueueRuns, type RunQueueClient, resume } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type Blobs = Pick<BlobStore, 'putBytes' | 'getBytes'>;

const BATCH_CONTENT_TYPE = 'application/edi-x12';

const agencyClaim = async (db: Db, runId: string, claimId: string) =>
  (isUuid(claimId)
    ? await db
        .selectFrom('claims')
        .select(['id', 'agency_id'])
        .where('id', '=', claimId)
        .where('agency_id', '=', runAgency(db, runId))
        .executeTakeFirst()
    : undefined) ?? Promise.reject(new Error(`Claim ${claimId} does not exist`));

const DRAFT: ClaimStatus = 'draft';

const REVIEWABLE: ClaimStatus = 'needs_review';

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export const statementKey = (
  agencyId: string,
  claimId: string,
  number: number,
  sourceKey: string
) =>
  `statements/${agencyId}/${claimId}/${number}-${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}.pdf`;

const directoryPayer = (db: Db, runId: string, { payer, payerId }: NewClaim['coverages'][number]) =>
  db
    .selectFrom('payers')
    .select('id')
    .where('agency_id', '=', runAgency(db, runId))
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
    .where('i.agency_id', '=', runAgency(db, runId));

const claimValues = (c: NewClaim) => {
  const { serviceDate, pickup, destination, originDestination } = c.details;
  return {
    patient_id: c.patientId,
    pcr_number: c.pcrNumber,
    trip_type: c.tripType,
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
    destination_postal_code: destination.postalCode,
    ...documentationValues(c.details.documentation)
  };
};

const insertDraft = async (db: Db, runId: string, sourceKey: string, d: DraftClaim) =>
  (
    await db
      .insertInto('claims')
      .values({
        agency_id: runAgency(db, runId),
        import_report_id: d.reportKey === null ? null : sourceReport(db, runId, d.reportKey),
        pcr_number: d.pcrNumber,
        source_key: sourceKey
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst()
  )?.id ?? null;

const linkRun = (db: Db, runId: string, claimId: string) =>
  db
    .insertInto('claim_runs')
    .columns(['run_id', 'claim_id'])
    .expression(
      db
        .selectFrom('workflow_runs')
        .select(['id', sql<string>`${claimId}::uuid`.as('claim_id')])
        .where('id', '=', runId)
        .where(
          'agency_id',
          '=',
          db.selectFrom('claims').select('agency_id').where('id', '=', claimId)
        )
    )
    .onConflict((oc) => oc.column('run_id').doNothing())
    .execute();

const reopenDraft = async (
  tx: Db,
  boss: RunQueueClient,
  runId: string,
  claimId: string,
  reportKey: string | null
) => {
  const claim = await agencyClaim(tx, runId, claimId);
  const report =
    reportKey === null
      ? null
      : sourceReport(tx, runId, reportKey).where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('claims as o')
                .select('o.id')
                .whereRef('o.import_report_id', '=', 'r.id')
                .where('o.id', '<>', claim.id)
            )
          )
        );
  const { rows } = await sql<{ id: string }>`
    with old as (select cycle_run_id from claims where id = ${claim.id} for update),
    reopened as (
      update claims set
        status = 'draft',
        cycle_run_id = null,
        import_report_id = coalesce(${report ?? sql`null::uuid`}, import_report_id),
        updated_at = now()
      where id = ${claim.id}
    )
    select r.id from workflow_runs r
    where r.id <> ${runId}
      and r.status in (${sql.join(ACTIVE_RUN_STATUSES)})
      and (
        r.id in (select cr.run_id from claim_runs cr where cr.claim_id = ${claim.id})
        or r.id = (select cycle_run_id from old)
      )`.execute(tx);
  await linkRun(tx, runId, claim.id);
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    rows.map((r) => cancel(r.id))
  );
  return claim.id;
};

const coverageKey = (c: NewClaim['coverages'][number]) =>
  `${c.payer.toLowerCase()}\u0000${(c.memberId ?? '').toLowerCase()}`;

const uniqueBy = <T>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && Boolean(seen.add(key(item))));
};

const replaceClaimRows = async (db: Db, runId: string, claimId: string, c: NewClaim) => {
  await db
    .with('lines', (q) => q.deleteFrom('claim_lines').where('claim_id', '=', claimId))
    .with('coverages', (q) => q.deleteFrom('claim_coverages').where('claim_id', '=', claimId))
    .deleteFrom('claim_diagnoses')
    .where('claim_id', '=', claimId)
    .execute();
  if (c.lines.length) {
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
  }
  const coverages = uniqueBy(c.coverages, coverageKey);
  if (coverages.length) {
    await db
      .insertInto('claim_coverages')
      .values(
        coverages.map((cov, i) => ({
          claim_id: claimId,
          agency_id: runAgency(db, runId),
          position: i + 1,
          payer_name: cov.payer,
          payer_id: directoryPayer(db, runId, cov),
          payer_code: cov.payerCode,
          member_id: cov.memberId,
          group_id: cov.groupId,
          relationship: cov.relationship,
          insured_first_name: cov.insuredFirstName,
          insured_last_name: cov.insuredLastName
        }))
      )
      .execute();
  }
  const diagnoses = [...new Set(c.details.diagnoses)].slice(0, DIAGNOSIS_LIMIT);
  if (diagnoses.length) {
    await db
      .insertInto('claim_diagnoses')
      .values(diagnoses.map((code, i) => ({ claim_id: claimId, position: i + 1, code })))
      .execute();
  }
};

const signalClaim = async (tx: Db, boss: RunQueueClient, agencyId: string, claimId: string) => {
  const key = claimSignalKey(claimId);
  await tx
    .insertInto('signals')
    .values({ agency_id: agencyId, key, received: 1 })
    .onConflict((oc) =>
      oc
        .columns(['agency_id', 'key'])
        .doUpdateSet({ received: sql`signals.received + 1`, updated_at: sql`now()` })
    )
    .execute();
  const waiting = await tx
    .selectFrom('workflow_runs')
    .select(['id', sql<string>`state -> 'suspension' ->> 'id'`.as('wait_id')])
    .where('agency_id', '=', agencyId)
    .where('wait_key', '=', key)
    .where('status', '=', 'suspended')
    .execute();
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    waiting.map((r) => resume(r.id, r.wait_id, { payload: null }))
  );
};

const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;

const PAYMENT_KINDS = ['response', 'refunded'] as const;

const adjustmentsOf = sql<Adjustment[]>`coalesce((
  select json_agg(json_build_object('group', a.group_code, 'reason', a.reason_code, 'cents', a.amount_cents) order by a.position)
  from claim_event_adjustments a where a.event_id = e.id
), '[]'::json)`;

export const createClaimStore = (
  db: Db,
  blobs: Blobs,
  boss: RunQueueClient,
  clearinghouseFor: (agencyId: string) => Promise<Clearinghouse | null> = async () => null
): ClaimStore => {
  const store: ClaimStore = {
    statementData: async (runId, claimId) => {
      const row = await db
        .selectFrom('claims as c')
        .innerJoin('patients as p', 'p.id', 'c.patient_id')
        .leftJoin('billing_profiles as b', 'b.agency_id', 'c.agency_id')
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
          'b.phone',
          'b.time_zone'
        ])
        .where('c.id', '=', isUuid(claimId) ? claimId : null)
        .where('c.agency_id', '=', runAgency(db, runId))
        .executeTakeFirst();
      if (!row) throw new Error(`Claim ${claimId} does not exist`);
      const [lines, payments] = await Promise.all([
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
          .select([
            payerName.as('payer'),
            'e.paid_cents',
            'e.adjusted_cents',
            'e.paid_on',
            'e.created_at'
          ])
          .where('e.claim_id', '=', row.id)
          .where('e.kind', 'in', PAYMENT_KINDS)
          .where((eb) => eb.or([eb('e.paid_cents', '<>', 0), eb('e.adjusted_cents', '<>', 0)]))
          .orderBy('e.created_at')
          .orderBy('e.id')
          .execute()
      ]);
      const paid = payments.map((r) => ({
        date: r.paid_on ?? day(r.created_at),
        from: r.payer ?? 'Patient',
        paidCents: r.paid_cents,
        adjustedCents: r.adjusted_cents
      }));
      return {
        agency:
          row.organization_name === null || row.phone === null || row.time_zone === null
            ? null
            : {
                name: row.organization_name,
                addressLine: row.agency_address,
                city: row.agency_city,
                state: row.agency_state,
                postalCode: row.agency_postal_code,
                phone: row.phone,
                timeZone: row.time_zone
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
        payments: paid,
        balanceCents: paid.reduce((b, p) => b - p.paidCents - p.adjustedCents, row.total_cents)
      };
    },

    saveStatement: async (runId, claimId, sourceKey, { number, count, pdf }) => {
      const claim = await agencyClaim(db, runId, claimId);
      const document = await blobs.putBytes(
        statementKey(claim.agency_id, claim.id, number, sourceKey),
        pdf,
        'application/pdf'
      );
      await db
        .insertInto('claim_events')
        .values({
          claim_id: claim.id,
          kind: 'statement',
          note: `Patient statement ${number} of ${count}`,
          document: JSON.stringify(document),
          source_key: sourceKey
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
    },

    openDraft: (runId, sourceKey, d) =>
      db.transaction().execute(async (tx) => {
        if (d.claimId !== null) {
          return {
            id: await reopenDraft(tx, boss, runId, d.claimId, d.reportKey),
            duplicate: false
          };
        }
        const id = await insertDraft(tx, runId, sourceKey, d);
        if (id) {
          await linkRun(tx, runId, id);
          return { id, duplicate: false };
        }
        const existing = await tx
          .selectFrom('claims')
          .select(['id', 'source_key'])
          .where('agency_id', '=', runAgency(tx, runId))
          .where((eb) =>
            eb.or([
              eb('source_key', '=', sourceKey),
              ...(d.pcrNumber ? [eb('pcr_number', '=', d.pcrNumber)] : [])
            ])
          )
          .orderBy(sql`source_key = ${sourceKey}`, 'desc')
          .executeTakeFirstOrThrow();
        await linkRun(tx, runId, existing.id);
        return { id: existing.id, duplicate: existing.source_key !== sourceKey };
      }),

    assignPatient: async (runId, claimId, _sourceKey, patientId) => {
      const claim = await agencyClaim(db, runId, claimId);
      const patient = db
        .selectFrom('patients')
        .select('id')
        .where('id', '=', isUuid(patientId) ? patientId : null)
        .where('agency_id', '=', claim.agency_id);
      const { numUpdatedRows } = await db
        .updateTable('claims')
        .set({ patient_id: patient, updated_at: sql`now()` })
        .where('id', '=', claim.id)
        .where((eb) =>
          eb.and([
            eb.exists(patient),
            eb.or([eb('status', '=', 'draft'), eb('patient_id', '=', patient)])
          ])
        )
        .executeTakeFirst();
      if (!numUpdatedRows) {
        throw new Error(`Patient ${patientId} does not exist or claim ${claimId} is not a draft`);
      }
    },

    saveClaim: async (runId, claimId, _sourceKey, c) => {
      const claim = await agencyClaim(db, runId, claimId);
      await db.transaction().execute(async (tx) => {
        const { numUpdatedRows } = await tx
          .updateTable('claims')
          .set({ ...claimValues(c), updated_at: sql`now()` })
          .where('id', '=', claim.id)
          .where('status', '=', 'draft')
          .executeTakeFirst();
        if (numUpdatedRows) await replaceClaimRows(tx, runId, claim.id, c);
      });
    },

    claimCheck: async (runId, claimId) => {
      if (!isUuid(claimId)) return null;
      const run = await runAgency(db, runId).executeTakeFirst();
      return run ? findClaimCheck(db, run.agency_id, claimId) : null;
    },

    patchClaim: (runId, claimId, sourceKey, { coverage, ...patch }) =>
      db.transaction().execute(async (tx) => {
        const claim = await agencyClaim(tx, runId, claimId);
        const edited = await applyClaimEdit(
          tx,
          claim.agency_id,
          claim.id,
          { ...patch, coverages: coverage ? [{ ...coverage, groupId: null }] : [] },
          { sourceKey, createdBy: null }
        );
        if (edited) await signalClaim(tx, boss, claim.agency_id, claim.id);
      }),

    setStatus: async (runId, claimId, _sourceKey, status, signalsSeen) => {
      const claim = await agencyClaim(db, runId, claimId);
      const { rows } = await sql<{ received: number }>`
      with current as (
        select coalesce(max(received), 0) as received from signals
        where agency_id = ${claim.agency_id} and key = ${claimSignalKey(claim.id)}
      ), changed as (
        update claims set status = ${status}, updated_at = now()
        where id = ${claim.id}
          and status <> ${status}
          and status not in (${sql.join(['draft', ...CLOSED_CLAIM_STATUSES])})
          and (select received from current) = ${signalsSeen}
        returning id
      )
      select received from current`.execute(db);
      return Number(rows[0]?.received ?? 0) === signalsSeen ? 'set' : 'stale';
    },

    noteRevision: async (runId, claimId, sourceKey, report) => {
      const claim = await agencyClaim(db, runId, claimId);
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
      const row = await db
        .selectFrom('claims as c')
        .leftJoin('import_reports as r', 'r.id', 'c.import_report_id')
        .select([
          'c.status',
          sql<string | null>`r.report ->> 'bucket'`.as('bucket'),
          sql<string | null>`r.report ->> 'key'`.as('key')
        ])
        .where('c.id', '=', claim.id)
        .executeTakeFirstOrThrow();
      return {
        status: row.status,
        previous: row.bucket && row.key ? { bucket: row.bucket, key: row.key } : null
      };
    },

    attachCycle: async (runId, claimId, _sourceKey, cycleRunId) => {
      const claim = await agencyClaim(db, runId, claimId);
      await db.transaction().execute(async (tx) => {
        const cycle = isUuid(cycleRunId)
          ? await tx
              .selectFrom('workflow_runs')
              .select('id')
              .where('id', '=', cycleRunId)
              .where('agency_id', '=', claim.agency_id)
              .executeTakeFirst()
          : undefined;
        if (!cycle) throw new Error(`Run ${cycleRunId} does not exist`);
        const { numUpdatedRows } = await tx
          .updateTable('claims as c')
          .set({
            cycle_run_id: cycle.id,
            status: sql`case when c.status = ${DRAFT} then ${REVIEWABLE} else c.status end`,
            updated_at: sql`now()`
          })
          .where('c.id', '=', claim.id)
          .where((eb) =>
            eb.or([
              eb('c.cycle_run_id', 'is', null),
              eb('c.cycle_run_id', '=', cycle.id),
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('workflow_runs as r')
                    .select('r.id')
                    .whereRef('r.id', '=', 'c.cycle_run_id')
                    .where('r.status', 'not in', TERMINAL_RUN_STATUSES)
                )
              )
            ])
          )
          .executeTakeFirst();
        if (!numUpdatedRows) throw new Error(`Claim ${claimId} already has an active payer cycle`);
        await linkRun(tx, cycle.id, claim.id);
      });
    },

    ledger: async (runId, claimId) => {
      const claim = isUuid(claimId)
        ? await db
            .selectFrom('claims as c')
            .leftJoin('patients as p', 'p.id', 'c.patient_id')
            .select((eb) => [
              'c.id',
              'c.total_cents',
              'c.pcr_number',
              'p.first_name',
              'p.last_name',
              eb
                .selectFrom('signals as s')
                .select('s.received')
                .whereRef('s.agency_id', '=', 'c.agency_id')
                .where('s.key', '=', claimSignalKey(claimId))
                .as('received')
            ])
            .where('c.id', '=', claimId)
            .where('c.agency_id', '=', runAgency(db, runId))
            .executeTakeFirst()
        : undefined;
      if (!claim) return null;
      const patient = claim.first_name === null ? null : `${claim.first_name} ${claim.last_name}`;
      const [coverages, events] = await Promise.all([
        db
          .selectFrom('claim_coverages as cc')
          .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
          .select(['cc.id', payerName.as('payer'), 'dp.claim_filing as claimFiling'])
          .where('cc.claim_id', '=', claim.id)
          .orderBy('cc.position')
          .execute(),
        db
          .selectFrom('claim_events as e')
          .select([
            'e.kind',
            'e.coverage_id',
            'e.paid_cents',
            'e.adjusted_cents',
            'e.payer_claim_number',
            'e.paid_on',
            'e.note',
            adjustmentsOf.as('adjustments'),
            'e.created_at'
          ])
          .where('e.claim_id', '=', claim.id)
          .orderBy('e.created_at')
          .orderBy('e.id')
          .execute()
      ]);
      return {
        totalCents: claim.total_cents,
        signalsSeen: claim.received ?? 0,
        reference: [claim.pcr_number, patient].filter(Boolean).join(' · '),
        coverages,
        events: events.map((e) => ({
          kind: e.kind,
          coverageId: e.coverage_id,
          paidCents: e.paid_cents,
          adjustedCents: e.adjusted_cents,
          payerClaimNumber: e.payer_claim_number,
          paidOn: e.paid_on,
          adjustments: e.adjustments,
          note: e.note,
          at: new Date(e.created_at).toISOString()
        }))
      };
    },

    recordEvent: async (runId, claimId, sourceKey, e) => {
      const claim = await agencyClaim(db, runId, claimId);
      await db
        .insertInto('claim_events')
        .values({
          claim_id: claim.id,
          kind: e.kind,
          coverage_id: e.coverageId,
          note: e.note,
          payer_claim_number: e.coverageId === null ? null : e.payerClaimNumber,
          source_key: sourceKey
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
    },

    closeClaim: async (runId, claimId, sourceKey, requested) => {
      const claim = await agencyClaim(db, runId, claimId);
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
        await tx
          .deleteFrom('signals')
          .where('agency_id', '=', claim.agency_id)
          .where('key', '=', claimSignalKey(claim.id))
          .execute();
      });
    },

    submission: async (runId, claimId, coverageId) => {
      const run = await runAgency(db, runId).executeTakeFirst();
      if (!run || !isUuid(claimId)) throw new Error(`Claim ${claimId} does not exist`);
      const [profile, row, ledger] = await Promise.all([
        findProfile(db, run.agency_id),
        findReadyClaim(db, run.agency_id, claimId),
        store.ledger(runId, claimId)
      ]);
      return {
        submitter: profile ? toSubmitter(profile) : null,
        pending: row && ledger ? pendingClaim(row, ledger.events, coverageId) : null
      };
    },

    saveSubmission: (runId, claimId, sourceKey, file) =>
      db.transaction().execute(async (tx) => {
        const claim = await agencyClaim(tx, runId, claimId);
        const filed = await tx
          .selectFrom('claim_events as e')
          .innerJoin('claim_batches as b', 'b.id', 'e.batch_id')
          .select('b.control_number')
          .where('e.claim_id', '=', claim.id)
          .where('e.source_key', '=', sourceKey)
          .executeTakeFirst();
        if (filed) return { controlNumber: filed.control_number };
        const locked = await lockReadyClaim(tx, claim.agency_id, claim.id);
        if (!locked) return 'stale';
        const controlNumber = await allocateControlNumber(tx, claim.agency_id);
        if (controlNumber === null) return 'exhausted';
        const id = randomUUID();
        const document = await blobs.putBytes(
          batchKey(claim.agency_id, id, controlNumber),
          new TextEncoder().encode(file.build(controlNumber)),
          BATCH_CONTENT_TYPE
        );
        await insertBatch(tx, {
          id,
          agencyId: claim.agency_id,
          controlNumber,
          totalCents: file.totalCents,
          production: file.production,
          document,
          createdBy: null
        });
        await insertSubmissionEvent(
          tx,
          { batchId: id, note: `837P file #${controlNumber}`, createdBy: null, sourceKey },
          {
            claimId: claim.id,
            kind: file.resubmission ? 'resubmitted' : 'submitted',
            coverageId: file.coverageId
          }
        );
        await markSubmitted(tx, claim.id);
        return { controlNumber };
      }),

    linkRun: async (runId, claimId) => {
      const claim = await agencyClaim(db, runId, claimId);
      await linkRun(db, runId, claim.id);
    },

    sendClaimFile: async (runId, claimId, controlNumber) => {
      const claim = await agencyClaim(db, runId, claimId);
      const batch = await db
        .selectFrom('claim_batches')
        .select(['id', 'document', 'sent_as'])
        .where('agency_id', '=', claim.agency_id)
        .where('control_number', '=', controlNumber)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('claim_events as e')
              .select('e.id')
              .whereRef('e.batch_id', '=', 'claim_batches.id')
              .where('e.claim_id', '=', claimId)
          )
        )
        .executeTakeFirst();
      if (!batch) throw new Error(`No 837P file #${controlNumber} for claim ${claimId}`);
      if (batch.sent_as) return { sentAs: batch.sent_as };
      const clearinghouse = await clearinghouseFor(claim.agency_id);
      if (!clearinghouse) return 'manual';
      const name = await clearinghouse.submitClaims(
        exchangeFileName('claims', controlNumber, batch.id),
        await blobs.getBytes(batch.document as BlobRef)
      );
      await db
        .updateTable('claim_batches')
        .set({ sent_at: sql`now()`, sent_as: name })
        .where('id', '=', batch.id)
        .where('sent_as', 'is', null)
        .execute();
      return { sentAs: name };
    }
  };
  return store;
};
