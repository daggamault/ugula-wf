import type { Database, ImportSource, RunStatus } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import type { ImportSort } from './schemas.ts';

export const findLatestPublished = (db: Kysely<Database>, tenantId: string, key: string) =>
  db
    .selectFrom('graph_versions as gv')
    .innerJoin('graphs as g', 'g.id', 'gv.graph_id')
    .select(['gv.id', 'gv.version'])
    .where('g.key', '=', key)
    .where('g.kind', '=', 'workflow')
    .where('gv.published_at', 'is not', null)
    .where((eb) => eb.or([eb('g.tenant_id', '=', tenantId), eb('g.tenant_id', 'is', null)]))
    .orderBy(sql`g.tenant_id nulls last`)
    .orderBy('gv.version', 'desc')
    .limit(1)
    .executeTakeFirst();

export const findSftpTenant = (db: Kysely<Database>, username: string) =>
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

export const insertImport = (db: Kysely<Database>, i: NewImport) =>
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

export const findReport = (db: Kysely<Database>, tenantId: string, id: string) =>
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
  charges: sql.ref('claimed.charges_cents')
};

export const listImports = (
  db: Kysely<Database>,
  tenantId: string,
  page: PageRequest<ImportSort>
) => paged(importRows(db, tenantId), page, IMPORT_ORDER, sql.ref('i.id'));

const importRows = (db: Kysely<Database>, tenantId: string) =>
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
