import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

export const runTenant = (db: Kysely<Database>, runId: string) =>
  db.selectFrom('workflow_runs').select('tenant_id').where('id', '=', runId);
