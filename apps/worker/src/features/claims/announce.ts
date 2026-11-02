import type { ClaimStore } from '@ugula/billing';
import type { Announce } from '../../shared/live.ts';

/** Tells clients about every claim the billing nodes change. */
export const announceClaims = (store: ClaimStore, announce: Announce): ClaimStore => {
  const changed = (runId: string, id: string) => announce(runId, { kind: 'claim', id });
  return {
    ...store,
    openDraft: async (runId, sourceKey, draft) => {
      const opened = await store.openDraft(runId, sourceKey, draft);
      await changed(runId, opened.id);
      return opened;
    },
    saveClaim: async (runId, claimId, claim) => {
      await store.saveClaim(runId, claimId, claim);
      await changed(runId, claimId);
    },
    setStatus: async (runId, claimId, status) => {
      await store.setStatus(runId, claimId, status);
      await changed(runId, claimId);
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
