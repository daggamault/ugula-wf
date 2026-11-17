import { createHash, randomUUID } from 'node:crypto';
import {
  type Adjustment,
  CLAIM_STATUS_LABELS,
  CLOSED_CLAIM_STATUSES,
  type ClaimStatus,
  type ClaimStore,
  type ClaimTaskStore,
  type Clearinghouse,
  claimSignalKey,
  DIAGNOSIS_LIMIT,
  DOCUMENT_KINDS,
  type DraftClaim,
  documentContentTypeOf,
  exchangeFileName,
  isClosedStatus,
  isDenialRoute,
  isFacilityKind,
  type LineAdjudication,
  localDate,
  type NewClaim,
  type ResponsibleParty
} from '@ugula/billing';
import {
  ACTIVE_RUN_STATUSES,
  allocateControlNumber,
  applyClaimEdit,
  batchKey,
  type Db,
  documentationValues,
  type Failure,
  findClaimCheck,
  findProfile,
  findReadyClaim,
  insertBatch,
  insertSubmissionEvent,
  lockClaim,
  lockReadyClaim,
  logDenial,
  markSubmitted,
  nudgeClaim,
  pendingClaim,
  postClaimResponse,
  restartCycle,
  setClaimPayers,
  sqlExecutor,
  TERMINAL_RUN_STATUSES,
  toSubmitter
} from '@ugula/db';
import { cancel, enqueueRuns, type RunQueueClient } from '@ugula/run-queue';
import { type BlobRef, type BlobStore, importsPrefix } from '@ugula/storage';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

export const agencyClaim = async (db: Db, runId: string, claimId: string) =>
  (isUuid(claimId)
    ? await db
        .selectFrom('claims')
        .select(['id', 'agency_id'])
        .where('id', '=', claimId)
        .where('agency_id', '=', runAgency(db, runId))
        .executeTakeFirst()
    : undefined) ?? Promise.reject(new Error(`Claim ${claimId} does not exist`));

export const linkClaimRun = (db: Db, runId: string, claimId: string) =>
  db
    .insertInto('claim_runs')
    .columns(['agency_id', 'run_id', 'claim_id'])
    .expression(
      db
        .selectFrom('workflow_runs')
        .select(['agency_id', 'id', sql<string>`${claimId}::uuid`.as('claim_id')])
        .where('id', '=', runId)
        .where(
          'agency_id',
          '=',
          db.selectFrom('claims').select('agency_id').where('id', '=', claimId)
        )
    )
    .onConflict((oc) => oc.column('run_id').doNothing())
    .execute();

export const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;

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

const coverageKey = (c: NewClaim['coverages'][number]) =>
  `${c.payer.toLowerCase()}\u0000${(c.memberId ?? '').toLowerCase()}`;

const uniqueBy = <T>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && Boolean(seen.add(key(item))));
};

type ActiveCoverage = { id: string; payer_name: string; member_id: string | null };

const lowerOf = (s: string | null) => (s ?? '').toLowerCase();

export const planCoverages = (
  active: readonly ActiveCoverage[],
  coverages: readonly NewClaim['coverages'][number][]
) => {
  const free = new Map(active.map((a) => [a.id, a]));
  const take = (match: (a: ActiveCoverage) => boolean) => {
    const found = [...free.values()].find(match);
    if (found) free.delete(found.id);
    return found;
  };
  const samePayer = (a: ActiveCoverage, c: NewClaim['coverages'][number]) =>
    lowerOf(a.payer_name) === lowerOf(c.payer);
  const exact = coverages.map((c) =>
    take((a) => samePayer(a, c) && lowerOf(a.member_id) === lowerOf(c.memberId))
  );
  const kept = coverages.map((c, i) => exact[i] ?? take((a) => samePayer(a, c)));
  return {
    rows: coverages.map((coverage, i) => ({
      coverage,
      position: i + 1,
      id: kept[i]?.id ?? null
    })),
    trailing: [...free.values()].map((a, i) => ({ id: a.id, position: coverages.length + i + 1 }))
  };
};

const hasActivity = (db: Db) =>
  db
    .selectFrom('claim_events as e')
    .select('e.id')
    .whereRef('e.coverage_id', '=', sql.ref('claim_coverages.id'));

const sameCoverage = sql`cc.payer_id is not distinct from v.payer_id and lower(coalesce(cc.member_id, '')) = lower(coalesce(v.member_id, ''))`;

const keepIfSame = (column: string) =>
  sql`case when ${sameCoverage} then ${sql.ref(`cc.${column}`)} end`;

const updateCoverages = (
  db: Db,
  runId: string,
  claimId: string,
  rows: { id: string; position: number; coverage: NewClaim['coverages'][number] }[]
) =>
  sql`
    update claim_coverages cc set
      position = v.position,
      payer_name = v.payer_name,
      payer_id = v.payer_id,
      payer_code = v.payer_code,
      member_id = v.member_id,
      group_id = v.group_id,
      relationship = v.relationship,
      insured_first_name = v.insured_first_name,
      insured_last_name = v.insured_last_name,
      eligibility = ${keepIfSame('eligibility')},
      eligibility_note = ${keepIfSame('eligibility_note')},
      eligibility_checked_at = ${keepIfSame('eligibility_checked_at')},
      eligibility_requested_at = ${keepIfSame('eligibility_requested_at')},
      stay_kind = ${keepIfSame('stay_kind')},
      stay_admitted_on = ${keepIfSame('stay_admitted_on')},
      stay_discharged_on = ${keepIfSame('stay_discharged_on')}
    from (values ${sql.join(
      rows.map(
        ({ id, position, coverage: cov }) =>
          sql`(${id}::uuid, ${position}::smallint, ${cov.payer}::text, (${directoryPayer(db, runId, cov)})::uuid, ${cov.payerCode}::text, ${cov.memberId}::text, ${cov.groupId}::text, ${cov.relationship}::text, ${cov.insuredFirstName}::text, ${cov.insuredLastName}::text)`
      )
    )}) as v (id, position, payer_name, payer_id, payer_code, member_id, group_id, relationship, insured_first_name, insured_last_name)
    where cc.id = v.id and cc.claim_id = ${claimId}`.execute(db);

const moveCoverages = (db: Db, claimId: string, rows: { id: string; position: number }[]) =>
  sql`
    update claim_coverages cc set position = v.position
    from (values ${sql.join(rows.map((r) => sql`(${r.id}::uuid, ${r.position}::smallint)`))})
      as v (id, position)
    where cc.id = v.id and cc.claim_id = ${claimId}`.execute(db);

export const replaceClaimRows = async (db: Db, runId: string, claimId: string, c: NewClaim) => {
  const active = await db
    .with('lines', (q) => q.deleteFrom('claim_lines').where('claim_id', '=', claimId))
    .with('coverages', (q) =>
      q
        .deleteFrom('claim_coverages')
        .where('claim_id', '=', claimId)
        .where((eb) => eb.not(eb.exists(hasActivity(db))))
    )
    .with('diagnoses', (q) => q.deleteFrom('claim_diagnoses').where('claim_id', '=', claimId))
    .selectFrom('claim_coverages')
    .select(['id', 'payer_name', 'member_id'])
    .where('claim_id', '=', claimId)
    .where((eb) => eb.exists(hasActivity(db)))
    .orderBy('position')
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
  const { rows, trailing } = planCoverages(active, uniqueBy(c.coverages, coverageKey));
  const kept = rows.flatMap((r) => (r.id === null ? [] : [{ ...r, id: r.id }]));
  if (kept.length) await updateCoverages(db, runId, claimId, kept);
  if (trailing.length) await moveCoverages(db, claimId, trailing);
  const added = rows.filter((r) => r.id === null);
  if (added.length) {
    await db
      .insertInto('claim_coverages')
      .values(
        added.map(({ coverage: cov, position }) => ({
          claim_id: claimId,
          agency_id: runAgency(db, runId),
          position,
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

const sourceReport = (db: Db, runId: string, key: string) =>
  db
    .selectFrom('import_reports as r')
    .select('r.id')
    .where('r.agency_id', '=', runAgency(db, runId))
    .where('r.report_key', '=', key);

const claimValues = (c: NewClaim) => {
  const { serviceDate, pickup, destination, originDestination } = c.details;
  return {
    patient_id: c.patientId,
    pcr_number: c.pcrNumber,
    classification: c.classification,
    level: c.level,
    is_emergency: c.emergency,
    loaded_miles: c.loadedMiles,
    is_deceased: c.deceased,
    non_covered_miles: c.nonCoveredMiles,
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
  await linkClaimRun(tx, runId, claim.id);
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    rows.map((r) => cancel(r.id))
  );
  return claim.id;
};

const logOpened = (tx: Db, claimId: string, sourceKey: string, note: string) =>
  tx
    .insertInto('claim_events')
    .columns(['agency_id', 'claim_id', 'kind', 'note', 'source_key'])
    .expression((eb) =>
      eb
        .selectFrom('claims')
        .select([
          'agency_id',
          'id',
          sql.lit('opened').as('kind'),
          sql.val(note).as('note'),
          sql.val(sourceKey).as('source_key')
        ])
        .where('id', '=', claimId)
    )
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .execute();

export const createDraftStore = (
  db: Db,
  boss: RunQueueClient
): Pick<ClaimStore, 'openDraft' | 'classifyClaim' | 'assignPatient' | 'saveClaim'> => ({
  openDraft: (runId, sourceKey, d) =>
    db.transaction().execute(async (tx) => {
      if (d.claimId !== null) {
        const id = await reopenDraft(tx, boss, runId, d.claimId, d.reportKey);
        await logOpened(tx, id, sourceKey, 'Worked again from its report');
        return { id, duplicate: false };
      }
      const id = await insertDraft(tx, runId, sourceKey, d);
      if (id) {
        await linkClaimRun(tx, runId, id);
        await logOpened(
          tx,
          id,
          sourceKey,
          d.pcrNumber ? `From PCR ${d.pcrNumber}` : 'From an imported report'
        );
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
      await linkClaimRun(tx, runId, existing.id);
      return { id: existing.id, duplicate: existing.source_key !== sourceKey };
    }),

  classifyClaim: async (runId, claimId, _sourceKey, classification) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db
      .updateTable('claims')
      .set({ classification, updated_at: sql`now()` })
      .where('id', '=', claim.id)
      .where('status', '=', 'draft')
      .execute();
  },

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
  }
});

const DRAFT: ClaimStatus = 'draft';

export const statusNote = (status: ClaimStatus, reason: string | null) =>
  [`Moved to ${CLAIM_STATUS_LABELS[status]}`, reason].filter(Boolean).join(' · ');

const REVIEWABLE: ClaimStatus = 'needs_review';

const otherClaimRuns = (runId: string, claimId: string) =>
  sql<{ id: string }>`
    with recursive closing (id, parent_id) as (
      select id, parent_id from workflow_runs where id = ${runId}
      union all
      select r.id, r.parent_id from workflow_runs r join closing c on r.id = c.parent_id
    )
    select r.id from workflow_runs r
    where r.status in (${sql.join(ACTIVE_RUN_STATUSES)})
      and r.id not in (select id from closing)
      and (
        r.id in (select cr.run_id from claim_runs cr where cr.claim_id = ${claimId})
        or r.id = (select cycle_run_id from claims where id = ${claimId})
      )`;

export const createCycleStore = (
  db: Db,
  boss: RunQueueClient
): Pick<
  ClaimStore,
  | 'claimCheck'
  | 'patchClaim'
  | 'setStatus'
  | 'attachCycle'
  | 'closeClaim'
  | 'linkRun'
  | 'restartCycle'
> => ({
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
      if (edited) await nudgeClaim(tx, boss, claim.agency_id, claim.id);
    }),

  setStatus: (runId, claimId, sourceKey, status, signalsSeen, reason = null) =>
    db.transaction().execute(async (tx) => {
      const claim = await agencyClaim(tx, runId, claimId);
      await lockClaim(tx, claim.agency_id, claim.id);
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
        returning id, agency_id
      ), logged as (
        insert into claim_events (agency_id, claim_id, kind, note, source_key)
        select agency_id, id, 'decided', ${statusNote(status, reason)}, ${sourceKey} from changed
        on conflict (claim_id, source_key) do nothing
      )
      select received from current`.execute(tx);
      return Number(rows[0]?.received ?? 0) === signalsSeen ? 'set' : 'stale';
    }),

  attachCycle: async (runId, claimId, sourceKey, cycleRunId) => {
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
      const attached = await tx
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
        .returning(sql<ClaimStatus>`old.status`.as('was'))
        .executeTakeFirst();
      if (!attached) throw new Error(`Claim ${claimId} already has an active payer cycle`);
      if (attached.was === DRAFT) {
        await tx
          .insertInto('claim_events')
          .values({
            agency_id: claim.agency_id,
            claim_id: claim.id,
            kind: 'decided',
            note: statusNote(REVIEWABLE, 'The claim is built and its payer cycle started'),
            source_key: sourceKey
          })
          .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
          .execute();
      }
      await linkClaimRun(tx, cycle.id, claim.id);
      await nudgeClaim(tx, boss, claim.agency_id, claim.id);
    });
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
        .values({
          agency_id: claim.agency_id,
          claim_id: claim.id,
          kind: 'closed',
          note: status,
          source_key: sourceKey
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
      await tx
        .deleteFrom('signals')
        .where('agency_id', '=', claim.agency_id)
        .where('key', '=', claimSignalKey(claim.id))
        .execute();
      const { rows } = await otherClaimRuns(runId, claim.id).execute(tx);
      await enqueueRuns(
        boss,
        sqlExecutor(tx),
        rows.map((r) => cancel(r.id))
      );
    });
  },

  linkRun: async (runId, claimId) => {
    const claim = await agencyClaim(db, runId, claimId);
    await linkClaimRun(db, runId, claim.id);
  },

  restartCycle: async (runId, claimId) => {
    const claim = await agencyClaim(db, runId, claimId);
    const restarted = await db
      .transaction()
      .execute((tx) =>
        restartCycle(tx, boss, { agencyId: claim.agency_id, claimId: claim.id, exceptRunId: runId })
      );
    if (restarted.ok) return { status: 'started', cycleRunId: restarted.value.runId };
    if (restarted.failure.code === 'conflict') return refusedBy(restarted.failure);
    throw new Error(restarted.failure.message);
  }
});

const FACILITY: ResponsibleParty = 'facility';

export const createFacilityStore = (
  db: Db,
  boss: RunQueueClient
): Pick<ClaimStore, 'setResponsibility' | 'facilityDirectory'> => ({
  setResponsibility: async (runId, claimId, sourceKey, r) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db.transaction().execute(async (tx) => {
      const locked = await lockClaim(tx, claim.agency_id, claim.id);
      if (!locked) throw new Error(`Claim ${claimId} does not exist`);
      const recorded = await tx
        .selectFrom('claim_events')
        .select('id')
        .where('claim_id', '=', claim.id)
        .where('source_key', '=', sourceKey)
        .executeTakeFirst();
      if (recorded) return;
      if (isClosedStatus(locked.status)) throw new Error('The claim is already closed');
      const facility = r.party === FACILITY ? r.facilityId : null;
      if (r.party === FACILITY && !(facility && isUuid(facility))) {
        throw new Error('Choose the facility the claim is billed to');
      }
      if (
        facility &&
        !(await tx
          .selectFrom('facilities')
          .select('id')
          .where('id', '=', facility)
          .where('agency_id', '=', claim.agency_id)
          .executeTakeFirst())
      ) {
        throw new Error(`Facility ${facility} is not in the facility directory`);
      }
      await tx
        .insertInto('claim_events')
        .values({
          agency_id: claim.agency_id,
          claim_id: claim.id,
          kind: 'responsibility',
          note: r.note,
          source_key: sourceKey
        })
        .execute();
      await tx
        .updateTable('claims')
        .set({ facility_id: facility, updated_at: sql`now()` })
        .where('id', '=', claim.id)
        .execute();
      await nudgeClaim(tx, boss, claim.agency_id, claim.id);
    });
  },

  facilityDirectory: async (runId) =>
    (
      await db
        .selectFrom('facilities')
        .select(['id', 'name', 'kind', 'has_contract as contract'])
        .where('agency_id', '=', runAgency(db, runId))
        .orderBy('name')
        .execute()
    ).flatMap((f) => (isFacilityKind(f.kind) ? [{ ...f, kind: f.kind }] : []))
});

const adjustmentsOf = sql<Adjustment[]>`coalesce((
  select json_agg(json_build_object('group', a.group_code, 'reason', a.reason_code, 'cents', a.amount_cents) order by a.position)
  from claim_event_adjustments a where a.event_id = e.id
), '[]'::json)`;

const linesOf = sql<LineAdjudication[]>`coalesce((
  select json_agg(json_build_object(
    'line', l.line, 'code', l.code, 'modifiers', l.modifiers, 'paidCents', l.paid_cents, 'units', l.units::float8,
    'adjustments', coalesce((
      select json_agg(json_build_object('group', a.group_code, 'reason', a.reason_code, 'cents', a.amount_cents) order by a.position)
      from claim_event_line_adjustments a where a.event_id = l.event_id and a.line = l.line
    ), '[]'::json)
  ) order by l.line)
  from claim_event_lines l where l.event_id = e.id
), '[]'::json)`;

const REVIEW_LINE_WORKFLOW = 'billing.review-payer-file-line';

const remarksOf = sql<string[]>`coalesce((
  select json_agg(r.code order by r.position) from claim_event_remarks r where r.event_id = e.id
), '[]'::json)`;

export const createLedgerStore = (
  db: Db
): Pick<
  ClaimStore,
  'ledger' | 'recordEvent' | 'recordDecision' | 'noteRevision' | 'claimDocument'
> => ({
  noteRevision: async (runId, claimId, sourceKey, report) => {
    const claim = await agencyClaim(db, runId, claimId);
    if (
      !report.key.startsWith(importsPrefix(claim.agency_id)) ||
      report.key.split('/').includes('..')
    ) {
      throw new Error(`Blob ${report.key} is not one of this agency's imports`);
    }
    await db
      .insertInto('claim_events')
      .values({
        agency_id: claim.agency_id,
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
        'r.report_key as key'
      ])
      .where('c.id', '=', claim.id)
      .executeTakeFirstOrThrow();
    return {
      status: row.status,
      previous: row.bucket && row.key ? { bucket: row.bucket, key: row.key } : null
    };
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
            'c.facility_id',
            'c.service_date',
            'c.pickup_state',
            'p.first_name',
            'p.last_name',
            eb
              .selectFrom('signals as s')
              .select('s.received')
              .whereRef('s.agency_id', '=', 'c.agency_id')
              .where('s.key', '=', claimSignalKey(claimId))
              .as('received'),
            eb
              .exists(
                eb
                  .selectFrom('tasks as t')
                  .innerJoin('claim_runs as cr', 'cr.run_id', 't.run_id')
                  .innerJoin('workflow_runs as r', 'r.id', 't.run_id')
                  .innerJoin('graph_versions as v', 'v.id', 'r.graph_version_id')
                  .innerJoin('graphs as g', 'g.id', 'v.graph_id')
                  .select('t.id')
                  .whereRef('cr.claim_id', '=', 'c.id')
                  .where('t.status', '=', 'open')
                  .where('g.key', '=', REVIEW_LINE_WORKFLOW)
              )
              .as('pending_review')
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
        .select([
          'cc.id',
          payerName.as('payer'),
          'dp.claim_filing as claimFiling',
          'dp.correction_method as correctionMethod',
          'dp.appeal_days as appealDays',
          'dp.plan_type as planType'
        ])
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
          'e.route',
          adjustmentsOf.as('adjustments'),
          remarksOf.as('remarks'),
          linesOf.as('lines'),
          'e.created_at'
        ])
        .where('e.claim_id', '=', claim.id)
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute()
    ]);
    return {
      totalCents: claim.total_cents,
      facilityId: claim.facility_id,
      serviceDate: claim.service_date,
      pickupState: claim.pickup_state,
      pendingReview: claim.pending_review === true,
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
        remarks: e.remarks,
        lines: e.lines,
        note: e.note,
        route: e.route,
        at: new Date(e.created_at).toISOString()
      }))
    };
  },

  recordEvent: async (runId, claimId, sourceKey, e) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db
      .insertInto('claim_events')
      .values({
        agency_id: claim.agency_id,
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

  recordDecision: async (runId, claimId, sourceKey, d) => {
    const claim = await agencyClaim(db, runId, claimId);
    const decidedBy = d.decidedBy !== null && isUuid(d.decidedBy) ? d.decidedBy : null;
    await db
      .insertInto('claim_events')
      .values({
        agency_id: claim.agency_id,
        claim_id: claim.id,
        kind: 'decided',
        note: d.note,
        created_by_id: decidedBy
          ? db.selectFrom('users').select('id').where('id', '=', decidedBy)
          : null,
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  },

  claimDocument: async (runId, claimId, documentId) => {
    const claim = await agencyClaim(db, runId, claimId);
    const row = isUuid(documentId)
      ? await db
          .selectFrom('claim_documents')
          .select(['id', 'kind', 'signed_on', 'file_name'])
          .where('id', '=', documentId)
          .where('claim_id', '=', claim.id)
          .executeTakeFirst()
      : undefined;
    return row
      ? { id: row.id, kind: row.kind, signedOn: row.signed_on, fileName: row.file_name }
      : null;
  }
});

const day = (d: Date | string, timeZone: string | null) =>
  localDate(new Date(d), timeZone ?? 'UTC');

export const statementKey = (
  agencyId: string,
  claimId: string,
  number: number,
  sourceKey: string
) =>
  `statements/${agencyId}/${claimId}/${number}-${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}.pdf`;

const PAYMENT_KINDS = ['response', 'refunded', 'balance_protected'] as const;

export const createStatementStore = (
  db: Db,
  blobs: Pick<BlobStore, 'putBytes'>
): Pick<ClaimStore, 'statementData' | 'saveStatement'> => ({
  statementData: async (runId, claimId) => {
    const row = await db
      .selectFrom('claims as c')
      .innerJoin('patients as p', 'p.id', 'c.patient_id')
      .innerJoin('claim_balances as cb', 'cb.claim_id', 'c.id')
      .leftJoin('billing_profiles as b', 'b.agency_id', 'c.agency_id')
      .select([
        'c.id',
        'c.pcr_number',
        'c.total_cents',
        'cb.balance_cents',
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
        .selectFrom('claim_lines as l')
        .leftJoin('codes as d', (j) =>
          j.on('d.code_set', '=', 'hcpcs').onRef('d.code', '=', 'l.code')
        )
        .select(['l.code', 'l.units', 'l.unit_cents', 'l.total_cents', 'd.description'])
        .where('l.claim_id', '=', row.id)
        .orderBy('l.position')
        .execute(),
      db
        .selectFrom('claim_events as e')
        .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select([
          payerName.as('payer'),
          'e.kind',
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
      date: r.paid_on ?? day(r.created_at, row.time_zone),
      from:
        r.payer ??
        (r.kind === 'balance_protected' ? (row.organization_name ?? 'Agency') : 'Patient'),
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
        totalCents: l.total_cents,
        description: l.description
      })),
      totalCents: row.total_cents,
      payments: paid,
      balanceCents: row.balance_cents
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
        agency_id: claim.agency_id,
        claim_id: claim.id,
        kind: 'statement',
        note: `Patient statement ${number} of ${count}`,
        document: JSON.stringify(document),
        source_key: sourceKey
      })
      .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
      .execute();
  }
});

const BATCH_CONTENT_TYPE = 'application/edi-x12';

export const createSubmissionStore = (
  db: Db,
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>,
  readLedger: ClaimStore['ledger'],
  clearinghouseFor: (agencyId: string) => Promise<Clearinghouse | null>
): Pick<ClaimStore, 'submission' | 'saveSubmission' | 'sendClaimFile'> => ({
  submission: async (runId, claimId, coverageId) => {
    const run = await runAgency(db, runId).executeTakeFirst();
    if (!run || !isUuid(claimId)) throw new Error(`Claim ${claimId} does not exist`);
    const [profile, row, ledger] = await Promise.all([
      findProfile(db, run.agency_id),
      findReadyClaim(db, run.agency_id, claimId),
      readLedger(runId, claimId)
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
          agencyId: claim.agency_id,
          claimId: claim.id,
          kind: file.resubmission ? 'resubmitted' : 'submitted',
          coverageId: file.coverageId
        }
      );
      await markSubmitted(tx, claim.id);
      return { controlNumber };
    }),

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
});

type Blobs = Pick<BlobStore, 'getBytes' | 'putBytes'>;

const refused = (reason: string) => ({ status: 'refused', reason }) as const;

const refusedBy = (f: Failure) => refused(f.message);

const userOf = (id: string | null) => (id && isUuid(id) ? id : null);

export const uploadsOf = (agencyId: string) => `${importsPrefix(agencyId)}uploads/`;

export const documentKey = (agencyId: string, claimId: string, sourceKey: string, name: string) =>
  `documents/${agencyId}/${claimId}/${createHash('sha256').update(sourceKey).digest('hex').slice(0, 16)}/${name}`;

export const createClaimTaskStore = (
  db: Db,
  blobs: Blobs,
  boss: RunQueueClient
): ClaimTaskStore => ({
  setPayers: async (runId, claimId, payers) => {
    const claim = await agencyClaim(db, runId, claimId);
    const set = await db
      .transaction()
      .execute((tx) => setClaimPayers(tx, boss, claim.agency_id, claim.id, payers));
    return set.ok ? { status: 'saved' } : refusedBy(set.failure);
  },

  postPayment: async (runId, claimId, sourceKey, payment, postedBy) => {
    const claim = await agencyClaim(db, runId, claimId);
    const userId = userOf(postedBy);
    const { route, ...response } = payment;
    const posted = await db.transaction().execute(async (tx) => {
      const result = await postClaimResponse(tx, boss, claim.agency_id, claim.id, userId, {
        ...response,
        requestId: sourceKey,
        exactAdjustment: route !== null
      });
      if (result.ok && !result.value.duplicate && response.coverageId && isDenialRoute(route)) {
        await logDenial(tx, claim.agency_id, claim.id, userId, {
          coverageId: response.coverageId,
          route,
          note: response.note || 'Denied, as posted by hand',
          sourceKey: `${sourceKey}:denied`
        });
      }
      return result;
    });
    return posted.ok
      ? { status: 'posted', balanceCents: posted.value.balanceCents }
      : refusedBy(posted.failure);
  },

  addDocument: async (runId, claimId, sourceKey, d) => {
    const claim = await agencyClaim(db, runId, claimId);
    const { key } = d.file;
    if (!key.startsWith(uploadsOf(claim.agency_id)) || key.split('/').includes('..')) {
      throw new Error(`Blob ${key} is not one of this agency's uploads`);
    }
    const bytes = await blobs.getBytes(d.file);
    const contentType = documentContentTypeOf(bytes);
    if (!contentType) return refused('Upload the document as a PDF, PNG, JPEG or TIFF file');
    const fileName = key.split('/').at(-1) || 'document';
    const document = await blobs.putBytes(
      documentKey(claim.agency_id, claim.id, sourceKey, fileName),
      bytes,
      contentType
    );
    const addedBy = userOf(d.addedBy);
    return db.transaction().execute(async (tx) => {
      const locked = await lockClaim(tx, claim.agency_id, claim.id);
      if (!locked || isClosedStatus(locked.status)) return refused('Claim is already closed');
      const kept = await tx
        .selectFrom('claim_documents')
        .select('id')
        .where('claim_id', '=', claim.id)
        .where(sql<string>`document ->> 'key'`, '=', document.key)
        .executeTakeFirst();
      const { id } =
        kept ??
        (await tx
          .insertInto('claim_documents')
          .values({
            agency_id: claim.agency_id,
            claim_id: claim.id,
            kind: d.kind,
            file_name: fileName,
            document: JSON.stringify(document),
            signed_on: d.signedOn,
            uploaded_by_id: addedBy
          })
          .returning('id')
          .executeTakeFirstOrThrow());
      await tx
        .insertInto('claim_events')
        .values({
          agency_id: claim.agency_id,
          claim_id: claim.id,
          kind: 'document',
          note: `${DOCUMENT_KINDS[d.kind]} uploaded: ${fileName}`,
          created_by_id: addedBy,
          source_key: sourceKey
        })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
      return { status: 'added', documentId: id };
    });
  }
});

export const createClaimStore = (
  db: Db,
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>,
  boss: RunQueueClient,
  clearinghouseFor: (agencyId: string) => Promise<Clearinghouse | null> = async () => null
): ClaimStore => {
  const ledger = createLedgerStore(db);
  return {
    ...createDraftStore(db, boss),
    ...createStatementStore(db, blobs),
    ...ledger,
    ...createCycleStore(db, boss),
    ...createFacilityStore(db, boss),
    ...createSubmissionStore(db, blobs, ledger.ledger, clearinghouseFor)
  };
};
