import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

export type TenantOf = (runId: string) => Promise<string | undefined>;

export const runTenant = (db: Kysely<Database>, runId: string) =>
  db.selectFrom('workflow_runs').select('tenant_id').where('id', '=', runId);

export const createTenantOf =
  (db: Kysely<Database>, known: (runId: string) => string | undefined): TenantOf =>
  async (runId) =>
    known(runId) ?? (await runTenant(db, runId).executeTakeFirst())?.tenant_id;
