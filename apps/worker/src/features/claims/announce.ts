import type { ClaimStore } from '@ugula/billing';
import type { Announce } from '../../shared/live.ts';

/** Tells clients about every claim the billing nodes change. */
export const announceClaims = (store: ClaimStore, announce: Announce): ClaimStore => {
  const changed = (runId: string, id: string) => announce(runId, { kind: 'claim', id });
  return {
    ...store,
    openClaim: async (runId, sourceKey, claim) => {
      const opened = await store.openClaim(runId, sourceKey, claim);
      await changed(runId, opened.id);
      return opened;
    },
    noteRevision: async (runId, claimId, sourceKey, report) => {
      await store.noteRevision(runId, claimId, sourceKey, report);
      await changed(runId, claimId);
    },
    attachCycle: async (runId, claimId, cycleRunId) => {
      await store.attachCycle(runId, claimId, cycleRunId);
      await changed(runId, claimId);
    },
    saveStatement: async (runId, claimId, sourceKey, statement) => {
      await store.saveStatement(runId, claimId, sourceKey, statement);
      await changed(runId, claimId);
    },
    recordEvent: async (runId, claimId, sourceKey, event) => {
      await store.recordEvent(runId, claimId, sourceKey, event);
      await changed(runId, claimId);
    },
    closeClaim: async (runId, claimId, sourceKey, status) => {
      await store.closeClaim(runId, claimId, sourceKey, status);
      await changed(runId, claimId);
    }
  };
};
