import type { DocumentStore } from '@ugula/billing';
import { ACTIVE_RUN_STATUSES, type Db } from '@ugula/db';
import { sql } from 'kysely';
import { runAgency } from '../../shared/tenancy.ts';

const CHASE_WORKFLOW = 'billing.chase-document';

const CHOSEN_OUTCOME = 'chase';

export const createDocumentStore = (db: Db): DocumentStore => ({
  chasedDocuments: async (runId, claimId) =>
    (
      await db
        .selectFrom('workflow_runs as r')
        .innerJoin('graph_versions as v', 'v.id', 'r.graph_version_id')
        .innerJoin('graphs as g', 'g.id', 'v.graph_id')
        .select((eb) =>
          eb.fn
            .coalesce(
              sql<string | null>`r.inputs ->> 'kind'`,
              eb
                .selectFrom('tasks as t')
                .select(sql<string>`t.resolution -> 'values' ->> 'kind'`.as('kind'))
                .whereRef('t.run_id', '=', 'r.id')
                .where('t.status', '=', 'completed')
                .where(sql<string>`t.resolution ->> 'outcome'`, '=', CHOSEN_OUTCOME)
                .orderBy('t.completed_at', 'desc')
                .limit(1)
            )
            .as('kind')
        )
        .where('r.agency_id', '=', runAgency(db, runId))
        .where('r.status', 'in', ACTIVE_RUN_STATUSES)
        .where('g.key', '=', CHASE_WORKFLOW)
        .where(sql<string>`r.inputs ->> 'claimId'`, '=', claimId)
        .execute()
    ).flatMap((r) => (r.kind ? [r.kind] : []))
});
