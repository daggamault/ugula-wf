import type { Db, ImportSource, RunStatus } from '@ugula/db';
import type { ReportDictionary, ReportTerms } from '@ugula/nemsis';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { ImportSort, ReportSort } from './schemas.ts';

export type ImportFilters = PageRequest<ImportSort> & { q?: string | undefined };

export const findSftpTenant = (db: Db, username: string) =>
  db
    .selectFrom('tenants')
    .select(['id', 'sftp_password_hash'])
    .where('sftp_username', '=', username)
    .where('is_active', '=', true)
    .executeTakeFirst();

export type NewImport = {
  tenantId: string;
  runId: string;
  source: ImportSource;
  fileName: string;
  file: unknown;
  uploadedBy: string | null;
};

export const insertImport = (db: Db, i: NewImport) =>
  db
    .insertInto('imports')
    .values({
      tenant_id: i.tenantId,
      run_id: i.runId,
      source: i.source,
      file_name: i.fileName,
      file: JSON.stringify(i.file),
      uploaded_by: i.uploadedBy
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const findReport = (db: Db, tenantId: string, id: string) =>
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
    .where('i.tenant_id', '=', tenantId)
    .executeTakeFirst();

const childCount = (status: RunStatus) =>
  sql<number>`(count(*) filter (where ch.status = ${status}))::int`;

const IMPORT_ORDER = {
  received: sql.ref('i.created_at'),
  file: sql`lower(i.file_name)`,
  reports: sql.ref('i.report_count'),
  claims: sql.ref('claimed.claims'),
  charges: sql.ref('claimed.charges_cents'),
  status: sql`(r.status, reports.waiting + reports.processing + reports.stuck > 0)`,
  attention: sql`reports.waiting + reports.failed + reports.stuck + reports.processing`
};

const importRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('imports as i')
    .innerJoin('workflow_runs as r', 'r.id', 'i.run_id')
    .leftJoin('users as u', 'u.id', 'i.uploaded_by')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('workflow_runs as ch')
          .select([
            childCount('completed').as('completed'),
            childCount('suspended').as('waiting'),
            childCount('faulted').as('stuck'),
            childCount('failed').as('failed'),
            childCount('running').as('processing')
          ])
          .whereRef('ch.parent_id', '=', 'i.run_id')
          .as('reports'),
      (join) => join.onTrue()
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('claims as c')
          .innerJoin('import_reports as ir', 'ir.id', 'c.import_report_id')
          .select([
            sql<number>`count(*)::int`.as('claims'),
            sql<number>`coalesce(sum(c.total_cents), 0)::int`.as('charges_cents')
          ])
          .whereRef('ir.import_id', '=', 'i.id')
          .where('c.status', '<>', 'void')
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
      'reports.completed',
      'reports.waiting',
      'reports.stuck',
      'reports.failed',
      'reports.processing',
      'claimed.claims',
      'claimed.charges_cents'
    ])
    .where('i.tenant_id', '=', tenantId);

export const listImports = (db: Db, tenantId: string, f: ImportFilters) => {
  let q = importRows(db, tenantId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([eb(sql`lower(i.file_name)`, 'like', like), eb(sql`lower(u.email)`, 'like', like)])
    );
  }
  return paged(q, f, IMPORT_ORDER, sql.ref('i.id'));
};

export const findImport = (db: Db, tenantId: string, id: string) =>
  importRows(db, tenantId).where('i.id', '=', id).executeTakeFirst();

const REPORT_ORDER = {
  position: sql.ref('ir.position'),
  pcr: sql.ref('ir.pcr_number'),
  patient: sql`lower(p.last_name || ' ' || p.first_name)`,
  status: sql.ref('r.status'),
  claim: sql.ref('c.status'),
  total: sql.ref('c.total_cents')
};

export const listImportReports = (
  db: Db,
  tenantId: string,
  importId: string,
  page: PageRequest<ReportSort>
) =>
  paged(
    db
      .selectFrom('import_reports as ir')
      .innerJoin('imports as i', 'i.id', 'ir.import_id')
      .leftJoin('workflow_runs as r', (j) =>
        j
          .onRef('r.parent_id', '=', 'i.run_id')
          .on(sql<boolean>`r.inputs -> 'report' ->> 'key' = ir.report ->> 'key'`)
      )
      .leftJoin('claim_runs as cr', 'cr.run_id', 'r.id')
      .leftJoin('claims as c', 'c.id', 'cr.claim_id')
      .leftJoin('patients as p', 'p.id', 'c.patient_id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('tasks as t')
            .select(['t.id', 't.title', 't.subject', 't.kind'])
            .whereRef('t.run_id', '=', 'r.id')
            .where('t.status', '=', 'open')
            .orderBy('t.created_at')
            .limit(1)
            .as('t'),
        (join) => join.onTrue()
      )
      .select([
        'ir.id',
        'ir.position',
        'ir.pcr_number',
        'r.status as run_status',
        'c.id as claim_id',
        'c.status as claim_status',
        'c.total_cents',
        'p.first_name',
        'p.last_name',
        't.id as task_id',
        't.title as task_title',
        't.subject as task_subject',
        't.kind as task_kind'
      ])
      .where('i.tenant_id', '=', tenantId)
      .where('i.id', '=', importId),
    page,
    REPORT_ORDER,
    sql.ref('ir.id')
  );

export const findDictionary = async (
  db: Db,
  { elements, codes }: ReportTerms
): Promise<ReportDictionary> => {
  const [named, described] = await Promise.all([
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
      : []
  ]);
  const dictionary: ReportDictionary = {
    elements: Object.fromEntries(named.map((e) => [e.element, e.name])),
    codes: {}
  };
  for (const c of described) {
    dictionary.codes[c.list] = { ...dictionary.codes[c.list], [c.code]: c.description };
  }
  return dictionary;
};
