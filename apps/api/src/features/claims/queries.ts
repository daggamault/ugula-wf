import { CLAIM_STATUSES, type ClaimStatus, dailyNumberOf, nameKey } from '@ugula/billing';
import { type Db, DOCUMENTATION_COLUMNS } from '@ugula/db';
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
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .select((eb) => [
      'c.id',
      'c.number',
      'p.number as patient_number',
      'c.pcr_number',
      eb
        .selectFrom('import_reports as er')
        .select('er.number')
        .whereRef('er.id', '=', 'c.import_report_id')
        .as('encounter_number'),
      'c.level',
      'c.total_cents',
      'c.service_date',
      'c.status',
      'c.created_at',
      'p.first_name',
      'p.last_name',
      sql<string[]>`array(${eb
        .selectFrom('claim_coverages as cc')
        .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
        .select(payerName.as('payer'))
        .whereRef('cc.claim_id', '=', 'c.id')
        .orderBy('cc.position')})`.as('payers')
    ])
    .where('c.agency_id', '=', agencyId);

const claimOrder = (db: Db) => ({
  created: sql.ref('c.created_at'),
  number: sql.ref('c.number'),
  service: sql.ref('c.service_date'),
  patient: sql`lower(p.last_name || ' ' || p.first_name)`,
  pcr: sql.ref('c.pcr_number'),
  encounter: db
    .selectFrom('import_reports as er')
    .select('er.number')
    .where('er.id', '=', sql.ref<string>('c.import_report_id')),
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
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .leftJoin('import_reports as ir', 'ir.id', 'c.import_report_id')
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
        eb('c.pcr_number', '=', text),
        ...(n === null
          ? []
          : [eb('c.number', '=', n), eb('p.number', '=', n), eb('ir.number', '=', n)])
      ])
    );
  }
  return whereFacets(q, claimFacets(), f, except);
};

export const searchClaims = async (db: Db, agencyId: string, f: ClaimFilters) => {
  const [page, facets] = await Promise.all([
    paged(claimIds(db, agencyId, f), f, claimOrder(db), sql.ref('c.id')),
    facetCounts((except) => claimIds(db, agencyId, f, except), claimFacets())
  ]);
  const ids = page.items.map((r) => r.id);
  const rows = ids.length ? await claimRows(db, agencyId).where('c.id', 'in', ids).execute() : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { ...page, items: ids.flatMap((id) => byId.get(id) ?? []), facets };
};

export const findClaim = (db: Db, agencyId: string, id: string) =>
  claimRows(db, agencyId)
    .leftJoin('import_reports as ir', 'ir.id', 'c.import_report_id')
    .leftJoin('imports as i', 'i.id', 'ir.import_id')
    .leftJoin('facilities as f', 'f.id', 'c.facility_id')
    .select((eb) => [
      'i.id as import_id',
      'c.facility_id',
      'f.name as facility_name',
      'i.file_name as import_file_name',
      'c.classification',
      'c.is_emergency',
      'c.loaded_miles',
      'c.origin_code',
      'c.destination_code',
      'c.pickup_address_line',
      'c.pickup_city',
      'c.pickup_state',
      'c.pickup_postal_code',
      'c.destination_name',
      'c.destination_address_line',
      'c.destination_city',
      'c.destination_state',
      'c.destination_postal_code',
      'c.import_report_id',
      ...DOCUMENTATION_COLUMNS,
      'c.is_deceased',
      'c.non_covered_miles',
      'p.birth_date',
      'c.patient_id',
      'p.gender',
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code',
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
            'cc.payer_code',
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
          .select(['l.position', 'l.code', 'l.units', 'l.unit_cents', 'l.total_cents'])
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
