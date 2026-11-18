import { type CodeSet, normalizeCode, usState } from '@ugula/billing';
import { type Db, describeCodes, type ImportSource } from '@ugula/db';
import {
  codeSystemOf,
  type EncounterOutcome,
  type ReportDictionary,
  type ReportTerms
} from '@ugula/nemsis';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { ImportSort, ReportSort } from './schemas.ts';

export type ImportFilters = PageRequest<ImportSort> & { q?: string | undefined };

export const findSftpAgency = (db: Db, username: string) =>
  db
    .selectFrom('agencies')
    .select(['id', 'sftp_password_hash'])
    .where('sftp_username', '=', username)
    .where('is_active', '=', true)
    .executeTakeFirst();

export type NewImport = {
  agencyId: string;
  source: ImportSource;
  fileName: string;
  file: unknown;
  uploadedBy: string | null;
};

export const insertImport = (db: Db, i: NewImport) =>
  db
    .insertInto('imports')
    .values({
      agency_id: i.agencyId,
      source: i.source,
      file_name: i.fileName,
      file: JSON.stringify(i.file),
      uploaded_by_id: i.uploadedBy
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const findReport = (db: Db, agencyId: string, id: string) =>
  db
    .selectFrom('import_reports as r')
    .innerJoin('imports as i', 'i.id', 'r.import_id')
    .select([
      'r.id',
      'r.position',
      'r.pcr_number',
      'r.report',
      'i.id as import_id',
      'i.file_name',
      'i.created_at'
    ])
    .where('r.id', '=', id)
    .where('i.agency_id', '=', agencyId)
    .executeTakeFirst();

const outcomeCount = (outcome: EncounterOutcome) =>
  sql<number>`(count(*) filter (where ir.outcome = ${outcome}))::int`;

const IMPORT_ORDER = {
  received: sql.ref('i.created_at'),
  file: sql`lower(i.file_name)`,
  reports: sql.ref('i.report_count'),
  claims: sql.ref('claimed.claims'),
  charges: sql.ref('claimed.charges_cents'),
  status: sql.ref('r.status')
};

const importRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('imports as i')
    .leftJoin('workflow_runs as r', 'r.id', 'i.run_id')
    .leftJoin('users as u', 'u.id', 'i.uploaded_by_id')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('import_reports as ir')
          .select([
            outcomeCount('created').as('created'),
            outcomeCount('revised').as('revised'),
            outcomeCount('unchanged').as('unchanged')
          ])
          .whereRef('ir.import_id', '=', 'i.id')
          .as('reports'),
      (join) => join.onTrue()
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('claims as c')
          .select([
            sql<number>`count(*)::int`.as('claims'),
            sql<number>`coalesce(sum(c.total_cents), 0)::float8`.as('charges_cents')
          ])
          .whereRef('c.agency_id', '=', 'i.agency_id')
          .where('c.encounter_id', 'in', (q) =>
            q
              .selectFrom('import_reports as ir')
              .select('ir.encounter_id')
              .whereRef('ir.import_id', '=', 'i.id')
              .where('ir.encounter_id', 'is not', null)
          )
          .as('claimed'),
      (join) => join.onTrue()
    )
    .select([
      'i.id',
      'i.file_name',
      'i.source',
      'i.report_count',
      'i.created_at',
      'i.run_id',
      'r.status as run_status',
      'u.email as uploaded_by_email',
      'reports.created',
      'reports.revised',
      'reports.unchanged',
      'claimed.claims',
      'claimed.charges_cents'
    ])
    .where('i.agency_id', '=', agencyId);

export const searchImports = (db: Db, agencyId: string, f: ImportFilters) => {
  let q = importRows(db, agencyId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([eb(sql`lower(i.file_name)`, 'like', like), eb(sql`lower(u.email)`, 'like', like)])
    );
  }
  return paged(q, f, IMPORT_ORDER, sql.ref('i.id'));
};

export const hasImport = async (db: Db, agencyId: string, id: string) =>
  (await db
    .selectFrom('imports')
    .select('id')
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .executeTakeFirst()) !== undefined;

export const findImport = (db: Db, agencyId: string, id: string) =>
  importRows(db, agencyId).where('i.id', '=', id).executeTakeFirst();

const REPORT_ORDER = {
  position: sql.ref('ir.position'),
  pcr: sql.ref('ir.pcr_number'),
  patient: sql`lower(p.last_name || ' ' || p.first_name)`,
  outcome: sql.ref('ir.outcome'),
  claim: sql.ref('c.status'),
  total: sql.ref('c.total_cents')
};

export const listImportReports = (
  db: Db,
  agencyId: string,
  importId: string,
  page: PageRequest<ReportSort>
) =>
  paged(
    db
      .selectFrom('import_reports as ir')
      .leftJoin('encounters as e', 'e.id', 'ir.encounter_id')
      .leftJoin('claims as c', (j) =>
        j.onRef('c.agency_id', '=', 'ir.agency_id').onRef('c.encounter_id', '=', 'ir.encounter_id')
      )
      .leftJoin('patients as p', 'p.id', 'c.patient_id')
      .select([
        'ir.id',
        'ir.position',
        'ir.pcr_number',
        'ir.outcome',
        'e.number as encounter_number',
        'c.id as claim_id',
        'c.status as claim_status',
        'c.total_cents',
        'p.first_name',
        'p.last_name'
      ])
      .where('ir.agency_id', '=', agencyId)
      .where('ir.import_id', '=', importId),
    page,
    REPORT_ORDER,
    sql.ref('ir.id')
  );

type CodeSystem = NonNullable<ReturnType<typeof codeSystemOf>>;

const CODE_SETS_OF: Readonly<Partial<Record<CodeSystem, readonly CodeSet[]>>> = {
  icd10: ['icd10cm'],
  rxnorm: ['rxnorm', 'snomed'],
  snomed: ['snomed']
};

const codeSetsOf = (list: string) => {
  const system = codeSystemOf(list);
  return (system && CODE_SETS_OF[system]) ?? [];
};

const describeOutside = async (db: Db, codes: ReportTerms['codes']) => {
  const places = codes.filter((c) => codeSystemOf(c.list) === 'gnis' && /^\d{1,9}$/.test(c.code));
  const ids = [...new Set(places.map((c) => Number(c.code)))].filter((id) => id > 0);
  const rows = ids.length
    ? await db.selectFrom('gnis_places').select(['id', 'name']).where('id', 'in', ids).execute()
    : [];
  const names = new Map(rows.map((p) => [p.id, p.name]));
  const states = codes.filter((c) => codeSystemOf(c.list) === 'state');
  const coded = codes.flatMap((c) => {
    const refs = codeSetsOf(c.list).map((set) => ({ set, code: normalizeCode(set, c.code) }));
    return refs.length ? [{ ...c, refs }] : [];
  });
  const described = await describeCodes(
    db,
    coded.flatMap((c) => c.refs)
  );
  return [
    ...places.flatMap((c) => {
      const description = names.get(Number(c.code));
      return description ? [{ ...c, description }] : [];
    }),
    ...states.flatMap((c) => {
      const description = usState(c.code);
      return description ? [{ ...c, description }] : [];
    }),
    ...coded.flatMap(({ refs, ...c }) => {
      const description = refs.map((r) => described[r.set]?.[r.code]).find(Boolean);
      return description ? [{ ...c, description }] : [];
    })
  ];
};

export const findDictionary = async (
  db: Db,
  { elements, codes }: ReportTerms
): Promise<ReportDictionary> => {
  const [named, described, outside] = await Promise.all([
    elements.length
      ? db
          .selectFrom('nemsis_elements')
          .select(['element', 'name'])
          .where('element', 'in', elements)
          .execute()
      : [],
    codes.length
      ? db
          .selectFrom('nemsis_codes')
          .select(['list', 'code', 'description'])
          .where((eb) =>
            eb(
              eb.refTuple('list', 'code'),
              'in',
              codes.map((c) => eb.tuple(c.list, c.code))
            )
          )
          .execute()
      : [],
    describeOutside(db, codes)
  ]);
  const dictionary: ReportDictionary = {
    elements: Object.fromEntries(named.map((e) => [e.element, e.name])),
    codes: {}
  };
  for (const c of [...outside, ...described]) {
    dictionary.codes[c.list] = { ...dictionary.codes[c.list], [c.code]: c.description };
  }
  return dictionary;
};
