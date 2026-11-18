import { CLAIM_STATUSES, type ClaimStatus, dailyNumberOf, nameKey } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { escapeLike } from '../../shared/search.ts';
import type { ClaimSort } from './schemas.ts';

export type ClaimFilters = PageRequest<ClaimSort> & {
  status: readonly ClaimStatus[];
  firstName?: string | undefined;
  lastName?: string | undefined;
  birthDate?: string | undefined;
  number?: string | undefined;
  patientId?: string | undefined;
};

const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;

const claimRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .innerJoin('encounters as e', 'e.id', 'c.encounter_id')
    .select((eb) => [
      'c.id',
      'c.number',
      'p.number as patient_number',
      'e.pcr_number',
      'e.number as encounter_number',
      'c.level',
      'c.total_cents',
      'c.service_date',
      'c.status',
      'c.created_at',
      'c.patient_first_name as first_name',
      'c.patient_last_name as last_name',
      sql<string[]>`array(${eb
        .selectFrom('claim_coverages as cc')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select(payerName.as('payer'))
        .whereRef('cc.claim_id', '=', 'c.id')
        .orderBy('cc.position')})`.as('payers')
    ])
    .where('c.agency_id', '=', agencyId);

const claimOrder = () => ({
  created: sql.ref('c.created_at'),
  number: sql.ref('c.number'),
  service: sql.ref('c.service_date'),
  patient: sql`lower(p.last_name || ' ' || p.first_name)`,
  pcr: sql.ref('e.pcr_number'),
  encounter: sql.ref('e.number'),
  total: sql.ref('c.total_cents'),
  status: sql`array_position(array[${sql.join(CLAIM_STATUSES.map((s) => sql.lit(s)))}]::text[], c.status::text)`
});

const claimFacets = () => ({
  status: { value: sql.ref('c.status') }
});

type ClaimFacet = keyof ReturnType<typeof claimFacets>;

const claimIds = (db: Db, agencyId: string, f: ClaimFilters, except?: ClaimFacet) => {
  let q = db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .innerJoin('encounters as e', 'e.id', 'c.encounter_id')
    .select('c.id')
    .where('c.agency_id', '=', agencyId);
  if (f.patientId) q = q.where('c.patient_id', '=', f.patientId);
  if (f.firstName) {
    q = q.where(sql`lower(p.first_name)`, 'like', `${escapeLike(f.firstName.toLowerCase())}%`);
  }
  const lastName = f.lastName ? nameKey(f.lastName) : '';
  if (lastName) q = q.where('p.last_name_key', 'like', `${escapeLike(lastName)}%`);
  if (f.birthDate) q = q.where('p.birth_date', '=', f.birthDate);
  if (f.number) {
    const text = f.number;
    const n = dailyNumberOf(text);
    q = q.where((eb) =>
      eb.or([
        eb('e.pcr_number', '=', text),
        ...(n === null
          ? []
          : [eb('c.number', '=', n), eb('p.number', '=', n), eb('e.number', '=', n)])
      ])
    );
  }
  return whereFacets(q, claimFacets(), f, except);
};

export const searchClaims = async (db: Db, agencyId: string, f: ClaimFilters) => {
  const [page, facets] = await Promise.all([
    paged(claimIds(db, agencyId, f), f, claimOrder(), sql.ref('c.id')),
    facetCounts((except) => claimIds(db, agencyId, f, except), claimFacets())
  ]);
  const ids = page.items.map((r) => r.id);
  const rows = ids.length ? await claimRows(db, agencyId).where('c.id', 'in', ids).execute() : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { ...page, items: ids.flatMap((id) => byId.get(id) ?? []), facets };
};

export const findClaim = (db: Db, agencyId: string, id: string) =>
  claimRows(db, agencyId)
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('import_reports as ir')
          .innerJoin('imports as i', 'i.id', 'ir.import_id')
          .select(['i.id', 'i.file_name'])
          .whereRef('ir.encounter_id', '=', 'e.id')
          .orderBy('ir.created_at', 'desc')
          .orderBy('ir.id', 'desc')
          .limit(1)
          .as('i'),
      (join) => join.onTrue()
    )
    .leftJoin('users as reviewer', 'reviewer.id', 'c.reviewed_by')
    .select((eb) => [
      'c.revision',
      'c.reviewed_at',
      'c.review_note',
      sql<string | null>`nullif(concat_ws(' ', reviewer.first_name, reviewer.last_name), '')`.as(
        'reviewed_by'
      ),
      'i.id as import_id',
      'i.file_name as import_file_name',
      'e.revision as encounter_revision',
      'e.data as encounter',
      'c.classification',
      'c.is_emergency',
      'c.loaded_miles',
      'c.origin_code',
      'c.destination_code',
      'c.transport_reason',
      'c.condition_codes',
      'c.weight_pounds',
      'c.reasons',
      'c.patient_id',
      'c.patient_birth_date as birth_date',
      'c.patient_sex as sex',
      'c.patient_address_line as address_line',
      'c.patient_city as city',
      'c.patient_state as state',
      'c.patient_postal_code as postal_code',
      'c.pickup_name',
      'c.pickup_address_line',
      'c.pickup_city',
      'c.pickup_state',
      'c.pickup_postal_code',
      'c.destination_name',
      'c.destination_address_line',
      'c.destination_city',
      'c.destination_state',
      'c.destination_postal_code',
      'c.prior_authorization',
      'c.is_signature_on_file',
      'c.note',
      jsonArrayFrom(
        eb
          .selectFrom('claim_coverages as cc')
          .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
          .select([
            'cc.id',
            'cc.position',
            payerName.as('payer'),
            'cc.payer_id',
            'dp.claim_filing',
            'cc.member_id',
            'cc.group_id',
            'cc.relationship',
            'cc.insured_first_name',
            'cc.insured_last_name'
          ])
          .whereRef('cc.claim_id', '=', 'c.id')
          .orderBy('cc.position')
      ).as('coverages'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_lines as l')
          .select([
            'l.position',
            'l.code',
            'l.modifiers',
            'l.units',
            'l.unit_cents',
            'l.total_cents'
          ])
          .whereRef('l.claim_id', '=', 'c.id')
          .orderBy('l.position')
      ).as('lines'),
      sql<string[]>`array(${eb
        .selectFrom('claim_diagnoses as d')
        .select('d.code')
        .whereRef('d.claim_id', '=', 'c.id')
        .orderBy('d.position')})`.as('diagnoses')
    ])
    .where('c.id', '=', id)
    .executeTakeFirst();
