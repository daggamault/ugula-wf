import { DIAGNOSIS_LIMIT, type NewClaim } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

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
