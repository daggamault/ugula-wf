import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

export type AgencyOf = (runId: string) => Promise<string | undefined>;

export const runAgency = (db: Kysely<Database>, runId: string) =>
  db.selectFrom('workflow_runs').select('agency_id').where('id', '=', runId);

export const createAgencyOf =
  (db: Kysely<Database>, known: (runId: string) => string | undefined): AgencyOf =>
  async (runId) =>
    known(runId) ?? (await runAgency(db, runId).executeTakeFirst())?.agency_id;
