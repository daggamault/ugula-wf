import type { Database } from '@ugula/db';
import type { LiveEvent } from '@ugula/events';
import type { Kysely } from 'kysely';
import { runTenant } from './tenancy.ts';

export type Publish = (tenantId: string, event: LiveEvent) => Promise<void>;

export type Announce = (runId: string, event: LiveEvent) => Promise<void>;

/**
 * Publishes to the tenant of the run that made a change. A lost event only leaves clients stale
 * until their next reload, so failures never fail the step that caused them.
 */
export const createAnnouncer =
  (db: Kysely<Database>, publish: Publish): Announce =>
  async (runId, event) => {
    try {
      const run = await runTenant(db, runId).executeTakeFirst();
      if (run) await publish(run.tenant_id, event);
    } catch {
      // Best effort: see above.
    }
  };
