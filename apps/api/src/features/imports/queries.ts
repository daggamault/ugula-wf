import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

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
