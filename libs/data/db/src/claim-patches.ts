import type { Address, ClaimPatch, CoveragePatch, Location } from '@ugula/billing';
import { sql } from 'kysely';
import type { Db } from './schema.ts';

export type CoverageEdit = CoveragePatch & { groupId: string | null };

export type ClaimEdit = Omit<ClaimPatch, 'coverage'> & { coverages: CoverageEdit[] };

type EditEvent = { sourceKey: string | null; createdBy: string | null };

const defined = <T extends Record<string, unknown>>(values: T) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Partial<T>;

const addressValues = (prefix: 'pickup' | 'destination', a: Location | null) =>
  a && {
    [`${prefix}_address_line`]: a.addressLine,
    [`${prefix}_city`]: a.city,
    [`${prefix}_state`]: a.state,
    [`${prefix}_postal_code`]: a.postalCode
  };

const claimValues = (e: ClaimEdit) =>
  defined({
    service_date: e.serviceDate ?? undefined,
    trip_type: e.tripType ?? undefined,
    level: e.level ?? undefined,
    emergency: e.emergency ?? undefined,
    loaded_miles: e.loadedMiles ?? undefined,
    origin_code: e.originDestination?.[0],
    destination_code: e.originDestination?.[1],
    ...addressValues('pickup', e.pickup),
    ...addressValues('destination', e.destination),
    destination_name: e.destination ? e.destination.name : undefined,
    total_cents: e.lines ? e.lines.reduce((sum, l) => sum + l.totalCents, 0) : undefined
  });

const updateClaim = async (tx: Db, claimId: string, e: ClaimEdit) => {
  const values = claimValues(e);
  if (!Object.keys(values).length) return;
  await tx
    .updateTable('claims')
    .set({ ...values, updated_at: sql`now()` })
    .where('id', '=', claimId)
    .execute();
};

const updatePatientAddress = (tx: Db, tenantId: string, claimId: string, a: Address) =>
  tx
    .updateTable('patients')
    .set({
      address_line: a.addressLine,
      city: a.city,
      state: a.state,
      postal_code: a.postalCode,
      updated_at: sql`now()`
    })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', tx.selectFrom('claims').select('patient_id').where('id', '=', claimId))
    .execute();

const replaceDiagnoses = (tx: Db, claimId: string, codes: string[]) =>
  tx
    .with('cleared', (q) => q.deleteFrom('claim_diagnoses').where('claim_id', '=', claimId))
    .insertInto('claim_diagnoses')
    .values(codes.map((code, i) => ({ claim_id: claimId, position: i + 1, code })))
    .execute();

const replaceLines = async (tx: Db, claimId: string, lines: NonNullable<ClaimEdit['lines']>) => {
  await tx.deleteFrom('claim_lines').where('claim_id', '=', claimId).execute();
  if (!lines.length) return;
  await tx
    .insertInto('claim_lines')
    .values(
      lines.map((l, i) => ({
        claim_id: claimId,
        position: i + 1,
        code: l.code,
        units: l.units,
        unit_cents: l.unitCents,
        total_cents: l.totalCents
      }))
    )
    .execute();
};

const updateCoverages = (tx: Db, tenantId: string, claimId: string, edits: CoverageEdit[]) =>
  sql`
    update claim_coverages cc set
      payer_id = coalesce(
        (select p.id from payers p where p.id = v.payer_id and p.tenant_id = ${tenantId}),
        cc.payer_id
      ),
      member_id = coalesce(v.member_id, cc.member_id),
      group_id = coalesce(v.group_id, cc.group_id),
      relationship = coalesce(v.relationship, cc.relationship),
      insured_first_name = coalesce(v.insured_first_name, cc.insured_first_name),
      insured_last_name = coalesce(v.insured_last_name, cc.insured_last_name)
    from (values ${sql.join(
      edits.map(
        (c) =>
          sql`(${c.coverageId}::uuid, ${c.payerId}::uuid, ${c.memberId}::text, ${c.groupId}::text, ${c.relationship}::text, ${c.insuredFirstName}::text, ${c.insuredLastName}::text)`
      )
    )}) as v (id, payer_id, member_id, group_id, relationship, insured_first_name, insured_last_name)
    where cc.id = v.id and cc.claim_id = ${claimId}`.execute(tx);

const removeCoverages = async (tx: Db, claimId: string, ids: string[]) => {
  await tx
    .deleteFrom('claim_coverages')
    .where('claim_id', '=', claimId)
    .where('id', 'in', ids)
    .execute();
  await sql`
    update claim_coverages cc set position = r.position
    from (
      select id, row_number() over (order by position) as position
      from claim_coverages where claim_id = ${claimId}
    ) r
    where cc.id = r.id and cc.position <> r.position`.execute(tx);
};

const insertCoverage = (
  tx: Db,
  tenantId: string,
  claimId: string,
  c: NonNullable<ClaimEdit['newCoverage']>
) =>
  tx
    .insertInto('claim_coverages')
    .columns([
      'tenant_id',
      'claim_id',
      'position',
      'payer_name',
      'payer_id',
      'member_id',
      'relationship',
      'insured_first_name',
      'insured_last_name'
    ])
    .expression(
      tx
        .selectFrom('payers as p')
        .select((eb) => [
          'p.tenant_id',
          sql<string>`${claimId}::uuid`.as('claim_id'),
          eb
            .selectFrom('claim_coverages')
            .select(sql<number>`coalesce(max(position), 0) + 1`.as('position'))
            .where('claim_id', '=', claimId)
            .as('position'),
          'p.name',
          'p.id',
          sql<string | null>`${c.memberId}::text`.as('member_id'),
          sql<string>`${c.relationship}::text`.as('relationship'),
          sql<string | null>`${c.insuredFirstName}::text`.as('insured_first_name'),
          sql<string | null>`${c.insuredLastName}::text`.as('insured_last_name')
        ])
        .where('p.id', '=', c.payerId)
        .where('p.tenant_id', '=', tenantId)
    )
    .execute();

const logEdit = async (tx: Db, claimId: string, note: string | null, event: EditEvent) =>
  (await tx
    .insertInto('claim_events')
    .values({
      claim_id: claimId,
      kind: 'edited',
      note: note ?? 'Claim data edited',
      created_by: event.createdBy,
      source_key: event.sourceKey
    })
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const applyClaimEdit = async (
  tx: Db,
  tenantId: string,
  claimId: string,
  edit: ClaimEdit,
  event: EditEvent
) => {
  if (!(await logEdit(tx, claimId, edit.note, event))) return false;
  await updateClaim(tx, claimId, edit);
  if (edit.patientAddress) await updatePatientAddress(tx, tenantId, claimId, edit.patientAddress);
  if (edit.diagnoses?.length) await replaceDiagnoses(tx, claimId, edit.diagnoses);
  if (edit.lines) await replaceLines(tx, claimId, edit.lines);
  const updates = edit.coverages.filter((c) => !c.remove);
  const removed = edit.coverages.filter((c) => c.remove).map((c) => c.coverageId);
  if (updates.length) await updateCoverages(tx, tenantId, claimId, updates);
  if (removed.length) await removeCoverages(tx, claimId, removed);
  if (edit.newCoverage) await insertCoverage(tx, tenantId, claimId, edit.newCoverage);
  return true;
};
